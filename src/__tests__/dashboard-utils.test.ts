import { describe, it, expect } from "vitest";
import {
  ROSTER_MARK_CAP,
  buildClassSeries,
  computeDashboardTotals,
  computeRosterBits,
} from "../lib/dashboard-utils";

describe("computeDashboardTotals", () => {
  it("由 compare 求和在册 / 已提交 / 未提交与提交率", () => {
    const totals = computeDashboardTotals([
      { key: "一班", total: 40, submitted: 30 },
      { key: "二班", total: 20, submitted: 15 },
    ]);
    expect(totals.enrolled).toBe(60);
    expect(totals.submitted).toBe(45);
    expect(totals.unsubmitted).toBe(15);
    expect(totals.rateText).toBe("75.0%");
  });

  it("空数组：全零且提交率走零保护文案", () => {
    const totals = computeDashboardTotals([]);
    expect(totals.enrolled).toBe(0);
    expect(totals.submitted).toBe(0);
    expect(totals.unsubmitted).toBe(0);
    expect(totals.rateText).toBe("-");
  });

  it("全员已提交时未提交为 0、提交率 100%", () => {
    const totals = computeDashboardTotals([{ key: "一班", total: 12, submitted: 12 }]);
    expect(totals.unsubmitted).toBe(0);
    expect(totals.rateText).toBe("100.0%");
  });
});

describe("computeRosterBits", () => {
  it("每 10 格断一栏，尾组不足 10", () => {
    const { groups } = computeRosterBits(24, 17);
    expect(groups).toHaveLength(3);
    expect(groups[0]).toHaveLength(10);
    expect(groups[1]).toHaveLength(10);
    expect(groups[2]).toHaveLength(4);
    // 前面人数按 submitted 填充：第 17 格之后为未提交
    expect(groups[0].every(Boolean)).toBe(true);
    expect(groups[2].every((filled) => !filled)).toBe(true);
  });

  it("tickStep：单人按上限 6ms，人数增多收敛到不超过 6", () => {
    expect(computeRosterBits(1, 0).tickStep).toBe(6);
    expect(computeRosterBits(67, 0).tickStep).toBe(6);
    expect(computeRosterBits(200, 0).tickStep).toBe(2);
  });

  it("超过 ROSTER_MARK_CAP 时退化为空分组（比例轨）", () => {
    const { groups } = computeRosterBits(ROSTER_MARK_CAP + 1, 0);
    expect(groups).toEqual([]);
  });
});

describe("buildClassSeries", () => {
  it("把 counts 摊平为顶层字段并保留 date", () => {
    const series = buildClassSeries([
      { date: "2026-10-17", counts: { 一班: 2, 二班: 3 } },
    ]);
    expect(series).toEqual([{ 一班: 2, 二班: 3, date: "2026-10-17" }]);
  });

  it("班名恰为 date 时也不覆盖 X 轴日期字段（date 写在展开之后）", () => {
    const series = buildClassSeries([
      { date: "2026-10-17", counts: { date: 5 } },
    ]);
    expect(series[0].date).toBe("2026-10-17");
  });
});
