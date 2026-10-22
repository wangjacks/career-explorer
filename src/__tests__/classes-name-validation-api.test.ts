import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

vi.mock("@/lib/db", () => ({
  getClasses: vi.fn(),
  getClassByName: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  insertClass: vi.fn(),
  insertTeacherClass: vi.fn(),
  randomInviteCode: vi.fn(),
  updateClass: vi.fn(),
  deleteClass: vi.fn(),
  // @/lib/audit 经 getUserById / insertAuditLog 使用
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { POST } from "@/app/api/manage/classes/route";
import { PATCH } from "@/app/api/manage/classes/[id]/route";
import {
  getClassByName,
  getClasses,
  getUserById,
  insertAuditLog,
  insertClass,
  randomInviteCode,
  updateClass,
} from "@/lib/db";

function createRequest(
  method: "POST" | "PATCH",
  pathname: string,
  body: unknown,
  cookies?: Record<string, string>
): NextRequest {
  const url = new URL(pathname, "http://localhost:3000");
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method,
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
  vi.mocked(getUserById).mockResolvedValue(undefined);
  vi.mocked(insertAuditLog).mockResolvedValue(undefined);
  vi.mocked(getClasses).mockResolvedValue([]);
  vi.mocked(getClassByName).mockResolvedValue(undefined);
  vi.mocked(randomInviteCode).mockReturnValue("ABCD1234");
  vi.mocked(insertClass).mockResolvedValue(9);
  vi.mocked(updateClass).mockResolvedValue(undefined);
});

describe("POST /api/manage/classes — 保留名校验（#260）", () => {
  it.each(["未分班", "__unassigned__", "还没分班", " 未分班 "])(
    "拒绝保留名 %s，且不落库",
    async (name) => {
      const res = await POST(
        createRequest("POST", "/api/manage/classes", { name }, await adminCookies())
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "该班级名称为系统保留，请换一个名称" });
      expect(insertClass).not.toHaveBeenCalled();
    }
  );

  it("空名仍走原有校验", async () => {
    const res = await POST(
      createRequest("POST", "/api/manage/classes", { name: "   " }, await adminCookies())
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "请输入班级名称" });
    expect(insertClass).not.toHaveBeenCalled();
  });

  it("重名仍返回 409", async () => {
    vi.mocked(getClassByName).mockResolvedValue({ id: 3, name: "一班" } as never);
    const res = await POST(
      createRequest("POST", "/api/manage/classes", { name: "一班" }, await adminCookies())
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "班级名称已存在" });
    expect(insertClass).not.toHaveBeenCalled();
  });

  it("正常班级名创建成功", async () => {
    const res = await POST(
      createRequest("POST", "/api/manage/classes", { name: " 2025级1班 " }, await adminCookies())
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, id: 9 });
    expect(insertClass).toHaveBeenCalledWith("2025级1班", "ABCD1234");
  });
});

describe("PATCH /api/manage/classes/[id] — 保留名校验（#260）", () => {
  const params = { params: Promise.resolve({ id: "3" }) };

  it("改名到保留名被拒绝，且不更新", async () => {
    const res = await PATCH(
      createRequest("PATCH", "/api/manage/classes/3", { name: "未分班" }, await adminCookies()),
      params
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "该班级名称为系统保留，请换一个名称" });
    expect(updateClass).not.toHaveBeenCalled();
  });

  it("重名仍返回 409", async () => {
    vi.mocked(getClassByName).mockResolvedValue({ id: 4, name: "二班" } as never);
    const res = await PATCH(
      createRequest("PATCH", "/api/manage/classes/3", { name: "二班" }, await adminCookies()),
      params
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({ error: "班级名称已存在" });
    expect(updateClass).not.toHaveBeenCalled();
  });

  it("正常改名成功", async () => {
    vi.mocked(getClasses).mockResolvedValue([{ id: 3, name: "旧班" }] as never);
    const res = await PATCH(
      createRequest("PATCH", "/api/manage/classes/3", { name: "新班" }, await adminCookies()),
      params
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
    expect(updateClass).toHaveBeenCalledWith(3, { name: "新班" });
  });
});
