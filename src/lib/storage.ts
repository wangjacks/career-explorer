/**
 * 对象存储统一抽象（#111）：
 * - StorageAdapter 接口：上传 / 读取 / 删除 / 存在性 / 访问地址签发（文件类型中立，未来新增类型存储层零改动）
 * - 工厂 createStorage / getStorage：按后端配置路由到本地或 S3 兼容实现
 * - 对象 key 生成：`{prefix}_{studentId}_{yyyyMMddHHmmss}_{4位随机}.jpg`（多次上传不覆盖）
 *
 * 路径拼装规则：桶内完整路径 = `{bucket}/{path_prefix}/{key}`；本地 = `{cwd}/uploads/{key}`。
 * DB 只存对象 key，完整路径由适配器实时拼装。
 */
import { getStorageBackend, type StorageBackendRow } from "./db";
import { LocalStorageAdapter } from "./storage-local";
import { S3StorageAdapter } from "./storage-s3";

export interface StorageAdapter {
  type: "local" | "s3";
  /** 上传对象（任意 contentType，图片压缩等应用层逻辑在上传端点完成） */
  upload(key: string, buffer: Buffer, contentType: string): Promise<void>;
  /** 服务端读取原始内容（导出读图、本地→云迁移用） */
  read(key: string): Promise<Buffer>;
  /** 删除对象（对象不存在时静默成功） */
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  /** 全量枚举对象（#117）：媒体治理扫描用；S3 内部循环分页 */
  listObjects(): Promise<StoredObject[]>;
  /**
   * 解析访问地址（私有读写模式）：
   * - 本地：返回应用代理路径 `/api/uploads/{key}`（免签名，行为与现版本一致）
   * - S3：返回限时签名 URL（默认 30 分钟），不暴露长期公开下载地址
   */
  getSignedUrl(key: string, expiresInSeconds?: number): Promise<string>;
}

/** 存储对象元数据（#117）：媒体枚举/孤儿扫描用 */
export interface StoredObject {
  key: string;          // 逻辑 key（与 DB 引用一致：本地无前缀、S3 剥离 path_prefix）
  size: number;
  lastModified: string; // ISO 8601
}

/** 签名 URL 默认有效期：30 分钟 */
export const DEFAULT_SIGNED_URL_EXPIRES = 1800;

/** 对象 key 安全字符集：字母/数字/下划线/连字符/点，禁止路径分隔符 */
const SAFE_KEY_PATTERN = /^[\w.-]+$/;

export function validateObjectKey(key: string): void {
  if (!key || key.length > 255 || key.includes("..") || !SAFE_KEY_PATTERN.test(key)) {
    throw new Error("对象 key 非法");
  }
}

/** 生成唯一对象 key：时间戳精确到秒 + 4 位随机后缀，同一学生多次上传不互相覆盖 */
export function generateObjectKey(prefix: string, studentId: string): string {
  const ts = new Date()
    .toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })
    .replace(/[-: ]/g, "")
    .slice(0, 14);
  const rand = Math.random().toString(36).slice(2, 6).padEnd(4, "0");
  return `${prefix}_${studentId}_${ts}_${rand}.jpg`;
}

/** 纯工厂：按后端行实例化适配器（便于单测，不依赖 DB） */
export function createStorage(backend: StorageBackendRow): StorageAdapter {
  if (backend.type === "local") return new LocalStorageAdapter();
  return new S3StorageAdapter(backend);
}

/** 便捷工厂：从 DB 读取后端配置后实例化 */
export async function getStorage(backendId: number): Promise<StorageAdapter> {
  const backend = await getStorageBackend(backendId);
  if (!backend) throw new Error(`存储后端 #${backendId} 不存在`);
  return createStorage(backend);
}
