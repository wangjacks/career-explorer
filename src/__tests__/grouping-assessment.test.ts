import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  getAssessmentByCode: vi.fn(),
  getCurrentAssessmentResultsByUserCodes: vi.fn(),
}));

import { getAssessmentByCode, getCurrentAssessmentResultsByUserCodes } from "@/lib/db";
import {
  buildAssessmentFeatureContext,
  loadAssessmentFeatureContext,
} from "@/lib/grouping-assessment";
import { IPIP_NEO_FFI_CODE, RIASEC_CODE } from "@/lib/assessment-data";

/**
 * 分组测评上下文装载（#345）：纯映射 + 降级口径。
 * 关键约束：**大五 N 不进入上下文**；缺维/坏快照按缺测处理；某套量表失败只降级该源。
 */

const STUDENTS = [
  { id: 1, user_code: "202600000001" },
  { id: 2, user_code: "202600000002" },
  { id: 3, user_code: "202600000003" },
];

function riasecRow(userCode: string, scores: { key: string; standard: number }[] | null) {
  return {
    user_code: userCode,
    type_code: null,
    completed_at: null,
    scores_json: scores ? JSON.stringify(scores) : null,
  };
}

const RIASEC_SCORES = [
  { key: "R", standard: 80 },
  { key: "I", standard: 60 },
  { key: "A", standard: 40 },
  { key: "S", standard: 50 },
  { key: "E", standard: 45 },
  { key: "C", standard: 30 },
];

const BIG_FIVE_SCORES = [
  { key: "N", standard: 90 },
  { key: "E", standard: 70 },
  { key: "O", standard: 65 },
  { key: "A", standard: 55 },
  { key: "C", standard: 85 },
];

beforeEach(() => {
  vi.clearAllMocks();
});

describe("buildAssessmentFeatureContext（#345 纯映射）", () => {
  it("按学号映射到 userId，只保留标准分；大五只取 C/E/O/A，N 被丢弃", () => {
    const context = buildAssessmentFeatureContext(
      STUDENTS,
      [riasecRow("202600000001", RIASEC_SCORES)],
      [riasecRow("202600000001", BIG_FIVE_SCORES)]
    );
    expect(context.riasec.get(1)).toEqual({ R: 80, I: 60, A: 40, S: 50, E: 45, C: 30 });
    // N=90 不进入上下文（算法与界面都看不到神经质）
    expect(context.bigfive.get(1)).toEqual({ C: 85, E: 70, O: 65, A: 55 });
    expect(JSON.stringify([...context.bigfive.entries()])).not.toContain('"N"');
    // 其他人没有结果 → 不在上下文里（按缺测处理）
    expect(context.riasec.has(2)).toBe(false);
    expect(context.bigfive.has(2)).toBe(false);
  });

  it("大五缺任何一维 → 该生不进入人格源（不拿 0 分冒充已测）", () => {
    const context = buildAssessmentFeatureContext(
      STUDENTS,
      [],
      [riasecRow("202600000001", BIG_FIVE_SCORES.filter((score) => score.key !== "A"))]
    );
    expect(context.bigfive.size).toBe(0);
  });

  it("坏 JSON / 非法分数 → 按缺测处理，不抛错", () => {
    const context = buildAssessmentFeatureContext(
      STUDENTS,
      [{ user_code: "202600000001", scores_json: "{not-json" }],
      [
        {
          user_code: "202600000002",
          scores_json: JSON.stringify([
            { key: "C", standard: "高" },
            { key: "E", standard: Number.NaN },
            { key: "O", standard: 60 },
            { key: "A", standard: 55 },
          ]),
        },
      ]
    );
    expect(context.riasec.size).toBe(0);
    expect(context.bigfive.size).toBe(0);
  });

  it("结果里的未知维度忽略；非本班学号忽略", () => {
    const context = buildAssessmentFeatureContext(
      STUDENTS,
      [riasecRow("999999999999", RIASEC_SCORES)],
      [riasecRow("202600000003", [...BIG_FIVE_SCORES, { key: "X", standard: 10 }])]
    );
    expect(context.riasec.size).toBe(0);
    expect(context.bigfive.get(3)).toEqual({ C: 85, E: 70, O: 65, A: 55 });
  });
});

describe("loadAssessmentFeatureContext（#345 读库与降级）", () => {
  it("两套量表各批查一次，可用性如实返回", async () => {
    vi.mocked(getAssessmentByCode).mockImplementation(async (code: string) => ({ id: code === RIASEC_CODE ? 1 : 2, code }) as never);
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockImplementation(async (assessmentId: number) =>
      assessmentId === 1
        ? [riasecRow("202600000001", RIASEC_SCORES)]
        : [riasecRow("202600000001", BIG_FIVE_SCORES)]
    );

    const loaded = await loadAssessmentFeatureContext(STUDENTS);
    expect(getCurrentAssessmentResultsByUserCodes).toHaveBeenCalledWith(1, STUDENTS.map((student) => student.user_code));
    expect(getCurrentAssessmentResultsByUserCodes).toHaveBeenCalledWith(2, STUDENTS.map((student) => student.user_code));
    expect(loaded.available).toEqual({ riasec: true, bigfive: true });
    expect(loaded.degraded).toEqual([]);
    expect(loaded.context.riasec.get(1)?.R).toBe(80);
    expect(loaded.context.bigfive.get(1)?.C).toBe(85);
  });

  it("某套量表读取失败 → 只降级该源并记录原因，另一套照常", async () => {
    vi.mocked(getAssessmentByCode).mockImplementation(async (code: string) => {
      if (code === IPIP_NEO_FFI_CODE) throw new Error("ipip broken");
      return { id: 1, code } as never;
    });
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([
      riasecRow("202600000001", RIASEC_SCORES),
    ]);

    const loaded = await loadAssessmentFeatureContext(STUDENTS);
    expect(loaded.available).toEqual({ riasec: true, bigfive: false });
    expect(loaded.degraded).toEqual(["性格测评数据读取失败"]);
    expect(loaded.context.riasec.size).toBe(1);
    expect(loaded.context.bigfive.size).toBe(0);
  });

  it("量表未启用（getAssessmentByCode 返回 undefined）→ 该源不可用但不报错", async () => {
    vi.mocked(getAssessmentByCode).mockResolvedValue(undefined);
    const loaded = await loadAssessmentFeatureContext(STUDENTS);
    expect(loaded.available).toEqual({ riasec: false, bigfive: false });
    expect(getCurrentAssessmentResultsByUserCodes).not.toHaveBeenCalled();
  });

  it("空名单 → 不查库", async () => {
    const loaded = await loadAssessmentFeatureContext([]);
    expect(getAssessmentByCode).not.toHaveBeenCalled();
    expect(loaded.available).toEqual({ riasec: false, bigfive: false });
  });
});
