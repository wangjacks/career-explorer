import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库层：审计查询端点测试只关注权限分流与参数校验
vi.mock("@/lib/db", () => ({
  queryAuditLogs: vi.fn(),
  insertAuditLog: vi.fn(),
  getUserById: vi.fn(),
}));

import { GET } from "@/app/api/manage/audit-logs/route";
import { queryAuditLogs, insertAuditLog, getUserById } from "@/lib/db";

function createGetRequest(params: Record<string, string> = {}, cookies?: Record<string, string>): NextRequest {
  const url = new URL("/api/manage/audit-logs", "http://localhost:3000");
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method: "GET",
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(queryAuditLogs).mockResolvedValue({ rows: [], total: 0 });
  vi.mocked(getUserById).mockResolvedValue({
    id: 1,
    user_code: "10001",
    password_hash: "hash",
    role: "admin",
    name: "管理员",
    class_id: null,
    tags: null,
    avatar_url: null,
    evaluation_url: null,
    submitted_at: null,
    created_at: "",
    storage_id: 1,
  });
});

describe("GET /api/manage/audit-logs — 权限分流（#110）", () => {
  it("未登录 → 401", async () => {
    const res = await GET(createGetRequest());
    expect(res.status).toBe(401);
  });

  it("学生角色 → 403（仅 admin/teacher 可查审计）", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "测试学生" });
    const res = await GET(createGetRequest({}, { auth_token: token }));
    expect(res.status).toBe(403);
  });

  it("admin 查询不带强制操作者筛选", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await GET(createGetRequest({}, { auth_token: token }));
    expect(res.status).toBe(200);
    const filters = vi.mocked(queryAuditLogs).mock.calls[0][0];
    expect(filters.actorId).toBeUndefined();
  });

  it("teacher 强制注入 actorId = 本人（前端伪造筛选无效）", async () => {
    const token = await signToken({ role: "teacher", uid: 3, name: "测试教师" });
    // 伪造查询他人记录的参数
    const res = await GET(createGetRequest({ actor: "管理员", role: "admin" }, { auth_token: token }));
    expect(res.status).toBe(200);
    const filters = vi.mocked(queryAuditLogs).mock.calls[0][0];
    expect(filters.actorId).toBe(3);
  });

  it("查询自身被审计（audit:query 写入）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    await GET(createGetRequest({}, { auth_token: token }));
    expect(insertAuditLog).toHaveBeenCalled();
    const log = vi.mocked(insertAuditLog).mock.calls[0][0];
    expect(log.action).toBe("audit:query");
  });
});

describe("GET /api/manage/audit-logs — 参数校验", () => {
  it("非法分页参数 → 400", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await GET(createGetRequest({ page: "0" }, { auth_token: token }));
    expect(res.status).toBe(400);
  });

  it("pageSize 超上限 → 400", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await GET(createGetRequest({ pageSize: "999" }, { auth_token: token }));
    expect(res.status).toBe(400);
  });

  it("合法筛选参数透传", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await GET(
      createGetRequest(
        { page: "2", pageSize: "10", action: "student:create", status: "failed", from: "2026-08-01" },
        { auth_token: token }
      )
    );
    expect(res.status).toBe(200);
    const filters = vi.mocked(queryAuditLogs).mock.calls[0][0];
    expect(filters.page).toBe(2);
    expect(filters.pageSize).toBe(10);
    expect(filters.action).toBe("student:create");
    expect(filters.status).toBe("failed");
    expect(filters.from).toBe("2026-08-01");
  });
});
