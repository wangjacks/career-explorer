import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库层：本测试锁定 PUT /api/manage/students 的班级绑定契约（#161 前置校验依赖此形状）
vi.mock("@/lib/db", () => ({
  getStudents: vi.fn(),
  insertUser: vi.fn(),
  getUserByCode: vi.fn(),
  updateUser: vi.fn(),
  deleteStudents: vi.fn(),
  getClassByName: vi.fn(),
  // @/lib/audit 经 getAuditActor / recordAudit 使用
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { PUT } from "@/app/api/manage/students/route";
import { getUserByCode, updateUser, getClassByName, insertAuditLog, getUserById } from "@/lib/db";
import type { ClassRow, UserRow } from "@/lib/db";

const STUDENT = {
  id: 7,
  user_code: "202505050101",
  password_hash: "hash",
  role: "student",
  name: "测试学生",
  class_id: 3,
  tags: null,
  avatar_url: null,
  evaluation_url: null,
  submitted_at: null,
  created_at: "",
  storage_id: 1,
};

const CLASS_5 = { id: 5, name: "2025级1班" } as unknown as ClassRow;

function createPutRequest(body: unknown, cookies?: Record<string, string>): NextRequest {
  const url = new URL("/api/manage/students", "http://localhost:3000");
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method: "PUT",
    headers: {
      "Content-Type": "application/json",
      ...(cookieHeader ? { cookie: cookieHeader } : {}),
    },
    body: JSON.stringify(body),
  });
}

async function adminCookies() {
  return { auth_token: await signToken({ role: "admin", uid: 1, name: "管理员" }) };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserByCode).mockResolvedValue(STUDENT as unknown as UserRow);
  vi.mocked(getUserById).mockResolvedValue({ user_code: "10001", name: "管理员", role: "admin" } as unknown as UserRow);
});

describe("PUT /api/manage/students — 班级绑定契约（#161）", () => {
  it("班级名存在 → 按解析出的 id 绑定", async () => {
    vi.mocked(getClassByName).mockResolvedValue(CLASS_5);
    const res = await PUT(
      createPutRequest({ studentId: "202505050101", className: "2025级1班" }, await adminCookies())
    );
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(STUDENT.id, { class_id: 5 });
  });

  it("className 为空串 → 解绑为未分班（class_id 写入 null，批量清空的依赖路径）", async () => {
    const res = await PUT(
      createPutRequest({ studentId: "202505050101", className: "" }, await adminCookies())
    );
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(STUDENT.id, { class_id: null });
    expect(getClassByName).not.toHaveBeenCalled();
  });

  it("班级不存在 → 400 且不写库，并落一条 failed 审计（前端前置校验要避免的 N 倍噪声）", async () => {
    vi.mocked(getClassByName).mockResolvedValue(undefined);
    const res = await PUT(
      createPutRequest({ studentId: "202505050101", className: "不存在的班" }, await adminCookies())
    );
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toBe("班级不存在");
    expect(updateUser).not.toHaveBeenCalled();
    const failed = vi
      .mocked(insertAuditLog)
      .mock.calls.map(([a]) => a)
      .find((a) => a.action === "student:update" && a.status === "failed");
    expect(failed).toBeTruthy();
  });

  it("只改姓名、不传 className → fields 不含 class_id（不改归属）", async () => {
    const res = await PUT(
      createPutRequest({ studentId: "202505050101", name: "改名后" }, await adminCookies())
    );
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(STUDENT.id, { name: "改名后" });
    const fields = vi.mocked(updateUser).mock.calls[0][1];
    expect(Object.keys(fields)).not.toContain("class_id");
  });

  it("成功绑定同样落审计，且 metadata 记录新旧 class_id 快照", async () => {
    vi.mocked(getClassByName).mockResolvedValue(CLASS_5);
    await PUT(
      createPutRequest({ studentId: "202505050101", className: "2025级1班" }, await adminCookies())
    );
    const success = vi
      .mocked(insertAuditLog)
      .mock.calls.map(([a]) => a)
      .find((a) => a.action === "student:update" && a.status === "success");
    expect(success).toBeTruthy();
    expect(JSON.parse(success?.metadata ?? "{}").old.class_id).toBe(3);
    expect(JSON.parse(success?.metadata ?? "{}").new.class_id).toBe(5);
  });
});
