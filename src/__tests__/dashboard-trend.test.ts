import { describe, it, expect } from "vitest";
import {
  computeTrendTotal,
  mergeTrendEntry,
  selectTrendView,
  trendEntryKey,
  type TrendCache,
  type TrendEntry,
} from "../lib/dashboard-trend";

const total30: TrendEntry = { days: 30, group: "total", trends: [{ date: "2026-10-01", count: 3 }] };
const total7: TrendEntry = {
  days: 7,
  group: "total",
  trends: [
    { date: "2026-10-10", count: 2 },
    { date: "2026-10-11", count: 4 },
  ],
};
const class7: TrendEntry = {
  days: 7,
  group: "class",
  classTrend: {
    series: [
      { key: "一班", label: "一班" },
      { key: "date", label: "date" },
    ],
    points: [{ date: "2026-10-10", counts: { 一班: 5, date: 6 } }],
  },
};

describe("trendEntryKey", () => {
  it("同输入同串，天数或分组任一变化即换键", () => {
    expect(trendEntryKey({ days: 30, group: "total" })).toBe(trendEntryKey({ days: 30, group: "total" }));
    expect(trendEntryKey({ days: 7, group: "total" })).not.toBe(trendEntryKey({ days: 30, group: "total" }));
    expect(trendEntryKey({ days: 7, group: "class" })).not.toBe(trendEntryKey({ days: 7, group: "total" }));
  });
});

describe("selectTrendView", () => {
  it("命中当前选择 → ready，且就是那一份数据（切回不重复请求）", () => {
    const cache: TrendCache = { [trendEntryKey({ days: 7, group: "total" })]: total7 };
    const view = selectTrendView(cache, { days: 7, group: "total" });
    expect(view.status).toBe("ready");
    if (view.status === "ready") expect(view.entry).toBe(total7);
  });

  it("空缓存 → loading：不把「还没到」画成空图表", () => {
    expect(selectTrendView({}, { days: 30, group: "total" })).toEqual({ status: "loading" });
  });

  it("只有别的口径 → loading（切 30→7 的在途期不许沿用 30 天曲线）", () => {
    const cache: TrendCache = { [trendEntryKey({ days: 30, group: "total" })]: total30 };
    expect(selectTrendView(cache, { days: 7, group: "total" }).status).toBe("loading");
  });

  it("分组隔离：只有 class:7 时选择 {7,total} → loading", () => {
    const cache: TrendCache = { [trendEntryKey({ days: 7, group: "class" })]: class7 };
    expect(selectTrendView(cache, { days: 7, group: "total" }).status).toBe("loading");
  });

  it("两份都取过之后切回旧口径 → 命中旧口径那一份，而不是最后一次写入的", () => {
    const cache: TrendCache = mergeTrendEntry(mergeTrendEntry({}, total30), total7);
    const view = selectTrendView(cache, { days: 30, group: "total" });
    expect(view.status).toBe("ready");
    if (view.status === "ready") expect(view.entry).toBe(total30);
  });

  it("匹配到但窗口内确实没有提交 → ready（空数组是结论，不是加载态）", () => {
    const empty: TrendEntry = { days: 7, group: "total", trends: [] };
    const cache: TrendCache = { [trendEntryKey({ days: 7, group: "total" })]: empty };
    expect(selectTrendView(cache, { days: 7, group: "total" })).toEqual({ status: "ready", entry: empty });
  });
});

describe("mergeTrendEntry", () => {
  it("不可变：不改写入参，同键覆盖自己、不动别的槽", () => {
    const base: TrendCache = { [trendEntryKey({ days: 30, group: "total" })]: total30 };
    const snapshot: TrendCache = JSON.parse(JSON.stringify(base));
    const next = mergeTrendEntry(mergeTrendEntry(base, total7), { ...total30, trends: [] });
    expect(base).toEqual(snapshot);
    expect(Object.keys(next).sort()).toEqual(["total:30", "total:7"]);
    expect(next[trendEntryKey({ days: 7, group: "total" })]).toBe(total7);
    expect(next[trendEntryKey({ days: 30, group: "total" })]).toEqual({ ...total30, trends: [] });
  });

  it("键由数据自身派生：写入项与键始终一致", () => {
    const next = mergeTrendEntry({}, class7);
    expect(Object.keys(next)).toEqual([trendEntryKey({ days: 7, group: "class" })]);
  });
});

describe("computeTrendTotal", () => {
  it("合计模式逐日求和；空数组为 0", () => {
    expect(computeTrendTotal(total7)).toBe(6);
    expect(computeTrendTotal({ days: 7, group: "total", trends: [] })).toBe(0);
  });

  it("按班级模式跨 counts 求和（存在名为 date 的班级时合计仍是纯数值和）", () => {
    expect(computeTrendTotal(class7)).toBe(11);
    expect(computeTrendTotal({ days: 1, group: "class", classTrend: { series: [], points: [] } })).toBe(0);
  });
});
