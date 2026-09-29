import { describe, it, expect } from "vitest";
import {
  DEFAULT_TREND_DAYS,
  MAX_TREND_DAYS,
  buildDateRange,
  fillTrendSeries,
  formatRateText,
  normalizeTrendDays,
  shiftDate,
} from "../lib/stats-utils";

describe("shiftDate", () => {
  it("按日历天加减，跨月跨年进位正确", () => {
    expect(shiftDate("2026-09-29", 1)).toBe("2026-09-30");
    expect(shiftDate("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftDate("2026-01-01", -1)).toBe("2025-12-31");
    expect(shiftDate("2026-03-01", -1)).toBe("2026-02-28");
    expect(shiftDate("2026-09-29", 0)).toBe("2026-09-29");
  });

  it("往返幂等", () => {
    for (const date of ["2026-01-01", "2026-02-28", "2026-12-31"]) {
      expect(shiftDate(shiftDate(date, 30), -30)).toBe(date);
    }
  });
});

describe("normalizeTrendDays", () => {
  it("非法值回落到默认天数", () => {
    expect(normalizeTrendDays("abc")).toBe(DEFAULT_TREND_DAYS);
    expect(normalizeTrendDays(Number.NaN)).toBe(DEFAULT_TREND_DAYS);
    expect(normalizeTrendDays(Number.POSITIVE_INFINITY)).toBe(DEFAULT_TREND_DAYS);
    expect(normalizeTrendDays(null)).toBe(DEFAULT_TREND_DAYS);
  });

  it("越界值钳制到 [1, 366]，小数取整", () => {
    expect(normalizeTrendDays(0)).toBe(1);
    expect(normalizeTrendDays(-5)).toBe(1);
    expect(normalizeTrendDays(1e9)).toBe(MAX_TREND_DAYS);
    expect(normalizeTrendDays(7.9)).toBe(7);
    expect(normalizeTrendDays("30")).toBe(30);
  });
});

describe("buildDateRange", () => {
  it("返回 days 个连续日期且升序", () => {
    expect(buildDateRange("2026-09-29", 1)).toEqual(["2026-09-29"]);
    expect(buildDateRange("2026-09-28", 3)).toEqual(["2026-09-28", "2026-09-29", "2026-09-30"]);
  });

  it("跨月连续", () => {
    expect(buildDateRange("2026-09-29", 4)).toEqual([
      "2026-09-29",
      "2026-09-30",
      "2026-10-01",
      "2026-10-02",
    ]);
  });

  it("跨年连续", () => {
    expect(buildDateRange("2025-12-30", 4)).toEqual([
      "2025-12-30",
      "2025-12-31",
      "2026-01-01",
      "2026-01-02",
    ]);
  });
});

describe("fillTrendSeries", () => {
  it("窗口内缺失日期补 0，点数等于 days", () => {
    const series = fillTrendSeries([{ date: "2026-09-30", count: 2 }], "2026-09-28", 3);
    expect(series).toEqual([
      { date: "2026-09-28", count: 0 },
      { date: "2026-09-29", count: 0 },
      { date: "2026-09-30", count: 2 },
    ]);
  });

  it("轴外数据丢弃", () => {
    const series = fillTrendSeries(
      [
        { date: "2026-09-27", count: 9 },
        { date: "2026-10-03", count: 9 },
        { date: "2026-09-28", count: 1 },
      ],
      "2026-09-28",
      2
    );
    expect(series).toEqual([
      { date: "2026-09-28", count: 1 },
      { date: "2026-09-29", count: 0 },
    ]);
  });

  it("同日期累加，空结果全 0", () => {
    const series = fillTrendSeries(
      [
        { date: "2026-09-29", count: 2 },
        { date: "2026-09-29", count: 3 },
      ],
      "2026-09-28",
      2
    );
    expect(series.map((t) => t.count)).toEqual([0, 5]);
    expect(fillTrendSeries([], "2026-09-29", 3).every((t) => t.count === 0)).toBe(true);
  });
});

describe("formatRateText", () => {
  it("分母为 0 返回占位符", () => {
    expect(formatRateText(0, 0)).toBe("-");
    expect(formatRateText(1, 0)).toBe("-");
  });

  it("按位数输出百分比", () => {
    expect(formatRateText(1, 3, 1)).toBe("33.3%");
    expect(formatRateText(1, 2)).toBe("50.00%");
    expect(formatRateText(0, 4, 1)).toBe("0.0%");
    expect(formatRateText(4, 4, 1)).toBe("100.0%");
  });
});
