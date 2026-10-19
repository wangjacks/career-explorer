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

  it("按当前页学号批查（不是全校扫表），并把 page/pageSize 原样传给列表查询", async () => {
    await GET(makeRequest("?page=3&pageSize=10"));

    expect(getSubmittedProfiles).toHaveBeenCalledWith(3, 10);
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

  it("分页字段与既有字段不回归（total 来自列表查询，不是过滤后的条数）", async () => {
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

  it("空页不查测评结果（少一次无意义查询）", async () => {
    vi.mocked(getSubmittedProfiles).mockResolvedValue({ rows: [], total: 0 });

    const res = await GET(makeRequest());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.data).toEqual([]);
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
});
