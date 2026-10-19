import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";
import { RIASEC_DIMENSIONS } from "@/lib/assessment-data";

// 隔离数据库层：本组用例锁定 #229 两个端点的范围口径、越权边界与审计行为
vi.mock("@/lib/db", () => ({
  getAssessmentByCode: vi.fn(),
  getAssessmentStats: vi.fn(),
  getAssessmentRoster: vi.fn(),
  getTeacherClassPairs: vi.fn(async () => [{ id: 1, teacher_id: 3, class_id: 7, created_at: "" }]),
  getUserById: vi.fn(async () => ({ user_code: "20001", name: "张老师", role: "teacher" })),
  insertAuditLog: vi.fn(async () => undefined),
}));

import { GET as statsGet } from "@/app/api/manage/stats/assessment/route";
import { GET as rosterGet } from "@/app/api/manage/assessment/roster/route";
import {
  getAssessmentByCode,
  getAssessmentStats,
  getAssessmentRoster,
  insertAuditLog,
  type AssessmentRow,
  type AssessmentRosterRow,
  type AssessmentStatsRaw,
} from "@/lib/db";

const ASSESSMENT = {
  id: 5,
  code: "riasec",
  name: "霍兰德职业兴趣测评（Mini-IP 精简版）",
  question_count: 30,
  dimensions_json: JSON.stringify(RIASEC_DIMENSIONS),
  scoring_mode: "typological",
  scale_version: "Mini-IP-CN 1.0",
  attribution: "O*NET",
  license_text: "",
  disclaimer: "",
  enabled: 1,
  created_at: "2026-10-19 10:00:00",
  updated_at: "2026-10-19 10:00:00",
} as AssessmentRow;

const RAW_STATS: AssessmentStatsRaw = {
  classes: [
    { class_id: 7, name: "2025级1班", enrolled: 3, assessed: 2 },
    { class_id: 9, name: "2025级2班", enrolled: 2, assessed: 0 },
  ],
  types: [
    { key: "S", count: 1 },
    { key: "R", count: 1 },
  ],
  codes: [
    { code: "SIA", count: 2 },
    { code: "RIC", count: 1 },
  ],
  total: { enrolled: 6, assessed: 2, last_completed_at: "2026-10-19 10:00:00" },
};

const ROSTER: AssessmentRosterRow[] = [
  {
    class_id: 7,
    class_name: "2025级1班",
    name: "甲",
    user_code: "202505050101",
    code: "SIA",
    assessed_at: "2026-10-19 10:00:00",
  },
];

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

async function token(role: "student" | "teacher" | "admin", uid: number): Promise<string> {
  return `auth_token=${await signToken({ role, uid, name: "测试用户" })}`;
}

function lastAudit() {
  const calls = vi.mocked(insertAuditLog).mock.calls;
  return calls[calls.length - 1]?.[0];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getAssessmentByCode).mockResolvedValue(ASSESSMENT);
  vi.mocked(getAssessmentStats).mockResolvedValue(RAW_STATS);
  vi.mocked(getAssessmentRoster).mockResolvedValue(ROSTER);
});

describe("GET /api/manage/stats/assessment（#229 聚合）", () => {
  it("未登录 / 学生 → 403（教师与管理员才能看）", async () => {
    expect((await statsGet(request("/api/manage/stats/assessment"))).status).toBe(403);
    const student = await token("student", 21);
    expect((await statsGet(request("/api/manage/stats/assessment", student))).status).toBe(403);
  });

  it("默认全校范围：班级完成度 + 六型齐全 + 三字码排行 + 总数", async () => {
    const res = await statsGet(request("/api/manage/stats/assessment", await token("teacher", 3)));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getAssessmentStats).toHaveBeenCalledWith(ASSESSMENT.id, null);
    expect(body.scope).toBe("all");
    expect(body.assessment).toMatchObject({ code: "riasec", scaleVersion: "Mini-IP-CN 1.0" });
    expect(body.classes).toEqual([
      { classId: 7, name: "2025级1班", enrolled: 3, assessed: 2, rate: 66.7 },
      { classId: 9, name: "2025级2班", enrolled: 2, assessed: 0, rate: 0 },
    ]);
    // 六型齐全（计数为 0 也返回），顺序与量表维度一致
    expect(body.types.map((t: { key: string }) => t.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(body.types[0]).toEqual({ key: "R", label: "现实型", count: 1 });
    expect(body.types[3]).toEqual({ key: "S", label: "社会型", count: 1 });
    expect(body.types[1].count).toBe(0);
    expect(body.codes).toEqual([
      { code: "SIA", count: 2, lead: "S", leadLabel: "社会型" },
      { code: "RIC", count: 1, lead: "R", leadLabel: "现实型" },
    ]);
    expect(body.total).toEqual({
      enrolled: 6,
      assessed: 2,
      rate: 33.3,
      lastSubmittedAt: "2026-10-19 10:00:00",
    });
  });

  it("聚合响应不含任何个人标识字段（投屏安全）", async () => {
    const res = await statsGet(request("/api/manage/stats/assessment", await token("teacher", 3)));
    const body = await res.json();
    expect(Object.keys(body).sort()).toEqual(["assessment", "classes", "codes", "scope", "total", "types"]);
    const serialized = JSON.stringify(body);
    for (const pii of ["userCode", "user_code", "assessedAt", "studentName", "20250505"]) {
      expect(serialized).not.toContain(pii);
    }
    expect(Object.keys(body.classes[0]).sort()).toEqual(["assessed", "classId", "enrolled", "name", "rate"]);
  });

  it("scope=mine：教师收窄到本人归属班级；管理员等同全校", async () => {
    const teacherRes = await statsGet(
      request("/api/manage/stats/assessment?scope=mine", await token("teacher", 3))
    );
    expect(teacherRes.status).toBe(200);
    expect((await teacherRes.json()).scope).toBe("mine");
    expect(getAssessmentStats).toHaveBeenCalledWith(ASSESSMENT.id, [7]);

    vi.mocked(getAssessmentStats).mockClear();
    const adminRes = await statsGet(
      request("/api/manage/stats/assessment?scope=mine", await token("admin", 1))
    );
    expect(adminRes.status).toBe(200);
    expect(getAssessmentStats).toHaveBeenCalledWith(ASSESSMENT.id, null);
  });

  it("非法 scope → 400；量表未配置 → 404；查询异常 → 500", async () => {
    const teacher = await token("teacher", 3);
    expect((await statsGet(request("/api/manage/stats/assessment?scope=class", teacher))).status).toBe(400);

    vi.mocked(getAssessmentByCode).mockResolvedValue(undefined);
    expect((await statsGet(request("/api/manage/stats/assessment", teacher))).status).toBe(404);

    vi.mocked(getAssessmentByCode).mockResolvedValue(ASSESSMENT);
    vi.mocked(getAssessmentStats).mockRejectedValue(new Error("db down"));
    expect((await statsGet(request("/api/manage/stats/assessment", teacher))).status).toBe(500);
  });
});

describe("GET /api/manage/assessment/roster（#229 名册）", () => {
  it("未登录 / 学生 → 403，且被拒也记审计", async () => {
    expect((await rosterGet(request("/api/manage/assessment/roster"))).status).toBe(403);
    expect(lastAudit()).toMatchObject({ action: "assessment:roster", status: "failed", actor_id: null });

    const student = await token("student", 21);
    expect((await rosterGet(request("/api/manage/assessment/roster", student))).status).toBe(403);
    expect(lastAudit()).toMatchObject({ action: "assessment:roster", status: "failed" });
    expect(getAssessmentRoster).not.toHaveBeenCalled();
  });

  it("教师访问别的班 → 403 且不查库（不静默返回空列表）", async () => {
    const teacher = await token("teacher", 3);
    const res = await rosterGet(request("/api/manage/assessment/roster?classId=9", teacher));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("无权");
    expect(getAssessmentRoster).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ status: "failed", resource_type: "assessment" });
  });

  it("教师查本人班级 → 200，返回姓名/学号/三字码/完成时间并记成功审计", async () => {
    const teacher = await token("teacher", 3);
    const res = await rosterGet(request("/api/manage/assessment/roster?classId=7", teacher));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(getAssessmentRoster).toHaveBeenCalledWith(ASSESSMENT.id, [7], { classId: 7, lead: null });
    expect(body.data).toEqual([
      {
        classId: 7,
        className: "2025级1班",
        name: "甲",
        userCode: "202505050101",
        code: "SIA",
        assessedAt: "2026-10-19 10:00:00",
      },
    ]);
    expect(body.total).toBe(1);
    expect(body.filters).toEqual({ classId: 7, lead: null });
    expect(lastAudit()).toMatchObject({
      action: "assessment:roster",
      status: "success",
      actor_id: 3,
      resource_type: "assessment",
    });
    // 教师的可查范围随审计落库，便于核对「谁查过谁」
    expect(lastAudit()?.metadata).toContain('"classScope":[7]');
  });

  it("教师不传 classId 时恒为本人归属班级全集（明细永不放宽到全校）", async () => {
    const teacher = await token("teacher", 3);
    expect((await rosterGet(request("/api/manage/assessment/roster", teacher))).status).toBe(200);
    expect(getAssessmentRoster).toHaveBeenCalledWith(ASSESSMENT.id, [7], { classId: null, lead: null });
  });

  it("lead 过滤：小写归一化后传给查询，非法值 400", async () => {
    const teacher = await token("teacher", 3);
    const ok = await rosterGet(request("/api/manage/assessment/roster?lead=s", teacher));
    expect(ok.status).toBe(200);
    expect((await ok.json()).filters.lead).toBe("S");
    expect(getAssessmentRoster).toHaveBeenCalledWith(ASSESSMENT.id, [7], { classId: null, lead: "S" });

    expect((await rosterGet(request("/api/manage/assessment/roster?lead=Z", teacher))).status).toBe(400);
    expect((await rosterGet(request("/api/manage/assessment/roster?classId=abc", teacher))).status).toBe(400);
    expect((await rosterGet(request("/api/manage/assessment/roster?classId=0", teacher))).status).toBe(400);
    expect((await rosterGet(request("/api/manage/assessment/roster?scope=class", teacher))).status).toBe(400);
  });

  it("管理员不受班级限制（全校排查），但不带 classId 时也走全校范围", async () => {
    const admin = await token("admin", 1);
    expect((await rosterGet(request("/api/manage/assessment/roster?classId=9", admin))).status).toBe(200);
    expect(getAssessmentRoster).toHaveBeenLastCalledWith(ASSESSMENT.id, null, { classId: 9, lead: null });

    expect((await rosterGet(request("/api/manage/assessment/roster", admin))).status).toBe(200);
    expect(getAssessmentRoster).toHaveBeenLastCalledWith(ASSESSMENT.id, null, { classId: null, lead: null });
  });

  it("量表未配置 → 404 且记失败审计；查询异常 → 500", async () => {
    const admin = await token("admin", 1);
    vi.mocked(getAssessmentByCode).mockResolvedValue(undefined);
    expect((await rosterGet(request("/api/manage/assessment/roster", admin))).status).toBe(404);
    expect(lastAudit()).toMatchObject({ status: "failed" });

    vi.mocked(getAssessmentByCode).mockResolvedValue(ASSESSMENT);
    vi.mocked(getAssessmentRoster).mockRejectedValue(new Error("db down"));
    expect((await rosterGet(request("/api/manage/assessment/roster", admin))).status).toBe(500);
  });
});
