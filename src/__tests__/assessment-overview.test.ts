import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_EMPTY_SUB,
  CELL_PLACEHOLDER,
  assessmentCompletionCard,
  classAssessmentCells,
  formatPercent,
  normalizeAssessmentOverview,
  totalAssessmentCells,
  type AssessmentOverviewStats,
} from "../lib/assessment-overview";

const STATS: AssessmentOverviewStats = {
  classes: [
    { classId: 7, name: "2025级1班", enrolled: 3, assessed: 2, rate: 66.7 },
    { classId: 9, name: "2025级2班", enrolled: 2, assessed: 0, rate: 0 },
  ],
  total: { enrolled: 6, assessed: 4, rate: 66.7 },
};

describe("normalizeAssessmentOverview", () => {
  it("解析正常响应，只保留本页用到的字段", () => {
    const stats = normalizeAssessmentOverview({
      scope: "all",
      assessment: { code: "riasec" },
      classes: [{ classId: 7, name: "2025级1班", enrolled: 3, assessed: 2, rate: 66.7, extra: "x" }],
      types: [{ key: "R", count: 1 }],
      total: { enrolled: 6, assessed: 4, rate: 66.7, lastSubmittedAt: "2026-10-19 10:00:00" },
    });
    expect(stats).toEqual({
      classes: [{ classId: 7, name: "2025级1班", enrolled: 3, assessed: 2, rate: 66.7 }],
      total: { enrolled: 6, assessed: 4, rate: 66.7 },
    });
  });

  it("形状不对 / 缺关键总数 → null（当作没有测评数据，不报错）", () => {
    expect(normalizeAssessmentOverview(null)).toBeNull();
    expect(normalizeAssessmentOverview("oops")).toBeNull();
    expect(normalizeAssessmentOverview({ classes: [], total: {} })).toBeNull();
    expect(normalizeAssessmentOverview({ classes: [] })).toBeNull();
  });

  it("单个班级行脏只丢该行，不影响整份数据", () => {
    const stats = normalizeAssessmentOverview({
      classes: [
        { classId: 7, name: "A班", enrolled: 3, assessed: 2, rate: 66.7 },
        { name: "缺 classId", enrolled: 2, assessed: 1, rate: 50 },
        { classId: 9, name: "B班", enrolled: "3", assessed: 1, rate: 33 },
        null,
      ],
      total: { enrolled: 5, assessed: 3, rate: 60 },
    });
    expect(stats?.classes).toHaveLength(1);
    expect(stats?.classes[0].classId).toBe(7);
  });

  it("assessed 超过 enrolled、rate 越界都会被钳住（不出现 >100%）", () => {
    const stats = normalizeAssessmentOverview({
      classes: [{ classId: 7, name: "A班", enrolled: 2, assessed: 9, rate: 150 }],
      total: { enrolled: 2, assessed: 9, rate: -20 },
    });
    expect(stats?.classes[0]).toMatchObject({ assessed: 2, rate: 100 });
    expect(stats?.total).toEqual({ enrolled: 2, assessed: 2, rate: 0 });
  });
});

describe("assessmentCompletionCard", () => {
  it("有数据时：主数字为已完成人数，角标为应完成总数", () => {
    expect(assessmentCompletionCard(STATS)).toEqual({ value: 4, sub: "共 6 人应完成" });
  });

  it("没有数据 / 还没人开始：显示 0 + 友好空态文案", () => {
    expect(assessmentCompletionCard(null)).toEqual({ value: 0, sub: ASSESSMENT_EMPTY_SUB });
    expect(
      assessmentCompletionCard({ classes: [], total: { enrolled: 10, assessed: 0, rate: 0 } })
    ).toEqual({ value: 0, sub: ASSESSMENT_EMPTY_SUB });
    expect(
      assessmentCompletionCard({ classes: [], total: { enrolled: 0, assessed: 0, rate: 0 } })
    ).toEqual({ value: 0, sub: ASSESSMENT_EMPTY_SUB });
  });
});

describe("formatPercent（全表统一取整）", () => {
  it("按整数百分比展示，四舍五入", () => {
    expect(formatPercent(66.7)).toBe("67%");
    expect(formatPercent(66.4)).toBe("66%");
    expect(formatPercent(0)).toBe("0%");
    expect(formatPercent(100)).toBe("100%");
    expect(formatPercent(33.333)).toBe("33%");
  });

  it("空值 / 非法值 / 越界不会产出 NaN", () => {
    expect(formatPercent(null)).toBe(CELL_PLACEHOLDER);
    expect(formatPercent(undefined)).toBe(CELL_PLACEHOLDER);
    expect(formatPercent(Number.NaN)).toBe(CELL_PLACEHOLDER);
    expect(formatPercent(150)).toBe("100%");
    expect(formatPercent(-5)).toBe("0%");
  });
});

describe("班级/合计单元格", () => {
  it("按 classId 匹配班级行（改名不影响），未分班行显示占位符", () => {
    expect(classAssessmentCells(STATS, 7)).toEqual({ assessed: "2", rate: "67%" });
    expect(classAssessmentCells(STATS, 9)).toEqual({ assessed: "0", rate: "0%" });
    expect(classAssessmentCells(STATS, 12)).toEqual({
      assessed: CELL_PLACEHOLDER,
      rate: CELL_PLACEHOLDER,
    });
    expect(classAssessmentCells(STATS, null)).toEqual({
      assessed: CELL_PLACEHOLDER,
      rate: CELL_PLACEHOLDER,
    });
  });

  it("没有测评数据时整列显示占位符（不报错、不显示 0）", () => {
    expect(classAssessmentCells(null, 7)).toEqual({
      assessed: CELL_PLACEHOLDER,
      rate: CELL_PLACEHOLDER,
    });
    expect(totalAssessmentCells(null)).toEqual({
      assessed: CELL_PLACEHOLDER,
      rate: CELL_PLACEHOLDER,
    });
  });

  it("合计行用全校小结（含未分班学生）", () => {
    expect(totalAssessmentCells(STATS)).toEqual({ assessed: "4", rate: "67%" });
  });

  it("空班（在册 0 人）的比例列显示 `-`，与同一行的提交率口径一致", () => {
    // 空班的「兴趣测评」仍显示 0（与「已提交」列一致），但比例不能写成 0%
    expect(classAssessmentCells(STATS, 11)).toEqual({
      assessed: CELL_PLACEHOLDER,
      rate: CELL_PLACEHOLDER,
    });
    const withEmptyClass: AssessmentOverviewStats = {
      classes: [{ classId: 11, name: "空班", enrolled: 0, assessed: 0, rate: 0 }],
      total: { enrolled: 0, assessed: 0, rate: 0 },
    };
    expect(classAssessmentCells(withEmptyClass, 11)).toEqual({ assessed: "0", rate: CELL_PLACEHOLDER });
    expect(totalAssessmentCells(withEmptyClass)).toEqual({ assessed: "0", rate: CELL_PLACEHOLDER });
  });
});

describe("接口缺 rate 时的兜底", () => {
  it("班级 / 总计的 rate 缺失时按 assessed ÷ enrolled 现算，而不是显示 0%", () => {
    const stats = normalizeAssessmentOverview({
      classes: [
        { classId: 7, name: "A班", enrolled: 3, assessed: 2 },
        { classId: 8, name: "B班", enrolled: 0, assessed: 0 },
      ],
      total: { enrolled: 4, assessed: 3 },
    });
    expect(stats?.classes[0].rate).toBeCloseTo(66.666, 2);
    expect(stats?.classes[1].rate).toBe(0);
    expect(stats?.total.rate).toBe(75);
    expect(classAssessmentCells(stats, 7)).toEqual({ assessed: "2", rate: "67%" });
    expect(classAssessmentCells(stats, 8)).toEqual({ assessed: "0", rate: CELL_PLACEHOLDER });
  });
});
