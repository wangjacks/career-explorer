import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库层：档案端点的安全测试只关注鉴权与参数策略
vi.mock("@/lib/db", () => ({
  getUserById: vi.fn(),
  getActiveTags: vi.fn(),
  submitProfileWithVersion: vi.fn(async () => ({ version: 1 })),
  getClasses: vi.fn(),
  getTags: vi.fn(),
  getMaxCustomTags: vi.fn(),
  getSubmissionDeadline: vi.fn(),
  isSubmissionClosed: vi.fn(),
  insertAuditLog: vi.fn(),
  getStorageBackend: vi.fn(),
  getDefaultStorageBackend: vi.fn(),
}));

import { POST, GET } from "@/app/api/shared/profile/route";
import { getUserById, getActiveTags, submitProfileWithVersion, getMaxCustomTags, getClasses, getSubmissionDeadline, isSubmissionClosed, getDefaultStorageBackend } from "@/lib/db";
import type { StorageBackendRow } from "@/lib/db";

function createPostRequest(body: unknown, cookies?: Record<string, string>): NextRequest {
  const url = new URL("/api/shared/profile", "http://localhost:3000");
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

const STUDENT_USER = {
  id: 7,
  user_code: "202505050102",
  password_hash: "hash",
  role: "student",
  name: "测试学生",
  class_id: 1,
  tags: null,
  avatar_url: null,
  evaluation_url: null,
  submitted_at: null,
  created_at: "",
  storage_id: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  // 默认存储后端：内置本地后端（id=1）
  vi.mocked(getDefaultStorageBackend).mockResolvedValue({ id: 1 } as unknown as StorageBackendRow);
});

describe("POST /api/shared/profile — 快速提交下线后的安全收紧（#92）", () => {
  it("未登录（无 token）→ 401 拒绝", async () => {
    const res = await POST(createPostRequest({ tags: ["阅读"] }));
    expect(res.status).toBe(401);
    const body = await res.json();
    expect(body.error).toBe("请先登录");
  });

  it("无效 token → 401 拒绝", async () => {
    const res = await POST(
      createPostRequest({ tags: ["阅读"] }, { auth_token: "invalid-token" })
    );
    expect(res.status).toBe(401);
  });

  it("非学生角色（教师）→ 403，档案保存仅限学生本人", async () => {
    const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
    const res = await POST(createPostRequest({ tags: ["阅读"] }, { auth_token: token }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("仅学生本人可提交档案");
  });

  it("显式指定他人学号 → 400 拒绝（核心漏洞防护：无法覆盖他人数据）", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "测试学生" });
    vi.mocked(getUserById).mockResolvedValue(STUDENT_USER);
    const res = await POST(
      createPostRequest(
        { studentId: "999999999999", tags: ["阅读"] },
        { auth_token: token }
      )
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("不支持指定学号，档案保存仅限本人操作");
    expect(submitProfileWithVersion).not.toHaveBeenCalled();
  });

  it("学生本人会话 + 不传学号 → 标签文本直存，归属本人学号（#94）", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "测试学生" });
    vi.mocked(getUserById).mockResolvedValue(STUDENT_USER);
    vi.mocked(getActiveTags).mockResolvedValue([
      { id: 1, name: "兴趣", type: "category", parent_id: null, class_id: 0, category_order: 0, sort_order: 0, active: 1 },
      { id: 2, name: "阅读", type: "tag", parent_id: 1, class_id: 0, category_order: 0, sort_order: 0, active: 1 },
    ]);
    vi.mocked(getMaxCustomTags).mockResolvedValue(6);
    const res = await POST(createPostRequest({ tags: ["阅读", "自定义爱好"] }, { auth_token: token }));
    expect(res.status).toBe(200);
    // 文本直存：预设 + 自定义均按名称存入（去空去重后的 JSON 数组）
    expect(submitProfileWithVersion).toHaveBeenCalledWith("202505050102", JSON.stringify(["阅读", "自定义爱好"]), "", "", 1);
  });

  it("自定义标签超过配置上限 → 400 拒绝（#94）", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "测试学生" });
    vi.mocked(getUserById).mockResolvedValue(STUDENT_USER);
    vi.mocked(getActiveTags).mockResolvedValue([
      { id: 2, name: "阅读", type: "tag", parent_id: 1, class_id: 0, category_order: 0, sort_order: 0, active: 1 },
    ]);
    vi.mocked(getMaxCustomTags).mockResolvedValue(1);
    const res = await POST(
      createPostRequest({ tags: ["阅读", "自定义一", "自定义二"] }, { auth_token: token })
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("自定义标签最多 1 个，当前 2 个");
    expect(submitProfileWithVersion).not.toHaveBeenCalled();
  });
});

describe("POST /api/shared/profile — 提交时限强制拦截（#96）", () => {
  const mockSaveable = async () => {
    const token = await signToken({ role: "student", uid: 7, name: "测试学生" });
    vi.mocked(getUserById).mockResolvedValue(STUDENT_USER);
    vi.mocked(getActiveTags).mockResolvedValue([
      { id: 2, name: "阅读", type: "tag", parent_id: 1, class_id: 0, category_order: 0, sort_order: 0, active: 1 },
    ]);
    vi.mocked(getMaxCustomTags).mockResolvedValue(6);
    return token;
  };

  it("已超过截止时间 → 403 拒绝，数据库未写入", async () => {
    const token = await mockSaveable();
    vi.mocked(isSubmissionClosed).mockResolvedValue(true);
    const res = await POST(createPostRequest({ tags: ["阅读"] }, { auth_token: token }));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.error).toBe("档案提交已截止，无法保存");
    expect(submitProfileWithVersion).not.toHaveBeenCalled();
  });

  it("已设置截止时间但未过期 → 正常保存", async () => {
    const token = await mockSaveable();
    vi.mocked(isSubmissionClosed).mockResolvedValue(false);
    const res = await POST(createPostRequest({ tags: ["阅读"] }, { auth_token: token }));
    expect(res.status).toBe(200);
    expect(submitProfileWithVersion).toHaveBeenCalled();
  });

  it("未设置截止时间（默认不限制）→ 正常保存", async () => {
    const token = await mockSaveable();
    // 默认 mock 返回 undefined（未设置），等同不限制；显式断言未拦截
    const res = await POST(createPostRequest({ tags: ["阅读"] }, { auth_token: token }));
    expect(res.status).toBe(200);
    expect(submitProfileWithVersion).toHaveBeenCalled();
  });

  it("截止时间已清除 → 正常保存", async () => {
    const token = await mockSaveable();
    vi.mocked(isSubmissionClosed).mockResolvedValue(false);
    const res = await POST(createPostRequest({ tags: ["阅读"] }, { auth_token: token }));
    expect(res.status).toBe(200);
  });
});

describe("GET /api/shared/profile — 会话查询", () => {
  it("未登录 → 401", async () => {
    const url = new URL("/api/shared/profile", "http://localhost:3000");
    const res = await GET(new NextRequest(url, { method: "GET" }));
    expect(res.status).toBe(401);
  });

  it("非学生角色 → 403", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const url = new URL("/api/shared/profile", "http://localhost:3000");
    const res = await GET(
      new NextRequest(url, { method: "GET", headers: { cookie: `auth_token=${token}` } })
    );
    expect(res.status).toBe(403);
  });

  it("学生本人查询 → 响应含提交时限字段（#96）", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "测试学生" });
    vi.mocked(getUserById).mockResolvedValue(STUDENT_USER);
    vi.mocked(getClasses).mockResolvedValue([]);
    vi.mocked(getSubmissionDeadline).mockResolvedValue(null);
    vi.mocked(isSubmissionClosed).mockResolvedValue(false);
    const url = new URL("/api/shared/profile", "http://localhost:3000");
    const res = await GET(
      new NextRequest(url, { method: "GET", headers: { cookie: `auth_token=${token}` } })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect("submissionDeadline" in body).toBe(true);
    expect("submissionClosed" in body).toBe(true);
  });
});
