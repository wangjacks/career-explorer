import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库层：本组用例锁定教师写端点的班级归属边界（#171）
vi.mock("@/lib/db", () => ({
  getStudents: vi.fn(async () => []),
  getUserByCode: vi.fn(),
  getUsersByCodes: vi.fn(async () => []),
  getUserById: vi.fn(async () => ({ user_code: "20001", name: "张教师", role: "teacher" })),
  insertUser: vi.fn(async () => 5),
  updateUser: vi.fn(async () => undefined),
  deleteStudents: vi.fn(async () => 1),
  getClassByName: vi.fn(),
  getTeacherClassPairs: vi.fn(async () => [{ id: 1, teacher_id: 3, class_id: 7, created_at: "" }]),
  insertAuditLog: vi.fn(async () => undefined),
  // tags
  getTags: vi.fn(async () => []),
  insertTag: vi.fn(async () => 11),
  updateTag: vi.fn(async () => undefined),
  deleteTags: vi.fn(async () => undefined),
  resetTagsToDefaults: vi.fn(async () => undefined),
  // profile-config
  getMaxCustomTags: vi.fn(async () => 6),
  getSubmissionDeadline: vi.fn(async () => null),
  getMaxAvatarSizeMb: vi.fn(async () => 5),
  getMaxEvaluationSizeMb: vi.fn(async () => 10),
  getMaxProfileSubmissions: vi.fn(async () => 10),
  setProfileConfig: vi.fn(async () => undefined),
  MAX_AVATAR_SIZE_KEY: "max_avatar_size_mb",
  MAX_EVALUATION_SIZE_KEY: "max_evaluation_size_mb",
  MAX_PROFILE_SUBMISSIONS_KEY: "max_profile_submissions",
  SUBMISSION_DEADLINE_KEY: "submission_deadline",
}));

import { DELETE, POST, PUT } from "@/app/api/manage/students/route";
import { POST as BATCH_PASSWORD } from "@/app/api/manage/students/batch-password/route";
import { DELETE as TAGS_DELETE, PATCH as TAGS_PATCH, POST as TAGS_POST } from "@/app/api/manage/tags/route";
import { POST as TAGS_BATCH } from "@/app/api/manage/tags/batch/route";
import { POST as TAGS_RESTORE } from "@/app/api/manage/tags/restore/route";
import { PUT as PROFILE_CONFIG_PUT } from "@/app/api/manage/profile-config/route";
import {
  deleteStudents,
  getClassByName,
  getStudents,
  getTeacherClassPairs,
  getUserById,
  getUserByCode,
  getUsersByCodes,
  insertAuditLog,
  insertTag,
  insertUser,
  resetTagsToDefaults,
  setProfileConfig,
  updateTag,
  updateUser,
  type ClassRow,
  type UserRow,
} from "@/lib/db";

/** 教师 uid=3 只带 class 7；class 9 是别人的班 */
const OWN_CLASS = { id: 7, name: "2025级1班" } as unknown as ClassRow;
const FOREIGN_CLASS = { id: 9, name: "2025级2班" } as unknown as ClassRow;

const OWN_STUDENT = { id: 21, user_code: "202505050101", name: "甲", role: "student", class_id: 7 } as unknown as UserRow;
const FOREIGN_STUDENT = { id: 22, user_code: "202505050102", name: "乙", role: "student", class_id: 9 } as unknown as UserRow;
const UNASSIGNED_STUDENT = { id: 23, user_code: "202505050103", name: "丙", role: "student", class_id: null } as unknown as UserRow;

const STUDENTS_URL = "http://localhost:3000/api/manage/students";

function makeRequest(url: string, method: string, body: unknown, cookie: string): NextRequest {
  return new NextRequest(new URL(url), {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
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

function studentsFailureAudit(action: string) {
  return expect.objectContaining({
    action,
    path: "/api/manage/students",
    resource_type: "student",
    status: "failed",
    actor_role: "teacher",
  });
}

/** 按学号定点返回在册学生（`beforeEach` 重置，用例可覆写） */
let roster: UserRow[] = [];

beforeEach(() => {
  vi.clearAllMocks();
  roster = [OWN_STUDENT, FOREIGN_STUDENT, UNASSIGNED_STUDENT];
  vi.mocked(getTeacherClassPairs).mockResolvedValue([{ id: 1, teacher_id: 3, class_id: 7, created_at: "" }]);
  vi.mocked(getStudents).mockImplementation(async () => roster);
  vi.mocked(getUserByCode).mockImplementation(async (code: string) => roster.find((s) => s.user_code === code));
  // 批量导入改为「按学号集合批查」（#193）：只回标识与班级归属的轻量投影
  vi.mocked(getUsersByCodes).mockImplementation(async (codes: string[]) =>
    roster
      .filter((s) => codes.includes(s.user_code))
      .map((s) => ({ id: s.id, user_code: s.user_code, class_id: s.class_id }))
  );
  vi.mocked(getUserById).mockImplementation(async (id: number) =>
    id === 1
      ? ({ user_code: "10001", name: "管理员", role: "admin" } as unknown as UserRow)
      : ({ user_code: "20001", name: "张教师", role: "teacher" } as unknown as UserRow)
  );
  vi.mocked(getClassByName).mockImplementation(async (name: string) => {
    if (name === OWN_CLASS.name) return OWN_CLASS;
    if (name === FOREIGN_CLASS.name) return FOREIGN_CLASS;
    return undefined;
  });
});

describe("PUT /api/manage/students — 班级归属（#171）", () => {
  it("教师改别人班的学生 → 403，不落库，被拒尝试进审计", async () => {
    const res = await PUT(makeRequest(STUDENTS_URL, "PUT", { studentId: "202505050102", name: "改名" }, await cookies("teacher", 3)));
    expect(res.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(studentsFailureAudit("student:update"));
    expect(lastAudit()?.error_message).toContain("不在你管理的班级");
  });

  it("教师改未分班学生 → 403（未分班学生只有管理员能维护）", async () => {
    const res = await PUT(makeRequest(STUDENTS_URL, "PUT", { studentId: "202505050103", name: "改名" }, await cookies("teacher", 3)));
    expect(res.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("教师把自己班的学生转到别人的班 → 403，不落库", async () => {
    const res = await PUT(
      makeRequest(STUDENTS_URL, "PUT", { studentId: "202505050101", className: FOREIGN_CLASS.name }, await cookies("teacher", 3))
    );
    expect(res.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(studentsFailureAudit("student:update"));
  });

  it("教师在本班内改学生 → 200 并落库", async () => {
    const res = await PUT(
      makeRequest(STUDENTS_URL, "PUT", { studentId: "202505050101", name: "改名", className: OWN_CLASS.name }, await cookies("teacher", 3))
    );
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(OWN_STUDENT.id, { name: "改名", class_id: 7 });
  });

  it("管理员改任意班的学生 → 200（不受班级归属限制）", async () => {
    const res = await PUT(makeRequest(STUDENTS_URL, "PUT", { studentId: "202505050102", name: "改名" }, await cookies("admin", 1)));
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(FOREIGN_STUDENT.id, { name: "改名" });
  });
});

describe("POST /api/manage/students — 班级归属（#171）", () => {
  it("教师把已有学生绑到别人的班 → 403", async () => {
    const res = await POST(
      makeRequest(STUDENTS_URL, "POST", { studentId: "202505050101", name: "甲", className: FOREIGN_CLASS.name }, await cookies("teacher", 3))
    );
    expect(res.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(studentsFailureAudit("student:create"));
  });

  it("教师新建学生未指定班级 → 400（不产出谁都管不到的未分班账户）", async () => {
    const res = await POST(
      makeRequest(STUDENTS_URL, "POST", { studentId: "202505050901", name: "新生", className: "" }, await cookies("teacher", 3))
    );
    expect(res.status).toBe(400);
    expect(insertUser).not.toHaveBeenCalled();
  });

  it("教师在自己班里新建学生 → 200", async () => {
    const res = await POST(
      makeRequest(STUDENTS_URL, "POST", { studentId: "202505050901", name: "新生", className: OWN_CLASS.name }, await cookies("teacher", 3))
    );
    expect(res.status).toBe(200);
    expect(insertUser).toHaveBeenCalledWith(expect.objectContaining({ user_code: "202505050901", class_id: 7 }));
  });

  it("批量导入含别人的班 → 整批 403，一行都不写", async () => {
    const res = await POST(
      makeRequest(
        STUDENTS_URL,
        "POST",
        {
          students: [
            { studentId: "202505050101", name: "甲", className: OWN_CLASS.name },
            { studentId: "202505050902", name: "丁", className: FOREIGN_CLASS.name },
          ],
        },
        await cookies("teacher", 3)
      )
    );
    expect(res.status).toBe(403);
    expect(insertUser).not.toHaveBeenCalled();
    expect(updateUser).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(studentsFailureAudit("student:batch-import"));
  });

  it("批量导入命中别人班里的在册学生 → 整批 403", async () => {
    const res = await POST(
      makeRequest(
        STUDENTS_URL,
        "POST",
        { students: [{ studentId: "202505050102", name: "乙", className: OWN_CLASS.name }] },
        await cookies("teacher", 3)
      )
    );
    expect(res.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
  });

  it("批量导入全部落在自己班 → 200", async () => {
    const res = await POST(
      makeRequest(
        STUDENTS_URL,
        "POST",
        {
          students: [
            { studentId: "202505050101", name: "甲", className: OWN_CLASS.name },
            { studentId: "202505050903", name: "戊", className: OWN_CLASS.name },
          ],
        },
        await cookies("teacher", 3)
      )
    );
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(OWN_STUDENT.id, { name: "甲", class_id: 7 });
    expect(insertUser).toHaveBeenCalledWith(expect.objectContaining({ user_code: "202505050903", class_id: 7 }));
  });
});

describe("DELETE /api/manage/students 与批量重置密码 — 班级归属（#171）", () => {
  it("教师删除别人班的学生 → 整批 403，不删任何人", async () => {
    const res = await DELETE(
      makeRequest(STUDENTS_URL, "DELETE", { ids: ["202505050101", "202505050102"] }, await cookies("teacher", 3))
    );
    expect(res.status).toBe(403);
    expect(deleteStudents).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(studentsFailureAudit("student:delete"));
  });

  it("教师删除自己班的学生 → 200", async () => {
    const res = await DELETE(
      makeRequest(STUDENTS_URL, "DELETE", { ids: ["202505050101"] }, await cookies("teacher", 3))
    );
    expect(res.status).toBe(200);
    expect(deleteStudents).toHaveBeenCalledWith(["202505050101"]);
  });

  it("教师批量重置别人班学生密码 → 403，不写密码", async () => {
    const res = await BATCH_PASSWORD(
      makeRequest(
        "http://localhost:3000/api/manage/students/batch-password",
        "POST",
        { studentIds: ["202505050101", "202505050102"] },
        await cookies("teacher", 3)
      )
    );
    expect(res.status).toBe(403);
    expect(updateUser).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "student:batch-password",
        path: "/api/manage/students/batch-password",
        status: "failed",
      })
    );
  });

  it("教师重置自己班学生密码 → 200", async () => {
    const res = await BATCH_PASSWORD(
      makeRequest(
        "http://localhost:3000/api/manage/students/batch-password",
        "POST",
        { studentIds: ["202505050101"] },
        await cookies("teacher", 3)
      )
    );
    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(OWN_STUDENT.id, { password_hash: expect.any(String) });
  });
});

describe("全局配置写端点 — 仅管理员（#171）", () => {
  const tagsUrl = "http://localhost:3000/api/manage/tags";

  it("教师新建 / 改名 / 删除预设标签一律 403，且写入前不落库", async () => {
    const post = await TAGS_POST(makeRequest(tagsUrl, "POST", { name: "兴趣", type: "category" }, await cookies("teacher", 3)));
    const patch = await TAGS_PATCH(makeRequest(tagsUrl, "PATCH", { id: 1, name: "改名" }, await cookies("teacher", 3)));
    const del = await TAGS_DELETE(makeRequest(tagsUrl, "DELETE", { ids: [1] }, await cookies("teacher", 3)));

    expect(post.status).toBe(403);
    expect(patch.status).toBe(403);
    expect(del.status).toBe(403);
    expect(insertTag).not.toHaveBeenCalled();
    expect(updateTag).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledTimes(3);
    expect(insertAuditLog).toHaveBeenCalledWith(expect.objectContaining({ action: "tag:delete", status: "failed", actor_role: "teacher" }));
  });

  it("教师批量导入标签 / 恢复默认预设 → 403", async () => {
    const batch = await TAGS_BATCH(
      makeRequest(`${tagsUrl}/batch`, "POST", { items: [{ category: "兴趣", name: "编程" }] }, await cookies("teacher", 3))
    );
    const restore = await TAGS_RESTORE(makeRequest(`${tagsUrl}/restore`, "POST", {}, await cookies("teacher", 3)));

    expect(batch.status).toBe(403);
    expect(restore.status).toBe(403);
    expect(resetTagsToDefaults).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "tag:restore-defaults", status: "failed", actor_role: "teacher" })
    );
  });

  it("教师改档案功能设置 → 403 且不写配置；管理员可写", async () => {
    const configUrl = "http://localhost:3000/api/manage/profile-config";
    const denied = await PROFILE_CONFIG_PUT(makeRequest(configUrl, "PUT", { maxCustomTags: 9 }, await cookies("teacher", 3)));
    expect(denied.status).toBe(403);
    expect(setProfileConfig).not.toHaveBeenCalled();
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "profile-config:update", status: "failed", actor_role: "teacher" })
    );

    vi.mocked(insertAuditLog).mockClear();
    const allowed = await PROFILE_CONFIG_PUT(makeRequest(configUrl, "PUT", { maxCustomTags: 9 }, await cookies("admin", 1)));
    expect(allowed.status).toBe(200);
    expect(setProfileConfig).toHaveBeenCalledWith("max_custom_tags", "9");
  });

  it("管理员照常可写标签与学生（收敛只影响教师）", async () => {
    const tag = await TAGS_POST(makeRequest(tagsUrl, "POST", { name: "兴趣", type: "category" }, await cookies("admin", 1)));
    expect(tag.status).toBe(201);

    const student = await POST(
      makeRequest(STUDENTS_URL, "POST", { studentId: "202505050102", name: "乙", className: FOREIGN_CLASS.name }, await cookies("admin", 1))
    );
    expect(student.status).toBe(200);
  });

  it("无会话请求 → 401（路由自防御，不依赖 proxy）", async () => {
    const res = await PUT(makeRequest(STUDENTS_URL, "PUT", { studentId: "202505050101", name: "改名" }, "auth_token=not-a-token"));
    expect(res.status).toBe(401);
  });
});
