import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";
import { IPIP_DIMENSIONS } from "@/lib/assessment-data";

vi.mock("@/lib/db", () => ({
  getAssessmentByCode: vi.fn(),
  getCompletionStats: vi.fn(),
  getDimensionalResultScores: vi.fn(),
  getTeacherClassPairs: vi.fn(),
}));

vi.mock("@/lib/db-config", () => ({
  isInstalled: vi.fn(() => true),
}));

import { GET } from "@/app/api/manage/stats/big-five/route";
import {
  getAssessmentByCode,
  getCompletionStats,
  getDimensionalResultScores,
  getTeacherClassPairs,
  type AssessmentRow,
  type CompletionStatsRaw,
  type DimensionalResultScoreRow,
} from "@/lib/db";
import { isInstalled } from "@/lib/db-config";

const IPIP = {
  id: 9,
  code: "ipip-neo-ffi",
  name: "五大人格测评（IPIP NEO-FFI 精简版）",
  question_count: 50,
  items_per_attempt: 0,
  dimensions_json: JSON.stringify(IPIP_DIMENSIONS),
  scoring_mode: "dimensional",
  scale_version: "IPIP NEO-FFI 1.0",
  attribution: "IPIP",
  license_text: "",
  disclaimer: "",
  enabled: 1,
  created_at: "2026-10-19 10:00:00",
  updated_at: "2026-10-19 10:00:00",
} as AssessmentRow;

const COMPLETION: CompletionStatsRaw = {
  profile: [
    { class_id: 7, name: "2025级1班", enrolled: 3, submitted: 0 },
    { class_id: 9, name: "2025级2班", enrolled: 1, submitted: 0 },
  ],
  assessments: [
    { assessment_id: 9, class_id: 7, assessed: 2 },
    { assessment_id: 9, class_id: 9, assessed: 1 },
  ],
};

function snapshot(overrides: Record<string, string> = {}): string {
  return JSON.stringify(
    IPIP_DIMENSIONS.map(({ key }) => ({
      key,
      standard: 50,
      band: overrides[key] ?? "medium",
    }))
  );
}

const ROWS: DimensionalResultScoreRow[] = [
  { user_id: 1, scores_json: snapshot({ N: "high" }), completed_at: "2026-10-18 15:42:00" },
  { user_id: 2, scores_json: snapshot(), completed_at: "2026-10-17 09:00:00" },
  { user_id: 3, scores_json: "{not json", completed_at: "2026-10-16 08:00:00" },
];

function request(path: string, cookie?: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

async function token(role: "student" | "teacher" | "admin", uid: number): Promise<string> {
  return `auth_token=${await signToken({ role, uid, name: "测试用户" })}`;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(isInstalled).mockReturnValue(true);
  vi.mocked(getAssessmentByCode).mockResolvedValue(IPIP);
  vi.mocked(getCompletionStats).mockResolvedValue(COMPLETION);
  vi.mocked(getDimensionalResultScores).mockResolvedValue(ROWS);
  vi.mocked(getTeacherClassPairs).mockResolvedValue([
    { id: 1, teacher_id: 3, class_id: 7, created_at: "" },
  ]);
});

describe("GET /api/manage/stats/big-five（#312 人格轮廓）", () => {
  it("未登录 / 学生 → 403", async () => {
    expect((await GET(request("/api/manage/stats/big-five"))).status).toBe(403);
    const student = await token("student", 21);
    expect((await GET(request("/api/manage/stats/big-five", student))).status).toBe(403);
  });

  it("非法 scope / classId → 400 且不查库", async () => {
    const teacher = await token("teacher", 3);
    for (const query of ["scope=class", "classId=abc", "classId=0", "classId=-1"]) {
      const res = await GET(request(`/api/manage/stats/big-five?${query}`, teacher));
      expect(res.status).toBe(400);
    }
    expect(getCompletionStats).not.toHaveBeenCalled();
  });

  it("教师 scope=mine 只统计本人班级", async () => {
    const res = await GET(
      request("/api/manage/stats/big-five?scope=mine", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    expect(getCompletionStats).toHaveBeenCalledWith([9], [7]);
    expect(getDimensionalResultScores).toHaveBeenCalledWith(9, [7]);
    expect((await res.json()).scope).toBe("mine");
  });

  it("教师给非本人班级 → 403，即使 scope=all", async () => {
    const teacher = await token("teacher", 3);
    expect(
      (await GET(request("/api/manage/stats/big-five?scope=all&classId=9", teacher))).status
    ).toBe(403);
    expect(
      (await GET(request("/api/manage/stats/big-five?scope=all&classId=7", teacher))).status
    ).toBe(200);
    expect(getCompletionStats).toHaveBeenCalledWith([9], [7]);
  });

  it("管理员可查任意范围；scope=mine 等同全校", async () => {
    const admin = await token("admin", 1);
    expect(
      (await GET(request("/api/manage/stats/big-five?classId=9", admin))).status
    ).toBe(200);
    expect(getCompletionStats).toHaveBeenLastCalledWith([9], [9]);
    await GET(request("/api/manage/stats/big-five?scope=mine", admin));
    expect(getCompletionStats).toHaveBeenLastCalledWith([9], null);
    expect(getTeacherClassPairs).not.toHaveBeenCalled();
  });

  it("成功响应：量表元信息 + 三档计数 + 守恒，且不含任何个人字段", async () => {
    const res = await GET(
      request("/api/manage/stats/big-five", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    // 教师默认 scope=all 不收窄班级（null = 全校）
    expect(getCompletionStats).toHaveBeenCalledWith([9], null);
    expect(getDimensionalResultScores).toHaveBeenCalledWith(9, null);

    expect(body.assessment).toEqual({
      code: "ipip-neo-ffi",
      name: IPIP.name,
      scaleVersion: "IPIP NEO-FFI 1.0",
      enabled: true,
      scoringMode: "dimensional",
      dimensions: IPIP_DIMENSIONS,
    });
    expect(body.total).toEqual({
      enrolled: 4,
      assessed: 3,
      rate: 75,
      invalidCount: 1,
      lastSubmittedAt: "2026-10-18 15:42:00",
    });
    expect(body.dimensions.map((item: { key: string }) => item.key)).toEqual([
      "N",
      "E",
      "O",
      "A",
      "C",
    ]);
    expect(body.dimensions[0]).toEqual({
      key: "N",
      label: "神经质",
      low: 0,
      medium: 1,
      high: 1,
    });
    for (const dimension of body.dimensions) {
      expect(dimension.low + dimension.medium + dimension.high).toBe(
        body.total.assessed - body.total.invalidCount
      );
    }

    const serialized = JSON.stringify(body);
    for (const forbidden of [
      "standard",
      "raw",
      "user_id",
      "userId",
      "userCode",
      "user_code",
      "name\":\"甲",
      "scores_json",
    ]) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it("量表停用 → enabled:false、total 与分布全 0，不读取完成度/逐人快照", async () => {
    vi.mocked(getAssessmentByCode).mockResolvedValue({ ...IPIP, enabled: 0 });
    const res = await GET(
      request("/api/manage/stats/big-five", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.assessment.enabled).toBe(false);
    expect(body.total).toEqual({
      enrolled: 0,
      assessed: 0,
      rate: 0,
      invalidCount: 0,
      lastSubmittedAt: null,
    });
    expect(body.dimensions).toHaveLength(5);
    expect(body.dimensions.every((item: { low: number; medium: number; high: number }) => item.low + item.medium + item.high === 0)).toBe(true);
    expect(getCompletionStats).not.toHaveBeenCalled();
    expect(getDimensionalResultScores).not.toHaveBeenCalled();
  });

  it("教师没有任何班级时 scope=mine 传空集合，返回全 0 分布", async () => {
    vi.mocked(getTeacherClassPairs).mockResolvedValue([]);
    vi.mocked(getCompletionStats).mockResolvedValue({ profile: [], assessments: [] });
    vi.mocked(getDimensionalResultScores).mockResolvedValue([]);
    const res = await GET(
      request("/api/manage/stats/big-five?scope=mine", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(getCompletionStats).toHaveBeenCalledWith([9], []);
    expect(getDimensionalResultScores).toHaveBeenCalledWith(9, []);
    expect(body.total).toEqual({
      enrolled: 0,
      assessed: 0,
      rate: 0,
      invalidCount: 0,
      lastSubmittedAt: null,
    });
    expect(body.dimensions.every((item: { low: number; medium: number; high: number }) => item.low + item.medium + item.high === 0)).toBe(true);
  });

  it("量表缺失 → 200 空态，不 500", async () => {
    vi.mocked(getAssessmentByCode).mockResolvedValue(undefined);
    const res = await GET(
      request("/api/manage/stats/big-five", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toEqual({
      scope: "all",
      assessment: null,
      total: { enrolled: 0, assessed: 0, rate: 0, invalidCount: 0, lastSubmittedAt: null },
      dimensions: [],
    });
    expect(getCompletionStats).not.toHaveBeenCalled();
  });

  it("未安装 → 200 空态，不查库", async () => {
    vi.mocked(isInstalled).mockReturnValue(false);
    const res = await GET(
      request("/api/manage/stats/big-five?scope=mine", await token("teacher", 3))
    );
    expect(res.status).toBe(200);
    expect((await res.json()).assessment).toBeNull();
    expect(getTeacherClassPairs).not.toHaveBeenCalled();
    expect(getAssessmentByCode).not.toHaveBeenCalled();
    expect(getCompletionStats).not.toHaveBeenCalled();
  });

  it("非 dimensional 量表 / 数据库失败 → 400 / 500", async () => {
    vi.mocked(getAssessmentByCode).mockResolvedValue({ ...IPIP, scoring_mode: "typological" });
    expect(
      (await GET(request("/api/manage/stats/big-five", await token("teacher", 3)))).status
    ).toBe(400);

    vi.mocked(getAssessmentByCode).mockResolvedValue(IPIP);
    vi.mocked(getCompletionStats).mockRejectedValue(new Error("db down"));
    expect(
      (await GET(request("/api/manage/stats/big-five", await token("teacher", 3)))).status
    ).toBe(500);
  });

  it("逐人快照读取失败 → 500（聚合主路径不静默吞错）", async () => {
    vi.mocked(getDimensionalResultScores).mockRejectedValue(new Error("scores table down"));
    expect(
      (await GET(request("/api/manage/stats/big-five", await token("teacher", 3)))).status
    ).toBe(500);
  });
});
