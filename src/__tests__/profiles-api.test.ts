import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

vi.mock("@/lib/db", () => ({
  getSubmittedProfiles: vi.fn(),
  clearSubmissions: vi.fn(),
  getAssessmentByCode: vi.fn(),
  getCurrentAssessmentResultsByUserCodes: vi.fn(),
}));

import { GET } from "@/app/api/manage/profiles/route";
import {
  getSubmittedProfiles,
  getAssessmentByCode,
  getCurrentAssessmentResultsByUserCodes,
} from "@/lib/db";
import type {
  AssessmentRow,
  AssessmentResultSummary,
  UserRow,
} from "@/lib/db";

const URL_BASE = "http://localhost:3000/api/manage/profiles";

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
    evaluation_text: null,
    storage_id: 1,
    submitted_at: "2026-10-19 10:00:00",
    ...overrides,
  } as UserRow;
}

const ASSESSMENT = { id: 1, code: "riasec" } as AssessmentRow;

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

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getSubmittedProfiles).mockResolvedValue({
    rows: [
      student(),
      student({ id: 22, user_code: "202505050102", name: "李四", tags: null as unknown as string }),
    ],
    total: 42,
  });
  vi.mocked(getAssessmentByCode).mockResolvedValue(ASSESSMENT);
  vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([result()]);
});

describe("GET /api/manage/profiles — 兴趣测评字段（#234）", () => {
  it("已测行给三字码 / completed / 完成时间 / 六型快照，未测行为 null + none", async () => {
    const res = await GET(makeRequest());
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.data).toHaveLength(2);
    expect(body.data[0]).toMatchObject({
      userId: 21,
      studentId: "202505050101",
      assessmentCode: "SIA",
      assessmentStatus: "completed",
      assessmentAt: "2026-10-18 09:30:00",
    });
    // 六型快照按原顺序透传（详情弹窗条形用），与学生端结果页同一份数据
    expect(body.data[0].assessmentScores.map((s: { key: string }) => s.key)).toEqual([
      "S",
      "I",
      "A",
      "C",
      "E",
      "R",
    ]);
    expect(body.data[0].assessmentScores[0].standard).toBe(92.5);

    expect(body.data[1]).toMatchObject({
      assessmentCode: null,
      assessmentStatus: "none",
      assessmentAt: null,
      assessmentScores: null,
    });
  });

  it("下发三条他人评价与服务端词表（#162）", async () => {
    const evaluationTexts = ["认真负责，沟通清楚", "很有耐心", "团队合作可靠"];
    vi.mocked(getSubmittedProfiles).mockResolvedValue({
      rows: [student({ evaluation_text: JSON.stringify(evaluationTexts) })],
      total: 1,
    });
    const res = await GET(makeRequest());
    const body = await res.json();
    expect(body.data[0].evaluationTexts).toEqual(evaluationTexts);
    expect(body.data[0].evaluationWords.length).toBeGreaterThan(0);
    expect(body.data[0].evaluationWords[0]).toHaveProperty("weight");
  });

  it("按当前页学号批查（不是全校扫表），并把分页与默认筛选一起传给列表查询", async () => {
    await GET(makeRequest("?page=3&pageSize=10"));

    // 不传筛选参数时给默认值（与改造前行为一致），#295 起第三个入参是服务端筛选
    expect(getSubmittedProfiles).toHaveBeenCalledWith(3, 10, {
      lead: "all",
      sortKey: "createdAt",
      sortDir: "desc",
    });
    expect(getCurrentAssessmentResultsByUserCodes).toHaveBeenCalledWith(1, [
      "202505050101",
      "202505050102",
    ]);
  });

  it("六型快照只下发「维度 + 标准分」（不把 raw / band / 作答计数带到教师端）", async () => {
    const res = await GET(makeRequest());
    const body = await res.json();

    for (const score of body.data[0].assessmentScores) {
      expect(Object.keys(score).sort()).toEqual(["key", "standard"]);
    }
  });

  it("分页字段与既有字段不回归（total 来自列表查询，服务端过滤后的命中数）", async () => {
    const res = await GET(makeRequest("?page=2&pageSize=20"));
    const body = await res.json();

    expect(body.total).toBe(42);
    expect(body.page).toBe(2);
    expect(body.pageSize).toBe(20);
    expect(body.totalPages).toBe(3);
    expect(body.data[0].tags).toEqual(["兴趣", "技能"]);
    expect(body.data[0].createdAt).toBe("2026-10-19 10:00:00");
    // 旧数据 tags 为 null 时容忍为 []
    expect(body.data[1].tags).toEqual([]);
  });

  it("空页不查量表也不查测评结果（一次多余查询都不发）", async () => {
    vi.mocked(getSubmittedProfiles).mockResolvedValue({ rows: [], total: 0 });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
    expect(getAssessmentByCode).not.toHaveBeenCalled();
    expect(getCurrentAssessmentResultsByUserCodes).not.toHaveBeenCalled();
  });

  it("量表缺失（未安装/被删）时全部按未测返回，不抛错", async () => {
    vi.mocked(getAssessmentByCode).mockResolvedValue(undefined);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data.every((row: { assessmentStatus: string }) => row.assessmentStatus === "none")).toBe(true);
    expect(getCurrentAssessmentResultsByUserCodes).not.toHaveBeenCalled();
  });

  it("分数快照损坏时仍返回列表（scores 降级为空数组，不 500）", async () => {
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([
      result({ scores_json: "{not-json" }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0].assessmentCode).toBe("SIA");
    expect(body.data[0].assessmentScores).toEqual([]);
  });

  it("完成记录但三字码为 NULL 时按未测返回（状态与徽章同源，不出现「已测但没码」）", async () => {
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([
      result({ type_code: null, scores_json: null }),
    ]);

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data[0]).toMatchObject({
      assessmentCode: null,
      assessmentStatus: "none",
      assessmentAt: null,
      assessmentScores: null,
    });
  });

  it("测评数据层故障时整页降级为全部未测，不影响档案列表", async () => {
    vi.mocked(getAssessmentByCode).mockRejectedValue(new Error("assessment table missing"));

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toHaveLength(2);
    expect(body.data[0].studentName).toBe("张三");
    expect(body.data.every((row: { assessmentStatus: string }) => row.assessmentStatus === "none")).toBe(true);
  });
});

describe("GET /api/manage/profiles — 服务端筛选参数（#295）", () => {
  it("把 q / 标签 / 主导型 / 排序透传给列表查询（筛选下推服务端，跨页生效）", async () => {
    await GET(
      makeRequest(
        "?page=1&q=%E5%BC%A0%E4%B8%89&tag=%E8%BF%90%E5%8A%A8&tag=%E6%B8%B8%E6%88%8F&lead=I&sortKey=studentId&sortDir=asc"
      )
    );

    expect(getSubmittedProfiles).toHaveBeenCalledWith(1, 20, {
      q: "张三",
      tags: ["运动", "游戏"],
      lead: "I",
      sortKey: "studentId",
      sortDir: "asc",
    });
  });

  it("标签名里的逗号按字面量处理：一个 tag 参数就是一个标签，不切分（#295 review 修复）", async () => {
    await GET(makeRequest("?tag=%E7%AF%AE%E7%90%83%2C%E8%B6%B3%E7%90%83&tag=%E8%BF%90%E5%8A%A8"));
    const call = vi.mocked(getSubmittedProfiles).mock.calls.at(-1)!;
    expect(call[2]).toMatchObject({ tags: ["篮球,足球", "运动"] });
  });

  it("lead=none 与 sortKey=createdAt 显式传递时保持原样", async () => {
    await GET(makeRequest("?lead=none&sortKey=createdAt&sortDir=asc"));
    const call = vi.mocked(getSubmittedProfiles).mock.calls.at(-1)!;
    expect(call[2]).toEqual({ lead: "none", sortKey: "createdAt", sortDir: "asc" });
  });

  it.each([
    ["lead=Z", "lead 只支持"],
    ["sortKey=score", "sortKey 只支持"],
    ["sortDir=up", "sortDir 只支持"],
    ["page=0", "page 必须是正整数"],
    ["page=abc", "page 必须是正整数"],
    ["pageSize=0", "pageSize 必须是"],
    ["pageSize=101", "pageSize 必须是"],
  ])("非法参数 %s → 400（显式报错，不静默忽略筛选条件）", async (query, message) => {
    const res = await GET(makeRequest(`?${query}`));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain(message);
  });

  it("超长关键字 / 超量标签 → 400", async () => {
    const longQuery = encodeURIComponent("字".repeat(51));
    expect((await GET(makeRequest(`?q=${longQuery}`))).status).toBe(400);

    const manyTags = Array.from({ length: 21 }, (_, index) => `tag=tag${index}`).join("&");
    expect((await GET(makeRequest(`?${manyTags}`))).status).toBe(400);
  });

  it("筛选态 total 直接用服务端返回值（不再被当页过滤后的行数覆盖）", async () => {
    vi.mocked(getSubmittedProfiles).mockResolvedValue({ rows: [student()], total: 7 });
    const res = await GET(makeRequest("?q=张"));
    const body = await res.json();
    expect(body.total).toBe(7);
    expect(body.totalPages).toBe(1);
  });
});
