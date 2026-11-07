import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";
import { IPIP_DIMENSIONS, RIASEC_DIMENSIONS } from "@/lib/assessment-data";

// 隔离数据库层：本组用例锁定 #229 / #313 两个端点的范围口径、越权边界与审计行为
vi.mock("@/lib/db", () => ({
  getAssessmentByCode: vi.fn(),
  getAssessmentStats: vi.fn(),
  getAssessmentRoster: vi.fn(),
  getAssessmentMissingRoster: vi.fn(),
  getEnabledAssessments: vi.fn(),
  normalizeAssessmentCode: vi.fn((code: string) => code.trim().toLowerCase()),
  getTeacherClassPairs: vi.fn(async () => [{ id: 1, teacher_id: 3, class_id: 7, created_at: "" }]),
  getUserById: vi.fn(async () => ({ user_code: "20001", name: "张老师", role: "teacher" })),
  insertAuditLog: vi.fn(async () => undefined),
}));

import { GET as statsGet } from "@/app/api/manage/stats/assessment/route";
import { GET as rosterGet } from "@/app/api/manage/assessment/roster/route";
import {
  getAssessmentByCode,
  getAssessmentMissingRoster,
  getAssessmentRoster,
  getAssessmentStats,
  getEnabledAssessments,
  insertAuditLog,
  type AssessmentMissingRosterRow,
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
  classTypes: [
    { class_id: 7, key: "S", count: 1 },
    { class_id: 7, key: "R", count: 1 },
  ],
  codes: [
    { code: "SIA", count: 2 },
    { code: "RIC", count: 1 },
  ],
  total: { enrolled: 6, assessed: 2, last_completed_at: "2026-10-19 10:00:00" },
};

const IPIP_ASSESSMENT = {
  ...ASSESSMENT,
  id: 6,
  code: "ipip-neo-ffi",
  name: "五大人格测评（IPIP NEO-FFI 精简版）",
  question_count: 50,
  dimensions_json: JSON.stringify(IPIP_DIMENSIONS),
  scoring_mode: "dimensional",
  scale_version: "IPIP NEO-FFI 1.0",
} as AssessmentRow;

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

/** 大五名册：快照里同时有 band 与 raw / standard，接口只许下发 key / label / band */
const IPIP_ROSTER: AssessmentRosterRow[] = [
  {
    class_id: 7,
    class_name: "2025级1班",
    name: "甲",
    user_code: "202505050101",
    code: null,
    assessed_at: "2026-10-19 10:00:00",
    scores_json: JSON.stringify([
      { key: "N", label: "神经质", questionCount: 10, answered: 10, raw: 42, standard: 82.5, band: "high" },
      { key: "E", label: "外向性", questionCount: 10, answered: 10, raw: 25, standard: 50, band: "medium" },
      // 旧快照没有 band：按 standard 用 bandOf 兜底
      { key: "O", label: "开放性", questionCount: 10, answered: 10, raw: 12, standard: 20 },
    ]),
  },
];

const MISSING_ROWS: AssessmentMissingRosterRow[] = [
  { class_id: 7, class_name: "2025级1班", name: "丙", user_code: "202505050103" },
  { class_id: null, class_name: null, name: "己", user_code: "202505050301" },
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
  vi.mocked(getAssessmentByCode).mockImplementation(async (code) =>
    code === IPIP_ASSESSMENT.code ? IPIP_ASSESSMENT : ASSESSMENT
  );
  vi.mocked(getEnabledAssessments).mockResolvedValue([ASSESSMENT, IPIP_ASSESSMENT]);
  vi.mocked(getAssessmentStats).mockResolvedValue(RAW_STATS);
  vi.mocked(getAssessmentRoster).mockResolvedValue(ROSTER);
  vi.mocked(getAssessmentMissingRoster).mockResolvedValue(MISSING_ROWS);
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
    expect(body.byClass).toEqual([
      {
        classId: 7,
        name: "2025级1班",
        assessed: 2,
        types: [
          { key: "R", count: 1 },
          { key: "I", count: 0 },
          { key: "A", count: 0 },
          { key: "S", count: 1 },
          { key: "E", count: 0 },
          { key: "C", count: 0 },
        ],
      },
      {
        classId: 9,
        name: "2025级2班",
        assessed: 0,
        types: [
          { key: "R", count: 0 },
          { key: "I", count: 0 },
          { key: "A", count: 0 },
          { key: "S", count: 0 },
          { key: "E", count: 0 },
          { key: "C", count: 0 },
        ],
      },
    ]);
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
    expect(Object.keys(body).sort()).toEqual([
      "assessment",
      "byClass",
      "classes",
      "codes",
      "scope",
      "total",
      "types",
    ]);
    const serialized = JSON.stringify(body);
    for (const pii of ["userCode", "user_code", "assessedAt", "studentName", "20250505"]) {
      expect(serialized).not.toContain(pii);
    }
    expect(Object.keys(body.classes[0]).sort()).toEqual(["assessed", "classId", "enrolled", "name", "rate"]);
  });

  it("code：默认 riasec，大小写归一化；不存在 404，维度型量表 400", async () => {
    const teacher = await token("teacher", 3);
    const defaultRes = await statsGet(request("/api/manage/stats/assessment", teacher));
    expect(defaultRes.status).toBe(200);
    expect(getAssessmentByCode).toHaveBeenLastCalledWith("riasec");

    vi.mocked(getAssessmentByCode).mockClear();
    const normalizedRes = await statsGet(request("/api/manage/stats/assessment?code=RiAsEc", teacher));
    expect(normalizedRes.status).toBe(200);
    expect(getAssessmentByCode).toHaveBeenCalledWith("riasec");

    vi.mocked(getAssessmentByCode).mockResolvedValue(undefined);
    const missingRes = await statsGet(request("/api/manage/stats/assessment?code=missing", teacher));
    expect(missingRes.status).toBe(404);

    vi.mocked(getAssessmentStats).mockClear();
    vi.mocked(getAssessmentByCode).mockResolvedValue({
      ...ASSESSMENT,
      code: "ipip-neo-ffi",
      scoring_mode: "dimensional",
    });
    const dimensionalRes = await statsGet(
      request("/api/manage/stats/assessment?code=IPIP-NEO-FFI", teacher)
    );
    expect(dimensionalRes.status).toBe(400);
    expect((await dimensionalRes.json()).error).toContain("人格分布");
    expect(getAssessmentStats).not.toHaveBeenCalled();
  });

  it("classId：整段聚合收窄到单班，非法值 400 且不查库", async () => {
    const teacher = await token("teacher", 3);
    const res = await statsGet(
      request("/api/manage/stats/assessment?classId=9", teacher)
    );
    expect(res.status).toBe(200);
    expect(getAssessmentStats).toHaveBeenCalledWith(ASSESSMENT.id, null, 9);

    vi.mocked(getAssessmentByCode).mockClear();
    vi.mocked(getAssessmentStats).mockClear();
    for (const bad of ["0", "-1", "1.5", "abc"]) {
      const badRes = await statsGet(
        request(`/api/manage/stats/assessment?classId=${encodeURIComponent(bad)}`, teacher)
      );
      expect(badRes.status, `classId=${bad} 应被拒`).toBe(400);
    }
    expect(getAssessmentByCode).not.toHaveBeenCalled();
    expect(getAssessmentStats).not.toHaveBeenCalled();
  });

  it("classId 权限：scope=mine 仅本人班；scope=all 可看任意班聚合", async () => {
    const teacher = await token("teacher", 3);
    const denied = await statsGet(
      request("/api/manage/stats/assessment?scope=mine&classId=9", teacher)
    );
    expect(denied.status).toBe(403);
    expect(getAssessmentByCode).not.toHaveBeenCalled();
    expect(getAssessmentStats).not.toHaveBeenCalled();

    const own = await statsGet(
      request("/api/manage/stats/assessment?scope=mine&classId=7", teacher)
    );
    expect(own.status).toBe(200);
    expect(getAssessmentStats).toHaveBeenCalledWith(ASSESSMENT.id, [7], 7);

    vi.mocked(getAssessmentStats).mockClear();
    const allScope = await statsGet(
      request("/api/manage/stats/assessment?scope=all&classId=9", teacher)
    );
    expect(allScope.status).toBe(200);
    expect(getAssessmentStats).toHaveBeenCalledWith(ASSESSMENT.id, null, 9);

    vi.mocked(getAssessmentStats).mockClear();
    const admin = await token("admin", 1);
    const adminRes = await statsGet(
      request("/api/manage/stats/assessment?scope=mine&classId=99", admin)
    );
    expect(adminRes.status).toBe(200);
    expect(getAssessmentStats).toHaveBeenCalledWith(ASSESSMENT.id, null, 99);
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

  it("量表停用：enabled=false 透传，大屏据此显示「还没开放」而不是「还没人做」（#232）", async () => {
    vi.mocked(getAssessmentByCode).mockResolvedValue({ ...ASSESSMENT, enabled: 0 });
    const res = await statsGet(request("/api/manage/stats/assessment", await token("teacher", 3)));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assessment.enabled).toBe(false);
    // 停用不影响聚合本身（历史结果仍要能统计）
    expect(body.total.assessed).toBe(2);
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
    expect(getAssessmentRoster).toHaveBeenCalledWith(ASSESSMENT.id, [7], { classId: 7, lead: null, code: null, includeScores: false });
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
    expect(body.filters).toEqual({ classId: 7, lead: null, code: null, scale: "riasec", status: "done" });
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
    expect(getAssessmentRoster).toHaveBeenCalledWith(ASSESSMENT.id, [7], { classId: null, lead: null, code: null, includeScores: false });
  });

  it("lead 过滤：小写归一化后传给查询，非法值 400", async () => {
    const teacher = await token("teacher", 3);
    const ok = await rosterGet(request("/api/manage/assessment/roster?lead=s", teacher));
    expect(ok.status).toBe(200);
    expect((await ok.json()).filters.lead).toBe("S");
    expect(getAssessmentRoster).toHaveBeenCalledWith(ASSESSMENT.id, [7], {
      classId: null,
      lead: "S",
      code: null,
      includeScores: false,
    });

    expect((await rosterGet(request("/api/manage/assessment/roster?lead=Z", teacher))).status).toBe(400);
    expect((await rosterGet(request("/api/manage/assessment/roster?classId=abc", teacher))).status).toBe(400);
    expect((await rosterGet(request("/api/manage/assessment/roster?classId=0", teacher))).status).toBe(400);
    expect((await rosterGet(request("/api/manage/assessment/roster?scope=class", teacher))).status).toBe(400);
  });

  it("code 过滤（#232 三字码胶囊下钻）：小写归一化后精确传给查询，非法值 400 且不查库", async () => {
    const teacher = await token("teacher", 3);
    const ok = await rosterGet(request("/api/manage/assessment/roster?code=sia", teacher));
    expect(ok.status).toBe(200);
    const okBody = await ok.json();
    expect(okBody.filters.code).toBe("SIA");
    expect(getAssessmentRoster).toHaveBeenLastCalledWith(ASSESSMENT.id, [7], {
      classId: null,
      lead: null,
      code: "SIA",
      includeScores: false,
    });
    expect(lastAudit()?.metadata).toContain('"code":"SIA"');

    vi.mocked(getAssessmentRoster).mockClear();
    for (const bad of ["XYZ", "SIAX", "S1"]) {
      const res = await rosterGet(
        request(`/api/manage/assessment/roster?code=${encodeURIComponent(bad)}`, teacher)
      );
      expect(res.status, `code=${bad} 应被拒`).toBe(400);
    }
    expect(getAssessmentRoster).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ action: "assessment:roster", status: "failed" });
  });

  it("管理员不受班级限制（全校排查），但不带 classId 时也走全校范围", async () => {
    const admin = await token("admin", 1);
    expect((await rosterGet(request("/api/manage/assessment/roster?classId=9", admin))).status).toBe(200);
    expect(getAssessmentRoster).toHaveBeenLastCalledWith(ASSESSMENT.id, null, { classId: 9, lead: null, code: null, includeScores: false });

    expect((await rosterGet(request("/api/manage/assessment/roster", admin))).status).toBe(200);
    expect(getAssessmentRoster).toHaveBeenLastCalledWith(ASSESSMENT.id, null, { classId: null, lead: null, code: null, includeScores: false });
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

describe("GET /api/manage/assessment/roster（#313 多量表与未完成名单）", () => {
  it("大五名册只给档位：响应里没有 raw / standard / 三字码，band 缺失时按标准分兜底", async () => {
    vi.mocked(getAssessmentRoster).mockResolvedValue(IPIP_ROSTER);
    const admin = await token("admin", 1);
    const res = await rosterGet(request("/api/manage/assessment/roster?scale=ipip-neo-ffi", admin));
    expect(res.status).toBe(200);

    expect(getAssessmentRoster).toHaveBeenCalledWith(IPIP_ASSESSMENT.id, null, {
      classId: null,
      lead: null,
      code: null,
      includeScores: true,
    });

    const body = await res.json();
    expect(body.filters).toEqual({
      classId: null,
      lead: null,
      code: null,
      scale: "ipip-neo-ffi",
      status: "done",
    });
    expect(body.data).toEqual([
      {
        classId: 7,
        className: "2025级1班",
        name: "甲",
        userCode: "202505050101",
        bands: [
          { key: "N", label: "神经质", band: "high" },
          { key: "E", label: "外向性", band: "medium" },
          { key: "O", label: "开放性", band: "low" },
        ],
        assessedAt: "2026-10-19 10:00:00",
      },
    ]);
    // 白名单字段：只有定位 + 档位 + 时间，逐人分数不入响应
    expect(Object.keys(body.data[0]).sort()).toEqual([
      "assessedAt",
      "bands",
      "classId",
      "className",
      "name",
      "userCode",
    ]);
    expect(JSON.stringify(body.data)).not.toContain("raw");
    expect(JSON.stringify(body.data)).not.toContain("standard");
  });

  it("scale 白名单来自启用量表：缩写与停用量表都 400 且不查库", async () => {
    const admin = await token("admin", 1);

    // 「ipip」不是完整 code，放行会让调用方以为查了 ipip-neo-ffi
    const abbr = await rosterGet(request("/api/manage/assessment/roster?scale=ipip", admin));
    expect(abbr.status).toBe(400);
    expect((await abbr.json()).error).toContain("已启用");
    expect(getAssessmentRoster).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ action: "assessment:roster", status: "failed" });

    // 停用（不在 enabled 列表）同样拒绝
    vi.mocked(getEnabledAssessments).mockResolvedValue([ASSESSMENT]);
    const disabled = await rosterGet(request("/api/manage/assessment/roster?scale=ipip-neo-ffi", admin));
    expect(disabled.status).toBe(400);
    expect(getAssessmentRoster).not.toHaveBeenCalled();
  });

  it("status=missing：只返回定位信息，走未完成数据层并沿用教师班级收窄", async () => {
    const teacher = await token("teacher", 3);
    const res = await rosterGet(request("/api/manage/assessment/roster?status=missing", teacher));
    expect(res.status).toBe(200);

    expect(getAssessmentMissingRoster).toHaveBeenCalledWith(ASSESSMENT.id, [7], { classId: null });
    expect(getAssessmentRoster).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body.filters).toEqual({
      classId: null,
      lead: null,
      code: null,
      scale: "riasec",
      status: "missing",
    });
    expect(body.total).toBe(2);
    expect(body.data).toEqual([
      { classId: 7, className: "2025级1班", name: "丙", userCode: "202505050103" },
      { classId: null, className: null, name: "己", userCode: "202505050301" },
    ]);
    expect(lastAudit()?.metadata).toContain('"scale":"riasec"');
    expect(lastAudit()?.metadata).toContain('"status":"missing"');
  });

  it("missing 也支持 classId 收窄，越权班级仍 403", async () => {
    const teacher = await token("teacher", 3);
    expect(
      (await rosterGet(request("/api/manage/assessment/roster?status=missing&classId=7", teacher))).status
    ).toBe(200);
    expect(getAssessmentMissingRoster).toHaveBeenLastCalledWith(ASSESSMENT.id, [7], { classId: 7 });

    const denied = await rosterGet(request("/api/manage/assessment/roster?status=missing&classId=9", teacher));
    expect(denied.status).toBe(403);
    expect(getAssessmentMissingRoster).toHaveBeenCalledTimes(1);
  });

  it("非法 status → 400 且不查库", async () => {
    const admin = await token("admin", 1);
    for (const bad of ["DONE", "all", "none"]) {
      const res = await rosterGet(request(`/api/manage/assessment/roster?status=${bad}`, admin));
      expect(res.status, `status=${bad} 应被拒`).toBe(400);
    }
    expect(getAssessmentRoster).not.toHaveBeenCalled();
    expect(getAssessmentMissingRoster).not.toHaveBeenCalled();
    expect(lastAudit()).toMatchObject({ action: "assessment:roster", status: "failed" });
  });

  it("lead / code 与大五或 missing 组合一律 400（明确拒绝，不静默忽略）", async () => {
    const admin = await token("admin", 1);
    const combos = [
      "/api/manage/assessment/roster?scale=ipip-neo-ffi&lead=S",
      "/api/manage/assessment/roster?scale=ipip-neo-ffi&code=SIA",
      "/api/manage/assessment/roster?scale=riasec&status=missing&lead=S",
      "/api/manage/assessment/roster?status=missing&code=SIA",
    ];
    for (const path of combos) {
      const res = await rosterGet(request(path, admin));
      expect(res.status, path).toBe(400);
      expect((await res.json()).error).toContain("只支持");
    }
    expect(getAssessmentRoster).not.toHaveBeenCalled();
    expect(getAssessmentMissingRoster).not.toHaveBeenCalled();
    // 被拒条目同样带 scale / status，便于事后核对「按什么口径查的」
    expect(lastAudit()?.metadata).toContain('"scale":"riasec"');
    expect(lastAudit()?.metadata).toContain('"status":"missing"');
  });

  it("超长 scale / classId 属于畸形请求：400 且审计里不落原始长串", async () => {
    const admin = await token("admin", 1);

    const longScale = "x".repeat(200);
    const scaleRes = await rosterGet(
      request(`/api/manage/assessment/roster?scale=${longScale}`, admin)
    );
    expect(scaleRes.status).toBe(400);
    // 超长值直接判非法，不拿它去查启用量表
    expect(getEnabledAssessments).not.toHaveBeenCalled();
    const scaleAudit = String(lastAudit()?.metadata ?? "");
    expect(scaleAudit).not.toContain(longScale);

    const longClassId = "9".repeat(40);
    const classRes = await rosterGet(
      request(`/api/manage/assessment/roster?classId=${longClassId}`, admin)
    );
    expect(classRes.status).toBe(400);
    const classAudit = String(lastAudit()?.metadata ?? "");
    expect(classAudit).not.toContain(longClassId);
  });
});

