/**
 * S3 兼容对象存储实现（#111）：
 * - 单一 `@aws-sdk/client-s3` 覆盖腾讯云 COS / 阿里云 OSS / MinIO / AWS S3（更换提供商仅改配置）
 * - 双客户端策略：服务端读写（上传/删除/探测/导出读图）优先内网端点；签名 URL 强制公网端点
 * - 私有读写：访问一律签发临时签名 URL，不暴露长期公开下载地址
 * - 凭据不入库：从 `.env.local` 读取 `S3_{id}_ACCESS_KEY` / `S3_{id}_SECRET_KEY`
 */
import {
  DeleteObjectCommand,
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl as presignUrl } from "@aws-sdk/s3-request-presigner";
import type { StorageBackendRow } from "./db";
import { DEFAULT_SIGNED_URL_EXPIRES, validateObjectKey, type StorageAdapter } from "./storage";

export interface S3Credentials {
  accessKeyId: string;
  secretAccessKey: string;
}

/** 读取后端凭据环境变量（12-Factor）；缺失时抛出明确错误（管理面板据此提示配置） */
export function getS3Credentials(backendId: number): S3Credentials {
  const accessKeyId = process.env[`S3_${backendId}_ACCESS_KEY`];
  const secretAccessKey = process.env[`S3_${backendId}_SECRET_KEY`];
  if (!accessKeyId || !secretAccessKey) {
    throw new Error(
      `存储后端 #${backendId} 凭据未配置：请在 .env.local 中设置 S3_${backendId}_ACCESS_KEY / S3_${backendId}_SECRET_KEY 并重启服务`
    );
  }
  return { accessKeyId, secretAccessKey };
}

export class S3StorageAdapter implements StorageAdapter {
  readonly type = "s3" as const;

  private readonly bucket: string;
  /** 规范化后的对象根目录前缀（去除首尾斜杠；可为空） */
  private readonly prefix: string;
  /** 服务端读写客户端：优先内网端点（省公网流量），未配置退回公网端点 */
  private readonly serverClient: S3Client;
  /** 签名 URL 客户端：强制公网端点（浏览器需公网可达） */
  private readonly publicClient: S3Client;
  /** 自定义域名时，签名 URL 需将虚拟主机 hostname 替换为此域名 */
  private readonly customDomain: string | null;
  /** 自定义域名对应的虚拟主机 COS hostname（签名 URL 替换源） */
  private readonly virtualHostedHostname: string | null;

  constructor(backend: StorageBackendRow) {
    if (!backend.endpoint) throw new Error(`存储后端 #${backend.id} 缺少公网端点`);
    if (!backend.region) throw new Error(`存储后端 #${backend.id} 缺少 region`);
    if (!backend.bucket) throw new Error(`存储后端 #${backend.id} 缺少 bucket`);
    const credentials = getS3Credentials(backend.id);

    this.bucket = backend.bucket;
    this.prefix = (backend.path_prefix ?? "").replace(/^\/+|\/+$/g, "");

    // 端点规范化（#111）：
    // S3 SDK 在 forcePathStyle=false 时「总是」把 {bucket}. 拼到 hostname 前面，
    // 因此必须确保传给 SDK 的 endpoint 不含桶名（服务级），由 SDK 统一拼桶到 hostname。
    // - 虚拟主机端点（{bucket}.cos.xxx）→ 剥除桶名，还原为服务级端点
    // - 服务级端点（cos.xxx）→ 直接使用
    // - 自定义域名（CNAME 到桶）→ 改用服务级 COS 端点，签名 URL 再替换回自定义域名
    const stripBucketFromHostname = (ep: string): string => {
      try {
        const url = new URL(ep);
        if (url.hostname.startsWith(`${backend.bucket}.`)) {
          url.hostname = url.hostname.slice(`${backend.bucket}.`.length);
        }
        return url.toString().replace(/\/$/, "");
      } catch {
        return ep;
      }
    };

    const isCustomDomain = (ep: string): boolean => {
      try {
        const hostname = new URL(ep).hostname;
        if (hostname.startsWith(`${backend.bucket}.`)) return false; // 虚拟主机，非自定义
        if (/\.(myqcloud\.com|amazonaws\.com|aliyuncs\.com)$/i.test(hostname)) return false; // 服务级，非自定义
        return true;
      } catch {
        return false;
      }
    };

    const publicIsCustom = isCustomDomain(backend.endpoint);

    // 自定义域名处理：SDK 使用服务级 COS 端点，签名 URL 生成后替换 hostname
    const regionServiceEndpoint = `https://cos.${backend.region}.myqcloud.com`;
    if (publicIsCustom) {
      try {
        this.customDomain = new URL(backend.endpoint).hostname;
        this.virtualHostedHostname = `${backend.bucket}.cos.${backend.region}.myqcloud.com`;
      } catch {
        this.customDomain = null;
        this.virtualHostedHostname = null;
      }
    } else {
      this.customDomain = null;
      this.virtualHostedHostname = null;
    }

    // 规范化端点：剥除桶名（虚拟主机→服务级）、自定义域名→服务级 COS 端点
    const normalizeEndpoint = (ep: string): string => {
      return publicIsCustom && ep === backend.endpoint
        ? regionServiceEndpoint
        : stripBucketFromHostname(ep);
    };

    const serverRawEndpoint = backend.internal_endpoint || backend.endpoint;
    const serverIsCustom = !backend.internal_endpoint && publicIsCustom;
    const common = { region: backend.region, credentials };

    // 所有客户端统一用服务级端点 + forcePathStyle=false（SDK 拼桶到 hostname）
    this.serverClient = new S3Client({
      ...common,
      endpoint: normalizeEndpoint(serverRawEndpoint),
      forcePathStyle: false,
    });
    this.publicClient = backend.internal_endpoint
      ? new S3Client({ ...common, endpoint: normalizeEndpoint(backend.endpoint), forcePathStyle: false })
      : serverIsCustom
        ? new S3Client({ ...common, endpoint: regionServiceEndpoint, forcePathStyle: false })
        : this.serverClient;
  }

  /** 桶内完整对象路径：`{path_prefix}/{key}` */
  private objectKey(key: string): string {
    validateObjectKey(key);
    return this.prefix ? `${this.prefix}/${key}` : key;
  }

  async upload(key: string, buffer: Buffer, contentType: string): Promise<void> {
    await this.serverClient.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: this.objectKey(key),
        Body: buffer,
        ContentType: contentType,
      })
    );
  }

  async read(key: string): Promise<Buffer> {
    const res = await this.serverClient.send(
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
    );
    const bytes = await res.Body?.transformToByteArray();
    if (!bytes) throw new Error("对象内容为空");
    return Buffer.from(bytes);
  }

  async delete(key: string): Promise<void> {
    await this.serverClient.send(
      new DeleteObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
    );
  }

  async exists(key: string): Promise<boolean> {
    try {
      await this.serverClient.send(
        new HeadObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) })
      );
      return true;
    } catch (err) {
      if ((err as { name?: string })?.name === "NotFound") return false;
      throw err;
    }
  }

  async getSignedUrl(key: string, expiresInSeconds = DEFAULT_SIGNED_URL_EXPIRES): Promise<string> {
    // 强制公网客户端：浏览器在公网访问，内网端点不可达
    const url = await presignUrl(
      this.publicClient,
      new GetObjectCommand({ Bucket: this.bucket, Key: this.objectKey(key) }),
      { expiresIn: expiresInSeconds }
    );
    // 自定义域名：将虚拟主机 COS hostname 替换为自定义域名
    // S3 签名不绑定 Host 头（签名仅覆盖 method/path/query/特定 headers），替换安全
    if (this.customDomain && this.virtualHostedHostname) {
      return url.replace(this.virtualHostedHostname, this.customDomain);
    }
    return url;
  }
}
