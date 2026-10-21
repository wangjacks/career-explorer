import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  getSubmittedProfiles: vi.fn(),
  clearSubmissions: vi.fn(),
  getEnabledAssessments: vi.fn(),
  getCurrentAssessmentResultsByUserCodes: vi.fn(),
  // #243：DELETE 的 WriteGuard 依赖（GET 用例不会调用，但模块导入需要完整导出）
  getStudents: vi.fn(async () => []),
  getUserById: vi.fn(async () => undefined),
  getTeacherClassPairs: vi.fn(async () => []),
  insertAuditLog: vi.fn(async () => undefined),
}));

import { GET } from "@/app/api/manage/profiles/route";
import {
  getSubmittedProfiles,
  getEnabledAssessments,
  getCurrentAssessmentResultsByUserCodes,
} from "@/lib/db";
import type { AssessmentRow, AssessmentResultSummary, UserRow } from "@/lib/db";

const URL_BASE = "http://localhost:3000/api/manage/profiles";
const RIASEC_ID = 1;
const IPIP_ID = 2;

function makeRequest(query = ""): NextRequest {
  return new NextRequest(new URL(`${URL_BASE}${query}`));
}

function student(overrides: Partial<UserRow> = {}): UserRow {
  return {
    id: 21,
    user_code: "202505050101",
    name: "张三",
    role: "student",
    class_id: 7,
    tags: '["兴趣","技能"]',
    avatar_url: "/uploads/a.jpg",
    evaluation_url: "/uploads/e.jpg",
    storage_id: 1,
    submitted_at: "2026-10-19 10:00:00",
    ...overrides,
  } as UserRow;
}

const RIASEC_SCALE = {
  id: RIASEC_ID,
  code: "riasec",
  name: "霍兰德职业兴趣测评",
  question_count: 30,
  dimensions_json: JSON.stringify([
    { key: "R", label: "现实型" },
    { key: "I", label: "研究型" },
    { key: "A", label: "艺术型" },
    { key: "S", label: "社会型" },
    { key: "E", label: "企业型" },
    { key: "C", label: "常规型" },
  ]),
  scoring_mode: "typological",
  scale_version: "Mini-IP-CN 1.0",
  attribution: "",
  license_text: "",
  disclaimer: "",
  enabled: 1,
  created_at: "",
  updated_at: "",
} as AssessmentRow;

const IPIP_SCALE = {
  ...RIASEC_SCALE,
  id: IPIP_ID,
  code: "ipip-neo-ffi",
  name: "五大人格测评",
  question_count: 50,
  dimensions_json: JSON.stringify([
    { key: "N", label: "神经质" },
    { key: "E", label: "外向性" },
    { key: "O", label: "开放性" },
    { key: "A", label: "宜人性" },
    { key: "C", label: "尽责性" },
  ]),
  scoring_mode: "dimensional",
  scale_version: "IPIP NEO-FFI 1.0",
} as AssessmentRow;

function result(overrides: Partial<AssessmentResultSummary> = {}): AssessmentResultSummary {
  return {
    user_code: "202505050101",
    type_code: "SIA",
    completed_at: "2026-10-18 09:30:00",
    scores_json: JSON.stringify([
      { key: "S", label: "社会型", standard: 92.5 },
      { key: "I", label: "研究型", standard: 80 },
      { key: "A", label: "艺术型", standard: 70 },
      { key: "C", label: "常规型", standard: 40 },
      { key: "E", label: "企业型", standard: 30 },
      { key: "R", label: "现实型", standard: 20 },
    ]),
    ...overrides,
  };
}

function ipipResult(overrides: Partial<AssessmentResultSummary> = {}): AssessmentResultSummary {
  return {
    user_code: "202505050101",
    type_code: null,
    completed_at: "2026-10-19 08:00:00",
    scores_json: JSON.stringify([
      { key: "N", standard: 25 },
      { key: "E", standard: 78.5 },
      { key: "O", standard: 60 },
      { key: "A", standard: 55 },
      { key: "C", standard: 88 },
    ]),
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSubmittedProfiles).mockResolvedValue({
    rows: [
      student(),
      student({ id: 22, user_code: "202505050102", name: "李四", tags: null as unknown as string }),
    ],
    total: 42,
  });
  vi.mocked(getEnabledAssessments).mockResolvedValue([RIASEC_SCALE, IPIP_SCALE]);
  vi.mocked(getCurrentAssessmentResultsByUserCodes).mockImplementation(async (assessmentId: number) => {
    if (assessmentId === RIASEC_ID) return [result()];
    if (assessmentId === IPIP_ID) return [ipipResult()];
    return [];
  });
});

describe("GET /api/manage/profiles — 双测评列（#330）", () => {
  it("下发启用中的量表清单（列定义/维度标签唯一来源）与每行的分量表结果", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.assessmentScales.map((scale: { code: string }) => scale.code)).toEqual([
      "riasec",
      "ipip-neo-ffi",
    ]);
    expect(body.assessmentScales[1]).toMatchObject({
      name: "五大人格测评",
      scoringMode: "dimensional",
    });
    expect(body.assessmentScales[1].dimensions.map((d: { label: string }) => d.label)).toEqual([
      "神经质",
      "外向性",
      "开放性",
      "宜人性",
      "尽责性",
    ]);

    const first = body.data[0];
    expect(first.assessmentResults.riasec).toMatchObject({
      status: "completed",
      typeCode: "SIA",
      completedAt: "2026-10-18 09:30:00",
    });
    expect(first.assessmentResults.riasec.scores[0]).toEqual({ key: "S", standard: 92.5 });
    expect(first.assessmentResults["ipip-neo-ffi"]).toMatchObject({
      status: "completed",
      typeCode: null,
      completedAt: "2026-10-19 08:00:00",
    });
    expect(first.assessmentResults["ipip-neo-ffi"].scores.map((s: { key: string }) => s.key)).toEqual([
      "N",
      "E",
      "O",
      "A",
      "C",
    ]);

    // 未测行两列都为 none
    const second = body.data[1];
    expect(second.assessmentResults.riasec.status).toBe("none");
    expect(second.assessmentResults["ipip-neo-ffi"].status).toBe("none");
  });

  it("兼容字段（#234）仍按霍兰德结果下发，旧前端/导出不受影响", async () => {
    const body = await (await GET(makeRequest())).json();
    expect(body.data[0]).toMatchObject({
      userId: 21,
      studentId: "202505050101",
      // #243：教师端据此判断行是否在本人管辖班级内
      classId: 7,
      assessmentCode: "SIA",
      assessmentStatus: "completed",
      assessmentAt: "2026-10-18 09:30:00",
    });
    expect(body.data[0].assessmentScores.map((s: { key: string }) => s.key)).toEqual([
      "S",
      "I",
      "A",
      "C",
      "E",
      "R",
    ]);
    expect(body.data[1]).toMatchObject({
      assessmentCode: null,
      assessmentStatus: "none",
      assessmentAt: null,
      assessmentScores: null,
    });
  });

  it("按当页学号逐量表批查一次（不是全校扫表），分页/排序照旧透传", async () => {
    await GET(makeRequest("?page=3&pageSize=10"));
    expect(getSubmittedProfiles).toHaveBeenCalledWith(3, 10, {
      lead: "all",
      sortKey: "createdAt",
      sortDir: "desc",
    });
    expect(getCurrentAssessmentResultsByUserCodes).toHaveBeenCalledWith(RIASEC_ID, [
      "202505050101",
      "202505050102",
    ]);
    expect(getCurrentAssessmentResultsByUserCodes).toHaveBeenCalledWith(IPIP_ID, [
      "202505050101",
      "202505050102",
    ]);
  });

  it("空页不逐量表查结果（列表主功能不发多余查询）", async () => {
    vi.mocked(getSubmittedProfiles).mockResolvedValue({ rows: [], total: 0 });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(body.assessmentScales).toHaveLength(2);
    expect(getCurrentAssessmentResultsByUserCodes).not.toHaveBeenCalled();
  });

  it("量表清单查询失败：列表照常返回，双列降级为未测（不整页 500）", async () => {
    vi.mocked(getEnabledAssessments).mockRejectedValue(new Error("assessments table missing"));
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.assessmentScales).toEqual([]);
    expect(body.data[0].assessmentResults).toEqual({});
    expect(body.data[0].assessmentStatus).toBe("none");
    expect(getCurrentAssessmentResultsByUserCodes).not.toHaveBeenCalled();
  });

  it("某套量表批查失败只让该列降级，另一列与列表不受影响", async () => {
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockImplementation(async (assessmentId: number) => {
      if (assessmentId === RIASEC_ID) return [result()];
      throw new Error("ipip results broken");
    });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0].assessmentResults.riasec.status).toBe("completed");
    expect(body.data[0].assessmentResults["ipip-neo-ffi"].status).toBe("none");
  });

  it("人格快照损坏时结果仍为 completed（界面降级为「已测·分数缺失」），不 500", async () => {
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockImplementation(async (assessmentId: number) => {
      if (assessmentId === RIASEC_ID) return [result()];
      return [ipipResult({ scores_json: "{not-json" })];
    });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.data[0].assessmentResults["ipip-neo-ffi"]).toMatchObject({
      status: "completed",
      scores: null,
    });
  });

  it("完成记录但三字码为 NULL 时按未测返回（状态与徽章同源）", async () => {
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockImplementation(async (assessmentId: number) =>
      assessmentId === RIASEC_ID ? [result({ type_code: null, scores_json: null })] : []
    );
    const body = await (await GET(makeRequest())).json();
    expect(body.data[0].assessmentResults.riasec.status).toBe("none");
    expect(body.data[0].assessmentCode).toBeNull();
  });
});

describe("GET /api/manage/profiles — 测评筛选参数（#330）", () => {
  it("兴趣多选透传（AND 语义在数据层），并与搜索/标签叠加", async () => {
    await GET(makeRequest("?q=%E5%BC%A0&tag=%E8%BF%90%E5%8A%A8&interest=S,A,I"));
    expect(getSubmittedProfiles).toHaveBeenCalledWith(1, 20, {
      q: "张",
      tags: ["运动"],
      lead: "all",
      interest: { mode: "letters", keys: ["S", "A", "I"] },
      sortKey: "createdAt",
      sortDir: "desc",
    });
  });

  it("人格单维度：路由把维度映射成量表 code + 数组下标（不给客户端传下标的机会）", async () => {
    await GET(makeRequest("?personality=C:high"));
    expect(getSubmittedProfiles).toHaveBeenCalledWith(1, 20, {
      lead: "all",
      personality: { mode: "dimension", key: "C", dir: "high" },
      personalitySql: { scaleCode: "ipip-neo-ffi", dimensionIndex: 4 },
      sortKey: "createdAt",
      sortDir: "desc",
    });
  });

  it("人格已测 / 未测：只解析量表 code，不需要维度下标", async () => {
    await GET(makeRequest("?personality=any"));
    expect(getSubmittedProfiles).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({
        personality: { mode: "any" },
        personalitySql: { scaleCode: "ipip-neo-ffi" },
      })
    );
    await GET(makeRequest("?personality=none"));
    expect(getSubmittedProfiles).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ personality: { mode: "none" } })
    );
  });

  it("互斥：同时传 interest 与 personality → 400，不查库", async () => {
    const res = await GET(makeRequest("?interest=S&personality=C:high"));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("同一时间只按一种测评筛选");
    expect(getSubmittedProfiles).not.toHaveBeenCalled();
  });

  it("维度不存在 / 人格量表未启用 → 400（显式报错，不返回空列表）", async () => {
    const unknown = await GET(makeRequest("?personality=Z:high"));
    expect(unknown.status).toBe(400);
    expect((await unknown.json()).error).toContain("人格量表没有维度");

    vi.mocked(getEnabledAssessments).mockResolvedValue([RIASEC_SCALE]);
    const noScale = await GET(makeRequest("?personality=C:high"));
    expect(noScale.status).toBe(400);
    expect((await noScale.json()).error).toContain("人格量表");

    const noScaleAny = await GET(makeRequest("?personality=any"));
    expect(noScaleAny.status).toBe(400);
  });

  it("旧 lead 参数仍然可用（兼容旧前端），新参数非法值 400", async () => {
    await GET(makeRequest("?lead=none"));
    expect(getSubmittedProfiles).toHaveBeenLastCalledWith(
      1,
      20,
      expect.objectContaining({ lead: "none" })
    );

    expect((await GET(makeRequest("?interest=Z"))).status).toBe(400);
    expect((await GET(makeRequest("?personality=C"))).status).toBe(400);
  });
});
