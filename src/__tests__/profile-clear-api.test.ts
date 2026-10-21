import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库层：本组用例锁定档案清除的班级归属与审计边界（#243）
vi.mock("@/lib/db", () => ({
  getSubmittedProfiles: vi.fn(),
  clearSubmissions: vi.fn(async () => 1),
  getAssessmentByCode: vi.fn(),
  getCurrentAssessmentResultsByUserCodes: vi.fn(),
  getStudents: vi.fn(async () => []),
  getUserById: vi.fn(async () => ({ user_code: "20001", name: "张教师", role: "teacher" })),
  getTeacherClassPairs: vi.fn(async () => []),
  insertAuditLog: vi.fn(async () => undefined),
}));

import { DELETE } from "@/app/api/manage/profiles/route";
import {
  clearSubmissions,
  getStudents,
  getTeacherClassPairs,
  getUserById,
  insertAuditLog,
  type UserRow,
} from "@/lib/db";

/** 教师 uid=3 只带 class 7；class 9 是别人的班 */
const OWN_STUDENT = {
  id: 21,
  user_code: "202505050101",
  name: "甲",
  role: "student",
  class_id: 7,
} as unknown as UserRow;
const FOREIGN_STUDENT = {
  id: 22,
  user_code: "202505050102",
  name: "乙",
  role: "student",
  class_id: 9,
} as unknown as UserRow;
const UNASSIGNED_STUDENT = {
  id: 23,
  user_code: "202505050103",
  name: "丙",
  role: "student",
  class_id: null,
} as unknown as UserRow;

const TEACHER = { id: 3, user_code: "20001", name: "张教师", role: "teacher" } as unknown as UserRow;
const ADMIN = { id: 1, user_code: "10001", name: "管理员", role: "admin" } as unknown as UserRow;

const PROFILES_URL = "http://localhost:3000/api/manage/profiles";

function makeRequest(body: unknown, cookie: string): NextRequest {
  return new NextRequest(new URL(PROFILES_URL), {
    method: "DELETE",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

function makeRawRequest(body: string, cookie: string): NextRequest {
  return new NextRequest(new URL(PROFILES_URL), {
    method: "DELETE",
    headers: { "Content-Type": "application/json", cookie },
    body,
  });
}

async function cookies(role: "admin" | "teacher", uid: number) {
  return `auth_token=${await signToken({ role, uid, name: role === "admin" ? "管理员" : "张教师" })}`;
}

/** 等待 void recordAudit(...) 的异步写入落到 mock 上 */
const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

function lastAudit() {
  const calls = vi.mocked(insertAuditLog).mock.calls;
  return calls[calls.length - 1]?.[0];
}

function auditMetadata() {
  return JSON.parse(String(lastAudit()?.metadata));
}

function profilesFailureAudit() {
  return expect.objectContaining({
    action: "profile:clear",
    path: "/api/manage/profiles",
    resource_type: "profile",
    status: "failed",
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStudents).mockResolvedValue([OWN_STUDENT, FOREIGN_STUDENT, UNASSIGNED_STUDENT]);
  vi.mocked(getTeacherClassPairs).mockResolvedValue([
    { id: 1, teacher_id: 3, class_id: 7, created_at: "" },
  ]);
  vi.mocked(clearSubmissions).mockResolvedValue(1);
  vi.mocked(getUserById).mockImplementation(async (id: number) => (id === ADMIN.id ? ADMIN : TEACHER));
});

describe("DELETE /api/manage/profiles — 班级归属与审计（#243）", () => {
  it("教师清除本人管辖班级学生 → 200，落成功审计且 metadata 只含学号与条数", async () => {
    const res = await DELETE(makeRequest({ ids: [OWN_STUDENT.user_code] }, await cookies("teacher", 3)));

    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ deleted: 1 });
    expect(clearSubmissions).toHaveBeenCalledWith([OWN_STUDENT.user_code]);

    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "profile:clear",
        method: "DELETE",
        path: "/api/manage/profiles",
        resource_type: "profile",
        status: "success",
        actor_id: 3,
        actor_role: "teacher",
      })
    );
    const metadata = auditMetadata();
    expect(metadata).toEqual({ requested: 1, ids: [OWN_STUDENT.user_code], deleted: 1 });
    // 学生档案内容（标签文本、图片地址）绝不进审计
    expect(JSON.stringify(metadata)).not.toMatch(/tags|avatar|evaluation/i);
  });

  it("教师清除其他班级学生 → 403，不落写入，记失败审计", async () => {
    const res = await DELETE(makeRequest({ ids: [FOREIGN_STUDENT.user_code] }, await cookies("teacher", 3)));

    expect(res.status).toBe(403);
    expect(clearSubmissions).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(profilesFailureAudit());
    expect(lastAudit()?.error_message).toContain("不在你管理的班级");
    expect(auditMetadata()).toEqual({ requested: 1, missing: 0, foreign: 1 });
  });

  it("教师清除未分班学生 → 403（未分班学生只有管理员能清除）", async () => {
    const res = await DELETE(
      makeRequest({ ids: [UNASSIGNED_STUDENT.user_code] }, await cookies("teacher", 3))
    );

    expect(res.status).toBe(403);
    expect(clearSubmissions).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(profilesFailureAudit());
  });

  it("教师批量混入越界学生 → 整批 403，不出现部分删除", async () => {
    const res = await DELETE(
      makeRequest(
        { ids: [OWN_STUDENT.user_code, FOREIGN_STUDENT.user_code] },
        await cookies("teacher", 3)
      )
    );

    expect(res.status).toBe(403);
    expect(clearSubmissions).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(profilesFailureAudit());
    expect(auditMetadata()).toEqual({ requested: 2, missing: 0, foreign: 1 });
  });

  it("不在册 id 不再被静默忽略：教师按越界处理并整批拒绝", async () => {
    const res = await DELETE(
      makeRequest({ ids: [OWN_STUDENT.user_code, "999999999999"] }, await cookies("teacher", 3))
    );

    expect(res.status).toBe(403);
    expect(clearSubmissions).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(profilesFailureAudit());
    expect(auditMetadata()).toEqual({ requested: 2, missing: 1, foreign: 0 });
  });

  it("管理员清除他班 / 未分班学生 → 200（不受班级归属限制）", async () => {
    vi.mocked(clearSubmissions).mockResolvedValue(2);
    const res = await DELETE(
      makeRequest(
        { ids: [FOREIGN_STUDENT.user_code, UNASSIGNED_STUDENT.user_code] },
        await cookies("admin", 1)
      )
    );

    expect(res.status).toBe(200);
    expect(clearSubmissions).toHaveBeenCalledWith([
      FOREIGN_STUDENT.user_code,
      UNASSIGNED_STUDENT.user_code,
    ]);
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "profile:clear", status: "success", actor_role: "admin" })
    );
    expect(auditMetadata()).toMatchObject({ requested: 2, deleted: 2 });
  });

  it("管理员传不在册 id → 404，不静默跳过也不部分删除", async () => {
    const res = await DELETE(
      makeRequest({ ids: [OWN_STUDENT.user_code, "999999999999"] }, await cookies("admin", 1))
    );

    expect(res.status).toBe(404);
    expect(clearSubmissions).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(profilesFailureAudit());
    expect(lastAudit()?.error_message).toContain("不存在");
    expect(auditMetadata()).toEqual({ requested: 2, missing: 1 });
  });

  it("重复学号按去重后的目标集合清除与审计", async () => {
    const res = await DELETE(
      makeRequest({ ids: [OWN_STUDENT.user_code, OWN_STUDENT.user_code] }, await cookies("teacher", 3))
    );

    expect(res.status).toBe(200);
    expect(clearSubmissions).toHaveBeenCalledWith([OWN_STUDENT.user_code]);
    await flushAudit();
    expect(auditMetadata()).toEqual({ requested: 1, ids: [OWN_STUDENT.user_code], deleted: 1 });
  });

  it("空 ids → 400，不查名单也不落写入", async () => {
    const res = await DELETE(makeRequest({ ids: [] }, await cookies("teacher", 3)));

    expect(res.status).toBe(400);
    expect(getStudents).not.toHaveBeenCalled();
    expect(clearSubmissions).not.toHaveBeenCalled();
  });

  it("非法 JSON → 400（不落成 500）", async () => {
    const res = await DELETE(makeRawRequest("{not-json", await cookies("teacher", 3)));

    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("请求格式不正确");
    expect(clearSubmissions).not.toHaveBeenCalled();
  });

  it("无会话请求 → 401（路由自防御，不依赖 proxy）", async () => {
    const res = await DELETE(makeRequest({ ids: [OWN_STUDENT.user_code] }, "auth_token=not-a-token"));

    expect(res.status).toBe(401);
    expect(clearSubmissions).not.toHaveBeenCalled();
  });
});
