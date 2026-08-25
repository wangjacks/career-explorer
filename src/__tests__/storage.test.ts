/**
 * 存储抽象层与数据层单测（#111）：
 * - 对象 key 生成与校验（唯一性、防穿越）
 * - LocalStorageAdapter 读写/删除/存在性/免签名/路径穿越防护
 * - S3StorageAdapter 凭据校验、必填字段、双端点路由（签名强制公网）、根目录前缀拼装
 * - 工厂路由 local/s3
 * - storage_backends 数据层：种子/CRUD/设默认事务/备份恢复与旧备份兼容
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";
import type { StorageBackendRow } from "../lib/db";
import { createStorage, generateObjectKey, validateObjectKey } from "../lib/storage";
import { LocalStorageAdapter } from "../lib/storage-local";
import { S3StorageAdapter, getS3Credentials } from "../lib/storage-s3";

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-test-"));
  return path.join(dir, "test.db");
}

function makeBackend(overrides: Partial<StorageBackendRow> = {}): StorageBackendRow {
  return {
    id: 1,
    name: "测试后端",
    type: "local",
    endpoint: "",
    internal_endpoint: null,
    region: null,
    bucket: null,
    path_prefix: null,
    is_default: 1,
    created_at: "2026-08-25 10:00:00",
    updated_at: "2026-08-25 10:00:00",
    ...overrides,
  };
}

describe("对象 key 生成与校验", () => {
  it("generateObjectKey 格式：{prefix}_{studentId}_{14位时间戳}_{4位随机}.jpg", () => {
    const key = generateObjectKey("avatar", "202500000001");
    expect(key).toMatch(/^avatar_202500000001_\d{14}_[a-z0-9]{4}\.jpg$/);
  });

  it("generateObjectKey 同秒多次生成不重复（随机后缀）", () => {
    const keys = new Set(Array.from({ length: 50 }, () => generateObjectKey("avatar", "202500000001")));
    expect(keys.size).toBe(50);
  });

  it("validateObjectKey 拒绝路径分隔符、相对路径与超长输入", () => {
    expect(() => validateObjectKey("")).toThrow();
    expect(() => validateObjectKey("a/b.jpg")).toThrow();
    expect(() => validateObjectKey("..")).toThrow();
    expect(() => validateObjectKey("a..b.jpg")).toThrow();
    expect(() => validateObjectKey("a".repeat(256))).toThrow();
    expect(() => validateObjectKey("avatar_202500000001_20260825100000_a3f7.jpg")).not.toThrow();
  });
});

describe("LocalStorageAdapter", () => {
  let tmpRoot: string;
  let cwdSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    tmpRoot = mkdtempSync(path.join(tmpdir(), "career-storage-test-"));
    cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(tmpRoot);
  });

  afterEach(() => {
    cwdSpy.mockRestore();
    rmSync(tmpRoot, { recursive: true, force: true });
  });

  it("upload / read / exists / delete 全链路", async () => {
    const storage = new LocalStorageAdapter();
    await storage.upload("avatar_x.jpg", Buffer.from("hello"), "image/jpeg");
    expect(await storage.exists("avatar_x.jpg")).toBe(true);
    expect((await storage.read("avatar_x.jpg")).toString()).toBe("hello");
    await storage.delete("avatar_x.jpg");
    expect(await storage.exists("avatar_x.jpg")).toBe(false);
    // 对象不存在时删除静默成功（与 S3 DeleteObject 语义一致）
    await expect(storage.delete("avatar_x.jpg")).resolves.toBeUndefined();
  });

  it("getSignedUrl 返回应用代理路径（本地免签名）", async () => {
    const storage = new LocalStorageAdapter();
    expect(await storage.getSignedUrl("avatar_x.jpg")).toBe("/api/uploads/avatar_x.jpg");
  });

  it("拒绝路径穿越类 key", async () => {
    const storage = new LocalStorageAdapter();
    await expect(storage.read("../evil.jpg")).rejects.toThrow();
    await expect(storage.upload("..", Buffer.from("x"), "image/jpeg")).rejects.toThrow();
  });
});

describe("S3 凭据与适配器构造", () => {
  const ENV_KEYS = ["S3_99_ACCESS_KEY", "S3_99_SECRET_KEY"] as const;
  const backup: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const k of ENV_KEYS) {
      backup[k] = process.env[k];
      delete process.env[k];
    }
  });

  afterEach(() => {
    for (const k of ENV_KEYS) {
      if (backup[k] === undefined) delete process.env[k];
      else process.env[k] = backup[k];
    }
  });

  it("凭据缺失时抛出包含变量名的明确错误", () => {
    expect(() => getS3Credentials(99)).toThrow(/S3_99_ACCESS_KEY/);
    process.env.S3_99_ACCESS_KEY = "ak";
    expect(() => getS3Credentials(99)).toThrow(/S3_99_SECRET_KEY/);
  });

  it("必填字段校验：endpoint / region / bucket 缺失均报错", () => {
    process.env.S3_99_ACCESS_KEY = "ak";
    process.env.S3_99_SECRET_KEY = "sk";
    expect(
      () => new S3StorageAdapter(makeBackend({ id: 99, type: "s3", endpoint: "", region: "ap-shanghai", bucket: "b" }))
    ).toThrow(/公网端点/);
    expect(
      () => new S3StorageAdapter(makeBackend({ id: 99, type: "s3", endpoint: "https://cos.example.com", region: null, bucket: "b" }))
    ).toThrow(/region/);
    expect(
      () => new S3StorageAdapter(makeBackend({ id: 99, type: "s3", endpoint: "https://cos.example.com", region: "ap-shanghai", bucket: null }))
    ).toThrow(/bucket/);
    const adapter = new S3StorageAdapter(
      makeBackend({ id: 99, type: "s3", endpoint: "https://cos.example.com", region: "ap-shanghai", bucket: "b" })
    );
    expect(adapter.type).toBe("s3");
  });

  it("签名 URL 强制公网端点且拼入根目录前缀（双端点路由）", async () => {
    process.env.S3_99_ACCESS_KEY = "ak";
    process.env.S3_99_SECRET_KEY = "sk";
    const adapter = new S3StorageAdapter(
      makeBackend({
        id: 99,
        type: "s3",
        endpoint: "https://cos.ap-shanghai.myqcloud.com",
        internal_endpoint: "https://cos-internal.ap-shanghai.myqcloud.com",
        region: "ap-shanghai",
        bucket: "my-bucket",
        path_prefix: "/career/2026/",
      })
    );
    const url = await adapter.getSignedUrl("avatar_x.jpg", 60);
    expect(url).toContain("cos.ap-shanghai.myqcloud.com");
    expect(url).not.toContain("cos-internal");
    // 服务级端点 → 路径风格，桶名在路径中
    expect(url).toContain("my-bucket/career/2026/avatar_x.jpg");
    expect(url).toMatch(/X-Amz-Expires=60/);
  });

  it("未配置内网端点时不报错（退回公网端点）", () => {
    process.env.S3_99_ACCESS_KEY = "ak";
    process.env.S3_99_SECRET_KEY = "sk";
    const adapter = new S3StorageAdapter(
      makeBackend({ id: 99, type: "s3", endpoint: "https://cos.example.com", region: "ap-shanghai", bucket: "b" })
    );
    expect(adapter.type).toBe("s3");
  });

  it("虚拟主机风格端点（桶名在子域名）不重复拼桶名到路径（#111 修复）", async () => {
    process.env.S3_99_ACCESS_KEY = "ak";
    process.env.S3_99_SECRET_KEY = "sk";
    const bucket = "blog233-usercontents-1301217517";
    const adapter = new S3StorageAdapter(
      makeBackend({
        id: 99,
        type: "s3",
        endpoint: `https://${bucket}.cos.ap-guangzhou.myqcloud.com`,
        region: "ap-guangzhou",
        bucket,
        path_prefix: "career-dev-local/2026",
      })
    );
    const url = await adapter.getSignedUrl("avatar_202599990002.jpg", 60);
    // 主机名为虚拟主机风格（桶在子域名）
    expect(url).toContain(`${bucket}.cos.ap-guangzhou.myqcloud.com`);
    // 路径不含重复桶名，且正确拼入根目录前缀 + 对象 key
    expect(url).not.toContain(`/${bucket}/${bucket}/`);
    expect(url).toContain(`/career-dev-local/2026/avatar_202599990002.jpg`);
  });

  it("自定义域名（CNAME 到桶）自动识别为虚拟主机风格，不拼桶名到路径", async () => {
    process.env.S3_98_ACCESS_KEY = "ak";
    process.env.S3_98_SECRET_KEY = "sk";
    const adapter = new S3StorageAdapter(
      makeBackend({
        id: 98,
        type: "s3",
        endpoint: "https://usercontents.blog233.com",
        region: "ap-guangzhou",
        bucket: "blog233-usercontents-1301217517",
        path_prefix: "career-dev-local/2026",
      })
    );
    const url = await adapter.getSignedUrl("avatar_202599990002.jpg", 60);
    // 签名 URL 使用自定义域名
    expect(url).toContain("usercontents.blog233.com");
    // 路径不含桶名（自定义域名已隐含桶）
    expect(url).not.toContain("/blog233-usercontents-1301217517/");
    // 正确拼入根目录前缀 + 对象 key
    expect(url).toContain(`/career-dev-local/2026/avatar_202599990002.jpg`);
  });
});

describe("存储工厂路由", () => {
  it("createStorage 按后端类型路由到对应实现", () => {
    expect(createStorage(makeBackend())).toBeInstanceOf(LocalStorageAdapter);
    process.env.S3_98_ACCESS_KEY = "ak";
    process.env.S3_98_SECRET_KEY = "sk";
    const s3 = createStorage(
      makeBackend({ id: 98, type: "s3", endpoint: "https://e.example.com", region: "r", bucket: "b" })
    );
    expect(s3).toBeInstanceOf(S3StorageAdapter);
    delete process.env.S3_98_ACCESS_KEY;
    delete process.env.S3_98_SECRET_KEY;
  });
});

describe("storage_backends 数据层（SQLite）", () => {
  it("init 种子内置本地后端且为默认，重复 init 不重复插入", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const backends = adapter.listStorageBackends();
    expect(backends).toHaveLength(1);
    expect(backends[0].type).toBe("local");
    expect(backends[0].is_default).toBe(1);
    expect(adapter.getDefaultStorageBackend()?.id).toBe(backends[0].id);

    adapter.init();
    expect(adapter.listStorageBackends()).toHaveLength(1);

    // 存量用户已被回填本地后端
    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    expect(adapter.getUserByCode("202505050101")?.storage_id).toBe(backends[0].id);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("CRUD + setDefault 事务保证唯一默认 + 引用计数", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const id = adapter.insertStorageBackend({
      name: "腾讯云",
      type: "s3",
      endpoint: "https://cos.ap-shanghai.myqcloud.com",
      internal_endpoint: "https://cos-internal.ap-shanghai.myqcloud.com",
      region: "ap-shanghai",
      bucket: "career-bucket",
      path_prefix: "career/2026",
    });
    expect(adapter.getStorageBackend(id)?.name).toBe("腾讯云");

    // 同名拒绝
    expect(() => adapter.insertStorageBackend({ name: "腾讯云", type: "s3" })).toThrow();

    adapter.updateStorageBackend(id, { path_prefix: "career/2027", name: "腾讯云-正式" });
    const updated = adapter.getStorageBackend(id);
    expect(updated?.name).toBe("腾讯云-正式");
    expect(updated?.path_prefix).toBe("career/2027");

    // 设默认后仅一个默认
    adapter.setDefaultStorageBackend(id);
    expect(adapter.getDefaultStorageBackend()?.id).toBe(id);
    expect(adapter.listStorageBackends().filter((b) => b.is_default === 1)).toHaveLength(1);

    // 用户引用计数（迁移删除保护依据）
    adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四" });
    const userId = adapter.getUserByCode("202505050102")!.id;
    adapter.updateUserStorageId(userId, id);
    expect(adapter.countUsersByStorageId(id)).toBe(1);
    expect(adapter.getUsersByStorageId(id)[0].user_code).toBe("202505050102");

    adapter.deleteStorageBackend(id);
    expect(adapter.getStorageBackend(id)).toBeUndefined();

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("备份/恢复保留 storage_backends 与 storage_id；旧备份回填本地后端", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const s3Id = adapter.insertStorageBackend({ name: "云桶", type: "s3", endpoint: "https://e", region: "r", bucket: "b" });
    adapter.insertUser({ user_code: "202505050103", role: "student", name: "王五" });
    const userId = adapter.getUserByCode("202505050103")!.id;
    adapter.updateUserStorageId(userId, s3Id);
    adapter.upsertSubmission("202505050103", "[]", "avatar_x.jpg", "eval_y.jpg", s3Id);

    const data = adapter.backup();
    expect(data.storage_backends).toHaveLength(2);

    // 恢复含 storage_backends 的备份：引用关系保持
    adapter.restore(data);
    expect(adapter.listStorageBackends()).toHaveLength(2);
    expect(adapter.getUserByCode("202505050103")?.storage_id).toBe(s3Id);

    // 模拟旧备份：删除 storage_backends 字段与用户 storage_id → 恢复后回填本地后端
    const oldBackup = {
      ...data,
      storage_backends: undefined,
      users: data.users.map((u) => ({ ...u, storage_id: undefined as unknown as number })),
    };
    adapter.restore(oldBackup);
    const localId = adapter.getDefaultStorageBackend()!.id;
    expect(adapter.getUserByCode("202505050103")?.storage_id).toBe(localId);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});
