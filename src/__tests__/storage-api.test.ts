/**
 * 存储管理端点权限与逻辑单测（#111）：
 * - 管理端点权限分流：学生 403、教师 403（仅管理员）
 * - 后端新增校验与删除保护（本地/默认/被引用不可删）
 * - 签名端点越权：学生取他人文件 403、教师跨班级 403；本人/管辖班级放行
 * - 迁移：目标校验、幂等跳过、失败用户不改引用
 * - 档案配置端点：上传大小上限校验（1–20）
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// ---------- mock：db 与 storage 全量隔离 ----------
vi.mock("@/lib/db", () => ({
  getUserById: vi.fn(),
  listStorageBackends: vi.fn(),
  getStorageBackend: vi.fn(),
  insertStorageBackend: vi.fn(),
  updateStorageBackend: vi.fn(),
  deleteStorageBackend: vi.fn(),
  setDefaultStorageBackend: vi.fn(),
  getDefaultStorageBackend: vi.fn(),
  countUsersByStorageId: vi.fn(),
  getUsersByStorageId: vi.fn(),
  updateUserStorageRef: vi.fn(),
  getAllSubmitted: vi.fn(),
  getProfileSubmissionOwnerByFileUrl: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  getProfileConfigs: vi.fn(),
  setProfileConfig: vi.fn(),
  getMaxCustomTags: vi.fn(),
  getMaxAvatarSizeMb: vi.fn(),
  getMaxEvaluationSizeMb: vi.fn(),
  getMaxProfileSubmissions: vi.fn(),
  getSubmissionDeadline: vi.fn(),
  insertAuditLog: vi.fn(),
  MAX_AVATAR_SIZE_KEY: "max_avatar_size_mb",
  MAX_EVALUATION_SIZE_KEY: "max_evaluation_size_mb",
  MAX_PROFILE_SUBMISSIONS_KEY: "max_profile_submissions",
  SUBMISSION_DEADLINE_KEY: "submission_deadline",
}));

let fakeStorage: {
  upload: ReturnType<typeof vi.fn>;
  read: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
  exists: ReturnType<typeof vi.fn>;
  getSignedUrl: ReturnType<typeof vi.fn>;
};

vi.mock("@/lib/storage", () => ({
  createStorage: vi.fn(() => fakeStorage),
}));

import {
  listStorageBackends,
  getStorageBackend,
  insertStorageBackend,
  deleteStorageBackend,
  setDefaultStorageBackend,
  countUsersByStorageId,
  getUsersByStorageId,
  updateUserStorageRef,
  getAllSubmitted,
  getProfileSubmissionOwnerByFileUrl,
  getTeacherClassPairs,
  setProfileConfig,
  getMaxCustomTags,
  getMaxAvatarSizeMb,
  getMaxEvaluationSizeMb,
  getMaxProfileSubmissions,
  getSubmissionDeadline,
  type StorageBackendRow,
} from "@/lib/db";
import { GET, POST, PUT, DELETE, PATCH } from "@/app/api/manage/storage/route";
import { POST as MIGRATE } from "@/app/api/manage/storage/migrate/route";
import { GET as SIGN } from "@/app/api/shared/storage-sign/route";
import { PUT as CONFIG_PUT, GET as CONFIG_GET } from "@/app/api/manage/profile-config/route";

// ---------- 工具 ----------
function backend(overrides: Partial<StorageBackendRow> = {}): StorageBackendRow {
  return {
    id: 1,
    name: "本地存储",
    type: "local",
    endpoint: "",
    internal_endpoint: null,
    region: null,
    bucket: null,
    path_prefix: null,
    is_default: 1,
    created_at: "",
    updated_at: "",
    ...overrides,
  };
}

function makeJsonRequest(
  path: string,
  method: "GET" | "POST" | "PUT" | "DELETE" | "PATCH",
  body?: unknown,
  cookies?: Record<string, string>,
  params?: Record<string, string>
): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  if (params) for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method,
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

async function tokens() {
  return {
    admin: { auth_token: await signToken({ role: "admin", uid: 1, name: "管理员" }) },
    teacher: { auth_token: await signToken({ role: "teacher", uid: 3, name: "教师" }) },
    student: { auth_token: await signToken({ role: "student", uid: 7, name: "学生" }) },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  // 审计模块经 insertAuditLog 落库，mock 后不会触碰真实库
  fakeStorage = {
    upload: vi.fn().mockResolvedValue(undefined),
    read: vi.fn().mockResolvedValue(Buffer.from("img")),
    delete: vi.fn().mockResolvedValue(undefined),
    exists: vi.fn().mockResolvedValue(false),
    getSignedUrl: vi.fn().mockResolvedValue("https://signed.example.com/key"),
  };
});

// ---------- 权限分流 ----------
describe("存储管理端点权限分流（#111：仅管理员）", () => {
  it("未登录 → 401", async () => {
    const res = await GET(makeJsonRequest("/api/manage/storage", "GET"));
    expect(res.status).toBe(401);
  });

  it("学生 → 403", async () => {
    const t = await tokens();
    const res = await GET(makeJsonRequest("/api/manage/storage", "GET", undefined, t.student));
    expect(res.status).toBe(403);
  });

  it("教师 → 403", async () => {
    const t = await tokens();
    const res = await GET(makeJsonRequest("/api/manage/storage", "GET", undefined, t.teacher));
    expect(res.status).toBe(403);
  });

  it("管理员 → 200 且凭据仅返回配置状态（无明文）", async () => {
    const t = await tokens();
    vi.mocked(listStorageBackends).mockResolvedValue([backend()]);
    const res = await GET(makeJsonRequest("/api/manage/storage", "GET", undefined, t.admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.backends).toHaveLength(1);
    expect(body.backends[0].credentialsConfigured).toBe(true);
    expect(JSON.stringify(body)).not.toContain("SECRET");
  });
});

// ---------- 新增与删除保护 ----------
describe("存储后端新增 / 删除保护", () => {
  it("新增仅允许 s3 类型，且 endpoint/region/bucket 必填", async () => {
    const t = await tokens();
    let res = await POST(makeJsonRequest("/api/manage/storage", "POST", { name: "本地二号", type: "local" }, t.admin));
    expect(res.status).toBe(400);

    res = await POST(
      makeJsonRequest("/api/manage/storage", "POST", { name: "云桶", type: "s3", endpoint: "https://e", region: "" }, t.admin)
    );
    expect(res.status).toBe(400);
  });

  it("新增成功返回 id 与环境变量配置提示", async () => {
    const t = await tokens();
    vi.mocked(insertStorageBackend).mockResolvedValue(2);
    const res = await POST(
      makeJsonRequest(
        "/api/manage/storage",
        "POST",
        { name: "腾讯云", type: "s3", endpoint: "https://cos.ap-shanghai.myqcloud.com", region: "ap-shanghai", bucket: "b" },
        t.admin
      )
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.id).toBe(2);
    expect(body.message).toContain("S3_2_ACCESS_KEY");
  });

  it("更新：S3 三要素不允许被清空；合法字段正常写入", async () => {
    const t = await tokens();
    const s3Backend = backend({
      id: 2, name: "云", type: "s3", is_default: 0,
      endpoint: "https://e.example.com", region: "ap-shanghai", bucket: "b",
    });
    vi.mocked(getStorageBackend).mockResolvedValue(s3Backend);

    // 清空 endpoint → 拒绝
    let res = await PUT(makeJsonRequest("/api/manage/storage", "PUT", { id: 2, endpoint: "" }, t.admin));
    expect(res.status).toBe(400);

    // 合法更新（根目录前缀）
    res = await PUT(makeJsonRequest("/api/manage/storage", "PUT", { id: 2, path_prefix: "career/2027" }, t.admin));
    expect(res.status).toBe(200);
  });

  it("删除保护：本地后端 / 默认后端 / 被引用后端均不可删", async () => {
    const t = await tokens();
    // 本地后端
    vi.mocked(getStorageBackend).mockResolvedValue(backend());
    let res = await DELETE(makeJsonRequest("/api/manage/storage", "DELETE", undefined, t.admin, { id: "1" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("内置") });

    // 默认后端（s3 但 is_default=1）
    vi.mocked(getStorageBackend).mockResolvedValue(backend({ id: 2, name: "云", type: "s3", is_default: 1 }));
    res = await DELETE(makeJsonRequest("/api/manage/storage", "DELETE", undefined, t.admin, { id: "2" }));
    expect(res.status).toBe(400);

    // 被引用后端
    vi.mocked(getStorageBackend).mockResolvedValue(backend({ id: 2, name: "云", type: "s3", is_default: 0 }));
    vi.mocked(countUsersByStorageId).mockResolvedValue(3);
    res = await DELETE(makeJsonRequest("/api/manage/storage", "DELETE", undefined, t.admin, { id: "2" }));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ error: expect.stringContaining("3") });

    // 无引用可删
    vi.mocked(countUsersByStorageId).mockResolvedValue(0);
    res = await DELETE(makeJsonRequest("/api/manage/storage", "DELETE", undefined, t.admin, { id: "2" }));
    expect(res.status).toBe(200);
    expect(deleteStorageBackend).toHaveBeenCalledWith(2);
  });

  it("设默认：未配置凭据的 S3 后端不可设为默认", async () => {
    const t = await tokens();
    vi.mocked(getStorageBackend).mockResolvedValue(backend({ id: 2, name: "云", type: "s3", is_default: 0 }));
    // 环境变量未配置（测试环境无 S3_2_*）
    const res = await PATCH(makeJsonRequest("/api/manage/storage", "PATCH", { id: 2 }, t.admin));
    expect(res.status).toBe(400);
    expect(setDefaultStorageBackend).not.toHaveBeenCalled();
  });
});

// ---------- 签名端点权限 ----------
describe("签名端点越权防护（#111 私有读写）", () => {
  const OWNER = {
    id: 7,
    user_code: "202505050102",
    role: "student",
    name: "本人",
    class_id: 1,
    avatar_url: "avatar_me.jpg",
    evaluation_url: "eval_me.jpg",
    storage_id: 1,
  };
  const OTHER = { ...OWNER, id: 8, user_code: "202505050103", name: "他人", avatar_url: "avatar_other.jpg" };

  it("未登录 → 401；未知文件 → 404", async () => {
    let res = await SIGN(makeJsonRequest("/api/shared/storage-sign", "GET", undefined, undefined, { url: "x.jpg" }));
    expect(res.status).toBe(401);

    const t = await tokens();
    vi.mocked(getAllSubmitted).mockResolvedValue([]);
    res = await SIGN(makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.student, { url: "x.jpg" }));
    expect(res.status).toBe(404);
  });

  it("学生取他人文件 → 403；取本人文件 → 回显本地路径", async () => {
    const t = await tokens();
    vi.mocked(getAllSubmitted).mockResolvedValue([OWNER as never, OTHER as never]);

    let res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.student, { url: "avatar_other.jpg" })
    );
    expect(res.status).toBe(403);

    vi.mocked(getStorageBackend).mockResolvedValue(backend({ id: 1 }));
    res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.student, { url: "avatar_me.jpg" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "avatar_me.jpg" });
  });

  it("教师跨班级 → 403；管辖班级 → 放行", async () => {
    const t = await tokens();
    vi.mocked(getAllSubmitted).mockResolvedValue([OWNER as never]);

    // 教师（uid=3）不辖 1 班
    vi.mocked(getTeacherClassPairs).mockResolvedValue([{ id: 1, teacher_id: 3, class_id: 2, created_at: "" }]);
    let res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.teacher, { url: "avatar_me.jpg" })
    );
    expect(res.status).toBe(403);

    // 辖 1 班 → 本地后端回显
    vi.mocked(getTeacherClassPairs).mockResolvedValue([{ id: 1, teacher_id: 3, class_id: 1, created_at: "" }]);
    vi.mocked(getStorageBackend).mockResolvedValue(backend({ id: 1 }));
    res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.teacher, { url: "avatar_me.jpg" })
    );
    expect(res.status).toBe(200);
  });

  it("云后端：以归属记录的 storage_id 签发签名 URL（含缓存参数原样匹配，签发时去除）", async () => {
    const t = await tokens();
    // DB 中存的引用含前端缓存破坏参数，签发请求传原值才能命中归属（防遍历）
    const cloudOwner = { ...OWNER, storage_id: 2, avatar_url: "avatar_me.jpg?t=1" };
    vi.mocked(getAllSubmitted).mockResolvedValue([cloudOwner as never]);
    vi.mocked(getStorageBackend).mockResolvedValue(
      backend({ id: 2, name: "云", type: "s3", endpoint: "https://e", region: "r", bucket: "b", is_default: 0 })
    );
    const res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.admin, { url: "avatar_me.jpg?t=1" })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.url).toBe("https://signed.example.com/key");
    // 去查询参数后签发
    expect(fakeStorage.getSignedUrl).toHaveBeenCalledWith("avatar_me.jpg");
  });

  it("历史版本文件（仅存在于 profile_submissions）→ 学生本人可签发，他人 403（#95）", async () => {
    const t = await tokens();
    // users 表已更新（当前档案不含旧文件），快照表反查命中本人历史版本
    vi.mocked(getAllSubmitted).mockResolvedValue([]);
    vi.mocked(getProfileSubmissionOwnerByFileUrl).mockResolvedValue({
      user_id: 7,
      class_id: 1,
      storage_id: 1,
    });
    vi.mocked(getStorageBackend).mockResolvedValue(backend({ id: 1 }));

    // 他人（uid=8）请求 → 403
    const other = { auth_token: await signToken({ role: "student", uid: 8, name: "他人" }) };
    let res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, other, { url: "old_avatar.jpg" })
    );
    expect(res.status).toBe(403);

    // 本人（uid=7）→ 200 回显
    res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.student, { url: "old_avatar.jpg" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "old_avatar.jpg" });
    // 快照反查确已发生
    expect(getProfileSubmissionOwnerByFileUrl).toHaveBeenCalledWith("old_avatar.jpg");
  });

  it("缩略图 key（#118）：剥除 _thumb 还原原 key 定位归属，签发对象为缩略图 key", async () => {
    const t = await tokens();
    // 本用例不涉及历史快照，快照反查显式置空（clearAllMocks 不清 mockResolvedValue 实现）
    vi.mocked(getProfileSubmissionOwnerByFileUrl).mockResolvedValue(undefined);
    // users 表引用原图，请求的是派生缩略图 key
    vi.mocked(getAllSubmitted).mockResolvedValue([{ ...OWNER, avatar_url: "avatar_me.jpg" } as never]);
    vi.mocked(getStorageBackend).mockResolvedValue(backend({ id: 1 }));

    // 本人请求缩略图 → 200 回显缩略图路径
    let res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.student, { url: "avatar_me_thumb.jpg" })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ url: "avatar_me_thumb.jpg" });

    // 他人 → 403
    const other = { auth_token: await signToken({ role: "student", uid: 8, name: "他人" }) };
    res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, other, { url: "avatar_me_thumb.jpg" })
    );
    expect(res.status).toBe(403);

    // 伪造缩略图 key（原 key 不在 DB）→ 404
    res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.student, { url: "nope_thumb.jpg" })
    );
    expect(res.status).toBe(404);

    // 云后端：签发对象为缩略图 key
    vi.mocked(getStorageBackend).mockResolvedValue(
      backend({ id: 2, name: "云", type: "s3", endpoint: "https://e", region: "r", bucket: "b", is_default: 0 })
    );
    res = await SIGN(
      makeJsonRequest("/api/shared/storage-sign", "GET", undefined, t.student, { url: "avatar_me_thumb.jpg" })
    );
    expect(res.status).toBe(200);
    expect(fakeStorage.getSignedUrl).toHaveBeenCalledWith("avatar_me_thumb.jpg");
  });
});

// ---------- 迁移 ----------
describe("本地 → 云迁移端点", () => {
  it("目标校验：缺参数 400 / 不存在 404 / 非 s3 拒绝 400", async () => {
    const t = await tokens();
    let res = await MIGRATE(makeJsonRequest("/api/manage/storage/migrate", "POST", {}, t.admin));
    expect(res.status).toBe(400);

    vi.mocked(listStorageBackends).mockResolvedValue([backend(), backend({ id: 9, name: "无", type: "s3" })]);
    res = await MIGRATE(makeJsonRequest("/api/manage/storage/migrate", "POST", { targetId: 5 }, t.admin));
    expect(res.status).toBe(404);

    // 目标是本地类型 → 拒绝
    vi.mocked(listStorageBackends).mockResolvedValue([backend(), backend({ id: 3, name: "另一个本地", type: "local", is_default: 0 })]);
    res = await MIGRATE(makeJsonRequest("/api/manage/storage/migrate", "POST", { targetId: 3 }, t.admin));
    expect(res.status).toBe(400);
  });

  it("迁移成功：代理路径转对象 key，引用与归属更新", async () => {
    const t = await tokens();
    vi.mocked(listStorageBackends).mockResolvedValue([
      backend({ id: 1 }),
      backend({ id: 2, name: "云", type: "s3", endpoint: "https://e", region: "r", bucket: "b", is_default: 0 }),
    ]);
    vi.mocked(getUsersByStorageId).mockResolvedValue([
      {
        id: 10,
        user_code: "202505050101",
        password_hash: null,
        role: "student",
        name: "张三",
        class_id: 1,
        tags: "[]",
        avatar_url: "/api/uploads/avatar_a.jpg?t=1",
        evaluation_url: "",
        submitted_at: "",
        created_at: "",
        storage_id: 1,
      },
    ]);

    const res = await MIGRATE(makeJsonRequest("/api/manage/storage/migrate", "POST", { targetId: 2 }, t.admin));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.migrated).toBe(1);
    expect(fakeStorage.upload).toHaveBeenCalledWith("avatar_a.jpg", expect.any(Buffer), "image/jpeg");
    expect(updateUserStorageRef).toHaveBeenCalledWith(10, 2, "avatar_a.jpg", "");
  });

  it("幂等：目标已存在对象则跳过上传，仅更新引用", async () => {
    const t = await tokens();
    vi.mocked(listStorageBackends).mockResolvedValue([
      backend({ id: 1 }),
      backend({ id: 2, name: "云", type: "s3", endpoint: "https://e", region: "r", bucket: "b", is_default: 0 }),
    ]);
    vi.mocked(getUsersByStorageId).mockResolvedValue([
      {
        id: 10,
        user_code: "202505050101",
        password_hash: null,
        role: "student",
        name: "张三",
        class_id: 1,
        tags: "[]",
        avatar_url: "/api/uploads/avatar_a.jpg",
        evaluation_url: null,
        submitted_at: "",
        created_at: "",
        storage_id: 1,
      },
    ]);
    fakeStorage.exists.mockResolvedValue(true);

    const res = await MIGRATE(makeJsonRequest("/api/manage/storage/migrate", "POST", { targetId: 2 }, t.admin));
    const body = await res.json();
    expect(body.skippedObjects).toBe(1);
    expect(fakeStorage.upload).not.toHaveBeenCalled();
    expect(updateUserStorageRef).toHaveBeenCalledWith(10, 2, "avatar_a.jpg", null);
  });

  it("单文件上传失败：该用户不改引用，整体不中断", async () => {
    const t = await tokens();
    vi.mocked(listStorageBackends).mockResolvedValue([
      backend({ id: 1 }),
      backend({ id: 2, name: "云", type: "s3", endpoint: "https://e", region: "r", bucket: "b", is_default: 0 }),
    ]);
    vi.mocked(getUsersByStorageId).mockResolvedValue([
      {
        id: 10,
        user_code: "202505050101",
        password_hash: null,
        role: "student",
        name: "张三",
        class_id: 1,
        tags: "[]",
        avatar_url: "/api/uploads/avatar_a.jpg",
        evaluation_url: null,
        submitted_at: "",
        created_at: "",
        storage_id: 1,
      },
    ]);
    fakeStorage.upload.mockRejectedValue(new Error("网络异常"));

    const res = await MIGRATE(makeJsonRequest("/api/manage/storage/migrate", "POST", { targetId: 2 }, t.admin));
    const body = await res.json();
    expect(body.failed).toBe(1);
    expect(body.migrated).toBe(0);
    expect(updateUserStorageRef).not.toHaveBeenCalled();
    expect(body.errors[0].userCode).toBe("202505050101");
  });
});

// ---------- 档案配置：上传大小上限 ----------
describe("档案配置端点：上传大小上限（#111）", () => {
  beforeEach(() => {
    vi.mocked(getMaxCustomTags).mockResolvedValue(6);
    vi.mocked(getSubmissionDeadline).mockResolvedValue(null);
    vi.mocked(getMaxAvatarSizeMb).mockResolvedValue(5);
    vi.mocked(getMaxEvaluationSizeMb).mockResolvedValue(10);
    vi.mocked(getMaxProfileSubmissions).mockResolvedValue(10);
  });

  it("GET 返回大小上限默认值", async () => {
    const res = await CONFIG_GET();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.maxAvatarSizeMb).toBe(5);
    expect(body.maxEvaluationSizeMb).toBe(10);
  });

  it("PUT：合法值写入，非法值 400", async () => {
    const t = await tokens();

    let res = await CONFIG_PUT(
      makeJsonRequest("/api/manage/profile-config", "PUT", { maxAvatarSizeMb: 99 }, t.admin)
    );
    expect(res.status).toBe(400);
    expect(setProfileConfig).not.toHaveBeenCalled();

    res = await CONFIG_PUT(
      makeJsonRequest("/api/manage/profile-config", "PUT", { maxAvatarSizeMb: 8, maxEvaluationSizeMb: 12 }, t.admin)
    );
    expect(res.status).toBe(200);
    expect(setProfileConfig).toHaveBeenCalledWith("max_avatar_size_mb", "8");
    expect(setProfileConfig).toHaveBeenCalledWith("max_evaluation_size_mb", "12");
  });
});
