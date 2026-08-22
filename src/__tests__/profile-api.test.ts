import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库层：档案端点的安全测试只关注鉴权与参数策略
vi.mock("@/lib/db", () => ({
  getUserById: vi.fn(),
  getActiveTags: vi.fn(),
  upsertSubmission: vi.fn(),
  getClasses: vi.fn(),
  getTags: vi.fn(),
}));

import { POST, GET } from "@/app/api/shared/profile/route";
import { getUserById, getActiveTags, upsertSubmission } from "@/lib/db";

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
};

beforeEach(() => {
  vi.clearAllMocks();
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
    expect(upsertSubmission).not.toHaveBeenCalled();
  });

  it("学生本人会话 + 不传学号 → 保存成功，归属本人学号", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "测试学生" });
    vi.mocked(getUserById).mockResolvedValue(STUDENT_USER);
    vi.mocked(getActiveTags).mockResolvedValue([
      { id: 1, name: "兴趣", type: "category", parent_id: null, class_id: 0, category_order: 0, sort_order: 0 },
      { id: 2, name: "阅读", type: "tag", parent_id: 1, class_id: 0, category_order: 0, sort_order: 0 },
    ]);
    const res = await POST(createPostRequest({ tags: ["阅读"] }, { auth_token: token }));
    expect(res.status).toBe(200);
    expect(upsertSubmission).toHaveBeenCalledWith("202505050102", expect.any(String), "", "");
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
});
