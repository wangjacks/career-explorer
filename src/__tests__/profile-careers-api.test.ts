import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

vi.mock("@/lib/db", () => ({
  getUserById: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  getAssessmentByCode: vi.fn(),
  getCurrentAssessmentResultsByUserCodes: vi.fn(),
  getOnetOccupations: vi.fn(),
  insertAuditLog: vi.fn(async () => undefined),
}));

import { GET } from "@/app/api/manage/profiles/careers/route";
import {
  getAssessmentByCode,
  getCurrentAssessmentResultsByUserCodes,
  getOnetOccupations,
  getTeacherClassPairs,
  getUserById,
  insertAuditLog,
} from "@/lib/db";
import type { OnetOccupationRow, UserRow } from "@/lib/db";

/**
 * #332 教师端推荐职业端点：班级归属校验 + 审计 + 只返回 Top3。
 *
 * 安全边界比列表读更严（教师只能看本人班级的学生），每次读取（含被拒）都记审计；
 * 响应里不允许出现姓名/学号/六维分等个人信息。
 */

const TEACHER_UID = 7;
const OTHER_TEACHER_UID = 8;
const OWN_CLASS = 7;
const OTHER_CLASS = 9;

function student(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 21,
    user_code: "202505050101",
    name: "张三",
    role: "student",
    class_id: OWN_CLASS,
    tags: '["摄影"]',
    avatar_url: null,
    evaluation_url: null,
    evaluation_text: null,
    storage_id: 1,
    submitted_at: "2026-10-19 10:00:00",
    ...overrides,
  } as UserRow;
}

function url(search = ""): URL {
  return new URL(`http://localhost:3000/api/manage/profiles/careers${search}`);
}

async function request(search: string, cookie?: string): Promise<NextRequest> {
  return new NextRequest(url(search), { headers: cookie ? { cookie } : {} });
}

const RIASEC_SCORES = JSON.stringify([
  { key: "R", standard: 88 },
  { key: "I", standard: 80 },
  { key: "A", standard: 55 },
  { key: "S", standard: 40 },
  { key: "E", standard: 30 },
  { key: "C", standard: 25 },
]);

function occupation(code: string, name: string, weights: "realistic" | "artistic" | "social" | "investigative") {
  const base = { R: 2, I: 2, A: 2, S: 2, E: 2, C: 2 };
  if (weights === "realistic") Object.assign(base, { R: 7, I: 6, A: 4, S: 2, E: 2, C: 2 });
  else Object.assign(base, { R: 2, I: 5, A: 7, S: 5, E: 2, C: 2 });
  return {
    code,
    name,
    name_zh: name,
    interest_code: weights === "realistic" ? "RI" : "AI",
    interests_json: JSON.stringify(base),
    job_zone: 4,
    education_level: "本科",
    cluster: "计算机与数学",
    dataset_version: "30.2",
  } as OnetOccupationRow;
}

const OCCUPATIONS: OnetOccupationRow[] = [
  occupation("15-1252.00", "软件开发工程师", "realistic"),
  occupation("19-3033.00", "行业分析师", "investigative"),
  occupation("27-1024.00", "平面设计师", "artistic"),
  occupation("21-1012.00", "教育顾问", "social"),
  occupation("15-2051.00", "数据科学家", "realistic"),
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserById).mockImplementation(async (id: number) => (id === 21 ? student() : undefined));
  vi.mocked(getTeacherClassPairs).mockResolvedValue([
    { id: 1, teacher_id: TEACHER_UID, class_id: OWN_CLASS, created_at: "" },
  ]);
  vi.mocked(getAssessmentByCode).mockResolvedValue({ id: 1, code: "riasec" } as never);
  vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([
    { user_code: "202505050101", type_code: "RIA", scores_json: RIASEC_SCORES, completed_at: "2026-10-20 10:00:00" },
  ]);
  vi.mocked(getOnetOccupations).mockResolvedValue(OCCUPATIONS);
});

async function teacherCookie(uid = TEACHER_UID) {
  return `auth_token=${await signToken({ role: "teacher", uid, name: "张老师" })}`;
}

function lastAudit() {
  const calls = vi.mocked(insertAuditLog).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("GET /api/manage/profiles/careers（#332 教师端推荐职业）", () => {
  it("未登录 / 学生 → 403，并记 assessment:careers failed 审计", async () => {
    expect((await GET(await request("?studentId=21"))).status).toBe(403);
    const studentToken = await signToken({ role: "student", uid: 21, name: "张三" });
    expect((await GET(await request("?studentId=21", `auth_token=${studentToken}`))).status).toBe(403);
    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "assessment:careers", status: "failed" });
  });

  it("本班教师 → 200，只返回 Top3 职业与署名，不含学生姓名/学号/分数", async () => {
    const res = await GET(await request("?studentId=21", await teacherCookie()));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["attribution", "careers"]);
    expect(body.attribution).toContain("CC BY 4.0");
    expect(body.careers).toHaveLength(3);
    for (const career of body.careers) {
      expect(Object.keys(career).sort()).toEqual(["cluster", "code", "educationLevel", "name", "nameZh"]);
    }
    // 最高匹配应是 R/I 权重最高的职业
    expect(body.careers[0].code).toBe("15-1252.00");
    const serialized = JSON.stringify(body);
    expect(serialized).not.toContain("202505050101");
    expect(serialized).not.toContain("张三");
    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "assessment:careers", status: "success" });
  });

  it("管理员可查看任意班级学生", async () => {
    vi.mocked(getUserById).mockResolvedValue(student({ class_id: OTHER_CLASS }));
    const adminToken = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await GET(await request("?studentId=21", `auth_token=${adminToken}`));
    expect(res.status).toBe(200);
  });

  it("教师看非本人班级学生 → 403，且不查职业库、记 failed 审计", async () => {
    vi.mocked(getUserById).mockResolvedValue(student({ class_id: OTHER_CLASS }));
    const res = await GET(await request("?studentId=21", await teacherCookie()));
    expect(res.status).toBe(403);
    expect(getOnetOccupations).not.toHaveBeenCalled();
    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "assessment:careers", status: "failed" });
  });

  it("未分班学生不属于任何教师 → 403", async () => {
    vi.mocked(getUserById).mockResolvedValue(student({ class_id: null }));
    const res = await GET(await request("?studentId=21", await teacherCookie()));
    expect(res.status).toBe(403);
  });

  it("参数 / 学生 / 结果缺失 → 400 / 404 / 404，均记审计且不返回职业", async () => {
    const cookie = await teacherCookie();
    expect((await GET(await request("?studentId=abc", cookie))).status).toBe(400);
    vi.mocked(getUserById).mockResolvedValue(undefined);
    expect((await GET(await request("?studentId=999", cookie))).status).toBe(404);
    vi.mocked(getUserById).mockResolvedValue(student());
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([]);
    const noResult = await GET(await request("?studentId=21", cookie));
    expect(noResult.status).toBe(404);
    expect((await noResult.json()).error).toContain("还没有完成");
    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "assessment:careers", status: "failed" });
  });

  it("没有可匹配的画像（分数与三字码都不可用）→ 409，不硬凑职业", async () => {
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([
      { user_code: "202505050101", type_code: null, scores_json: null, completed_at: null },
    ]);
    const res = await GET(await request("?studentId=21", await teacherCookie()));
    expect(res.status).toBe(409);
  });

  it("职业库为空 → 503（不返回空列表冒充成功）", async () => {
    vi.mocked(getOnetOccupations).mockResolvedValue([]);
    const res = await GET(await request("?studentId=21", await teacherCookie()));
    expect(res.status).toBe(503);
  });

  it("另一位教师（未带该班）同样 403", async () => {
    const res = await GET(await request("?studentId=21", await teacherCookie(OTHER_TEACHER_UID)));
    expect(res.status).toBe(403);
  });
});
