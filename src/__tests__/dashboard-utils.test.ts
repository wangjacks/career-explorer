import { describe, it, expect } from "vitest";
import {
  ROSTER_MARK_CAP,
  buildClassSeries,
  buildQuickNavGroups,
  computeDashboardTotals,
  computeRosterBits,
  getTimeGreeting,
  maskStudentCode,
} from "../lib/dashboard-utils";

describe("computeDashboardTotals", () => {
  it("由 compare 求和在册 / 已提交 / 未提交与提交率", () => {
    const totals = computeDashboardTotals([
      { key: "一班", label: "一班", total: 40, submitted: 30 },
      { key: "二班", label: "二班", total: 20, submitted: 15 },
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
    const totals = computeDashboardTotals([{ key: "一班", label: "一班", total: 12, submitted: 12 }]);
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
  it("按 series 顺序生成位置字段并保留 date", () => {
    const series = buildClassSeries(
      [
        { key: "一班", label: "一班" },
        { key: "二班", label: "二班" },
      ],
      [{ date: "2026-10-17", counts: { 一班: 2, 二班: 3 } }]
    );
    expect(series).toEqual([{ date: "2026-10-17", s0: 2, s1: 3 }]);
  });

  it("班名恰为 date / __proto__ 时也不污染图表字段", () => {
    const series = buildClassSeries(
      [
        { key: "date", label: "date" },
        { key: "__proto__", label: "__proto__" },
      ],
      [{ date: "2026-10-17", counts: { date: 5, ["__proto__"]: 6 } }]
    );
    expect(series[0]).toEqual({ date: "2026-10-17", s0: 5, s1: 6 });
  });
});

describe("maskStudentCode", () => {
  it("12 位学号保留首 4 末 4", () => {
    expect(maskStudentCode("202301230156")).toBe("2023****0156");
  });

  it("其它长度也至少遮住中间，不原样返回", () => {
    expect(maskStudentCode("20250505")).toBe("2****5");
    expect(maskStudentCode("123")).toBe("****");
    expect(maskStudentCode("")).toBe("****");
  });
});

describe("getTimeGreeting", () => {
  it("五个时段的边界值（问候语逻辑沿用 #228 之前的口径）", () => {
    expect(getTimeGreeting(0)).toBe("夜深了");
    expect(getTimeGreeting(4)).toBe("夜深了");
    expect(getTimeGreeting(5)).toBe("早上好");
    expect(getTimeGreeting(10)).toBe("早上好");
    expect(getTimeGreeting(11)).toBe("中午好");
    expect(getTimeGreeting(12)).toBe("中午好");
    expect(getTimeGreeting(13)).toBe("下午好");
    expect(getTimeGreeting(17)).toBe("下午好");
    expect(getTimeGreeting(18)).toBe("晚上好");
    expect(getTimeGreeting(23)).toBe("晚上好");
  });
});

describe("buildQuickNavGroups", () => {
  const groups = [
    { items: [{ key: "home" }, { key: "standalone" }] },
    { label: "数据中心", items: [{ key: "overview" }, { key: "dashboard" }] },
    { label: "系统设置", items: [{ key: "home" }] },
  ];

  it("去掉当前页自身，并把只剩当前页的分组整个丢掉", () => {
    expect(buildQuickNavGroups(groups, "home")).toEqual([
      { items: [{ key: "standalone" }] },
      { label: "数据中心", items: [{ key: "overview" }, { key: "dashboard" }] },
    ]);
  });

  it("组内顺序与组顺序保持不变（卡片顺序跟随侧边栏）", () => {
    const quick = buildQuickNavGroups(groups, "home");
    expect(quick.map((group) => group.label)).toEqual([undefined, "数据中心"]);
    expect(quick[1].items.map((item) => item.key)).toEqual(["overview", "dashboard"]);
  });

  it("不修改入参：侧边栏用的那份导航数据不能被快捷入口的过滤改掉", () => {
    const snapshot = JSON.parse(JSON.stringify(groups));
    buildQuickNavGroups(groups, "home");
    expect(groups).toEqual(snapshot);
  });

  it("非主页场景：过滤的是传入的当前栏目 key（不硬编码主页）", () => {
    expect(buildQuickNavGroups(groups, "overview")[1].items.map((item) => item.key)).toEqual(["dashboard"]);
    expect(buildQuickNavGroups(groups, "standalone")[0].items.map((item) => item.key)).toEqual(["home"]);
  });
});
