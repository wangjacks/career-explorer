import { describe, it, expect } from "vitest";
import {
  DEFAULT_TREND_DAYS,
  MAX_TREND_DAYS,
  buildDateRange,
  fillClassTrend,
  fillGroupedTrend,
  fillTrendSeries,
  formatRateText,
  mapCompareRows,
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

describe("fillGroupedTrend", () => {
  it("每个分组在窗口内都补齐为等长的 N 个点", () => {
    const series = fillGroupedTrend(
      [
        { date: "2026-09-28", key: "一班", label: "一班", count: 2 },
        { date: "2026-09-30", key: "二班", label: "二班", count: 5 },
      ],
      "2026-09-28",
      3
    );
    expect(series.series).toEqual([
      { key: "一班", label: "一班" },
      { key: "二班", label: "二班" },
    ]);
    expect(series.points).toEqual([
      { date: "2026-09-28", counts: { 一班: 2, 二班: 0 } },
      { date: "2026-09-29", counts: { 一班: 0, 二班: 0 } },
      { date: "2026-09-30", counts: { 一班: 0, 二班: 5 } },
    ]);
  });

  it("未分班哨兵固定排末尾，真实班名「未分班」按 key 正常排序", () => {
    const series = fillGroupedTrend(
      [
        { date: "2026-09-29", key: "__unassigned__", label: "未分班", count: 1 },
        { date: "2026-09-29", key: "未分班", label: "未分班", count: 2 },
        { date: "2026-09-29", key: "一班", label: "一班", count: 1 },
      ],
      "2026-09-29",
      1
    );
    expect(series.series.map((group) => group.key)).toEqual([
      "一班",
      "未分班",
      "__unassigned__",
    ]);
  });

  it("排序与适配器返回顺序无关（JS 稳定排序，锁两库一致）", () => {
    const series = fillGroupedTrend(
      [
        { date: "2026-09-29", key: "二班", label: "二班", count: 1 },
        { date: "2026-09-29", key: "一班", label: "一班", count: 1 },
      ],
      "2026-09-29",
      1
    );
    expect(series.series.map((group) => group.key)).toEqual(["一班", "二班"]);
  });

  it("同「日期 + 分组」累加，轴外数据丢弃", () => {
    const series = fillGroupedTrend(
      [
        { date: "2026-09-29", key: "一班", label: "一班", count: 2 },
        { date: "2026-09-29", key: "一班", label: "一班", count: 3 },
        { date: "2026-09-27", key: "一班", label: "一班", count: 9 },
        { date: "2026-10-05", key: "一班", label: "一班", count: 9 },
      ],
      "2026-09-28",
      2
    );
    expect(series.series).toEqual([{ key: "一班", label: "一班" }]);
    expect(series.points).toEqual([
      { date: "2026-09-28", counts: { 一班: 0 } },
      { date: "2026-09-29", counts: { 一班: 5 } },
    ]);
  });

  it("空结果是「无分组 + 每天空计数」，不是空数组", () => {
    const series = fillGroupedTrend([], "2026-09-28", 2);
    expect(series.series).toEqual([]);
    expect(series.points).toEqual([
      { date: "2026-09-28", counts: {} },
      { date: "2026-09-29", counts: {} },
    ]);
  });

  it("班名为 __proto__ 时 counts 建立自有属性，不污染原型", () => {
    const series = fillGroupedTrend(
      [{ date: "2026-09-29", key: "__proto__", label: "__proto__", count: 2 }],
      "2026-09-29",
      1
    );
    const counts = series.points[0].counts;
    expect(Object.hasOwn(counts, "__proto__")).toBe(true);
    expect(counts["__proto__"]).toBe(2);
    expect(Object.getPrototypeOf(counts)).toBe(Object.prototype);
  });
});

describe("fillClassTrend", () => {
  it("原始行统一映射：字符串计数、NULL 班级归哨兵，点数等于窗口天数", () => {
    const series = fillClassTrend(
      [
        { d: "2026-09-29", class_id: 7, class_name: "一班", cnt: "2" },
        { d: "2026-09-29", class_id: null, class_name: null, cnt: 1 },
      ],
      "2026-09-28",
      2
    );
    expect(series.series).toEqual([
      { key: "一班", label: "一班" },
      { key: "__unassigned__", label: "未分班" },
    ]);
    expect(series.points).toEqual([
      { date: "2026-09-28", counts: { 一班: 0, __unassigned__: 0 } },
      { date: "2026-09-29", counts: { 一班: 2, __unassigned__: 1 } },
    ]);
  });

  it("驱动返回 Date 时按本地日历日归一，不因 UTC 偏移跨日", () => {
    const series = fillClassTrend(
      [{ d: new Date(2026, 8, 29), class_id: 7, class_name: "一班", cnt: 1 }],
      "2026-09-29",
      1
    );
    expect(series.points[0].date).toBe("2026-09-29");
  });
});

describe("mapCompareRows", () => {
  it("归一字符串数值、NULL submitted 记 0，未分班置末", () => {
    expect(
      mapCompareRows([
        { class_id: "7", class_name: "一班", total: "10", submitted: "8" },
        { class_id: null, class_name: null, total: "4", submitted: null },
      ])
    ).toEqual([
      { key: "一班", label: "一班", total: 10, submitted: 8 },
      { key: "__unassigned__", label: "未分班", total: 4, submitted: 0 },
    ]);
  });

  it("真实班名「未分班」与哨兵分开；悬空 class_id 归哨兵；同名 key 聚合", () => {
    expect(
      mapCompareRows([
        { class_id: 3, class_name: "未分班", total: 2, submitted: 1 },
        { class_id: null, class_name: null, total: 4, submitted: 2 },
        { class_id: 4, class_name: "未分班", total: 3, submitted: 2 },
        { class_id: 8, class_name: null, total: 2, submitted: 0 },
      ])
    ).toEqual([
      { key: "未分班", label: "未分班", total: 5, submitted: 3 },
      { key: "__unassigned__", label: "未分班", total: 6, submitted: 2 },
    ]);
  });

  it("排序与适配器返回顺序无关（JS 稳定排序，锁两库一致）", () => {
    expect(
      mapCompareRows([
        { class_id: 2, class_name: "B班", total: 1, submitted: 0 },
        { class_id: 1, class_name: "A班", total: 1, submitted: 0 },
      ]).map((item) => item.key)
    ).toEqual(["A班", "B班"]);
  });

  it("空输入返回空数组", () => {
    expect(mapCompareRows([])).toEqual([]);
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
