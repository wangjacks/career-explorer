import { describe, it, expect } from "vitest";
import {
  ROSTER_MARK_CAP,
  buildClassSubmissionRows,
  buildClassSeries,
  buildQuickNavGroups,
  computeDashboardTotals,
  computeRosterBits,
  filterRosterStudents,
  getTimeGreeting,
  maskStudentCode,
  type RosterStudent,
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

describe("buildClassSubmissionRows", () => {
  it("按提交率升序，未分班固定置末", () => {
    const rows = buildClassSubmissionRows([
      { key: "一班", total: 10, submitted: 8 },
      { key: "未分班", total: 4, submitted: 0 },
      { key: "二班", total: 10, submitted: 2 },
      { key: "三班", total: 5, submitted: 1 },
    ]);
    expect(rows.map((row) => row.key)).toEqual(["二班", "三班", "一班", "未分班"]);
    expect(rows[0]).toMatchObject({ unsubmitted: 8, rate: 0.2, rateText: "20.0%" });
  });

  it("同率按班名稳定排序，零分母走零保护文案", () => {
    const rows = buildClassSubmissionRows([
      { key: "B班", total: 10, submitted: 5 },
      { key: "A班", total: 10, submitted: 5 },
      { key: "空班", total: 0, submitted: 0 },
    ]);
    expect(rows.map((row) => row.key)).toEqual(["空班", "A班", "B班"]);
    expect(rows[0].rateText).toBe("-");
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

describe("filterRosterStudents", () => {
  const students: RosterStudent[] = [
    { name: "张三", userCode: "202301230156", submitted: true, submittedAt: "2026-10-18 09:30:00", tagCount: 2 },
    { name: "李四", userCode: "202301230157", submitted: false, submittedAt: null, tagCount: 0 },
    { name: "王五", userCode: "202301230158", submitted: true, submittedAt: "2026-10-18 10:00:00", tagCount: 1 },
  ];

  it("按状态筛选", () => {
    expect(filterRosterStudents(students, "pending", "").map((s) => s.name)).toEqual(["李四"]);
    expect(filterRosterStudents(students, "submitted", "").map((s) => s.name)).toEqual(["张三", "王五"]);
  });

  it("按姓名或完整学号搜索（展示虽脱敏，搜索仍匹配完整值）", () => {
    expect(filterRosterStudents(students, "all", "张").map((s) => s.name)).toEqual(["张三"]);
    expect(filterRosterStudents(students, "all", "202301230158").map((s) => s.name)).toEqual(["王五"]);
    expect(filterRosterStudents(students, "all", "不存在")).toEqual([]);
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
