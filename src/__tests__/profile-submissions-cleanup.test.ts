import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库层：清理端点的安全与分发测试只关注鉴权与清理逻辑
vi.mock("@/lib/db", () => ({
  getUserById: vi.fn(),
  getProfileSubmissions: vi.fn(),
  getMaxProfileSubmissions: vi.fn(),
  getStudentsExceedingSubmissionLimit: vi.fn(),
  deleteOldestProfileSubmissions: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { POST } from "@/app/api/manage/profiles/submissions/cleanup/route";
import {
  getUserById,
  getProfileSubmissions,
  getMaxProfileSubmissions,
  getStudentsExceedingSubmissionLimit,
  deleteOldestProfileSubmissions,
} from "@/lib/db";

function createPostRequest(body: unknown, cookies?: Record<string, string>): NextRequest {
  const url = new URL("/api/manage/profiles/submissions/cleanup", "http://localhost:3000");
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

describe("cleanup 端点（#95）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("非 admin → 403", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "学生" });
    const res = await POST(createPostRequest({ userId: 7 }, { auth_token: token }));
    expect(res.status).toBe(403);
    expect(deleteOldestProfileSubmissions).not.toHaveBeenCalled();
  });

  it("单学生：超限则删除最旧版本至上限，返回剩余数", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getMaxProfileSubmissions).mockResolvedValue(3);
    vi.mocked(getUserById).mockResolvedValue({
      id: 7, user_code: "202505050102", role: "student", name: "本人",
    } as never);
    vi.mocked(getProfileSubmissions).mockResolvedValue([
      { id: 1 }, { id: 2 }, { id: 3 }, { id: 4 }, { id: 5 },
    ] as never);
    vi.mocked(deleteOldestProfileSubmissions).mockResolvedValue(2);

    const res = await POST(createPostRequest({ userId: 7 }, { auth_token: token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ deleted: 2, remaining: 3, maxVersions: 3 });
    expect(deleteOldestProfileSubmissions).toHaveBeenCalledWith(7, 2);
    // 未超限不触发删除
    vi.mocked(getProfileSubmissions).mockResolvedValue([{ id: 1 }, { id: 2 }] as never);
    vi.mocked(deleteOldestProfileSubmissions).mockClear();
    const res2 = await POST(createPostRequest({ userId: 7 }, { auth_token: token }));
    expect(res2.status).toBe(200);
    expect(deleteOldestProfileSubmissions).not.toHaveBeenCalled();
  });

  it("userId 非法 → 400；学生不存在 → 404", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    let res = await POST(createPostRequest({ userId: "abc" }, { auth_token: token }));
    expect(res.status).toBe(400);

    vi.mocked(getUserById).mockResolvedValue(undefined);
    res = await POST(createPostRequest({ userId: 99 }, { auth_token: token }));
    expect(res.status).toBe(404);
  });

  it("批量（无 userId）：一键清理全部超限学生，返回汇总", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getMaxProfileSubmissions).mockResolvedValue(3);
    vi.mocked(getStudentsExceedingSubmissionLimit).mockResolvedValue([
      { user_id: 7, user_code: "202505050102", name: "甲", class_id: 1, version_count: 5 },
      { user_id: 8, user_code: "202505050103", name: "乙", class_id: 1, version_count: 4 },
    ]);
    vi.mocked(deleteOldestProfileSubmissions).mockResolvedValue(1);

    const res = await POST(createPostRequest({}, { auth_token: token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ deleted: 2, studentsAffected: 2, maxVersions: 3 });
    expect(deleteOldestProfileSubmissions).toHaveBeenCalledTimes(2);
    expect(deleteOldestProfileSubmissions).toHaveBeenCalledWith(7, 2);
    expect(deleteOldestProfileSubmissions).toHaveBeenCalledWith(8, 1);
    // 无超限学生时不触发删除
    vi.mocked(getStudentsExceedingSubmissionLimit).mockResolvedValue([]);
    vi.mocked(deleteOldestProfileSubmissions).mockClear();
    const res2 = await POST(createPostRequest({}, { auth_token: token }));
    expect(res2.status).toBe(200);
    expect((await res2.json()).deleted).toBe(0);
    expect(deleteOldestProfileSubmissions).not.toHaveBeenCalled();
  });
});
