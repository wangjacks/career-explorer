import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_BAR_TRACK_DARK,
  ASSESSMENT_BAR_TRACK_LIGHT,
  ASSESSMENT_TYPE_COLORS,
  ASSESSMENT_TYPE_FALLBACK_COLOR,
  buildCodeChips,
  buildTypeBars,
  contrastRatio,
  drilldownCounts,
  drilldownQuery,
  filterRosterItems,
  isUnassignedClass,
  relativeLuminance,
  resolveSectionState,
  sortClassesByNeed,
  typeColorOf,
  type AssessmentRosterItem,
} from "../lib/assessment-dashboard";
import type { AssessmentClassCompletion, AssessmentCodeCount, AssessmentStats, AssessmentTypeCount } from "../lib/assessment-stats";

const TYPE_COUNT: AssessmentTypeCount[] = [
  { key: "R", label: "现实型", count: 3 },
  { key: "I", label: "研究型", count: 6 },
  { key: "A", label: "艺术型", count: 0 },
  { key: "S", label: "社会型", count: 9 },
  { key: "E", label: "企业型", count: 2 },
  { key: "C", label: "常规型", count: 1 },
];

const CLASSES: AssessmentClassCompletion[] = [
  { classId: 3, name: "2025级3班", enrolled: 10, assessed: 10, rate: 100 },
  { classId: 1, name: "2025级1班", enrolled: 10, assessed: 2, rate: 20 },
  { classId: 2, name: "2025级2班", enrolled: 5, assessed: 2, rate: 40 },
  { classId: 4, name: "未分班", enrolled: 2, assessed: 2, rate: 100 },
];

function statsFixture(overrides: Partial<AssessmentStats> = {}): AssessmentStats {
  return {
    classes: CLASSES,
    types: TYPE_COUNT,
    codes: [
      { code: "SIA", count: 4, lead: "S", leadLabel: "社会型" },
      { code: "RIC", count: 2, lead: "R", leadLabel: "现实型" },
    ],
    total: { enrolled: 27, assessed: 21, rate: 77.8, lastSubmittedAt: "2026-10-19 10:00:00" },
    ...overrides,
  };
}

describe("六型配色对比度（#232 验收：深浅色主题均可辨识）", () => {
  it("六型齐全，barLight 与 issue 原色一致（E 因对比度加深一档）", () => {
    expect(Object.keys(ASSESSMENT_TYPE_COLORS)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(ASSESSMENT_TYPE_COLORS.R.barLight).toBe("#dc2626");
    expect(ASSESSMENT_TYPE_COLORS.I.barLight).toBe("#2563eb");
    expect(ASSESSMENT_TYPE_COLORS.A.barLight).toBe("#7c3aed");
    expect(ASSESSMENT_TYPE_COLORS.S.barLight).toBe("#059669");
    // issue 写的是 #f59e0b，但它对浅色轨道只有 2.15:1；改用同色相深一档保证 ≥ 3:1（见代码注释）
    expect(ASSESSMENT_TYPE_COLORS.E.barLight).toBe("#b45309");
    expect(ASSESSMENT_TYPE_COLORS.C.barLight).toBe("#0891b2");
  });

  it.each(Object.entries(ASSESSMENT_TYPE_COLORS))("%s：类型条与轨道对比 ≥ 3:1（浅色 + 深色）", (_key, color) => {
    expect(contrastRatio(color.barLight, ASSESSMENT_BAR_TRACK_LIGHT)!).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(color.barDark, ASSESSMENT_BAR_TRACK_DARK)!).toBeGreaterThanOrEqual(3);
  });

  it.each(Object.entries(ASSESSMENT_TYPE_COLORS))("%s：胶囊文字与底色对比 ≥ 4.5:1", (_key, color) => {
    expect(contrastRatio(color.chipFg, color.chipBg)!).toBeGreaterThanOrEqual(4.5);
  });

  it("兜底配色同样满足两条对比度要求", () => {
    expect(contrastRatio(ASSESSMENT_TYPE_FALLBACK_COLOR.chipFg, ASSESSMENT_TYPE_FALLBACK_COLOR.chipBg)!).toBeGreaterThanOrEqual(4.5);
    expect(contrastRatio(ASSESSMENT_TYPE_FALLBACK_COLOR.barLight, ASSESSMENT_BAR_TRACK_LIGHT)!).toBeGreaterThanOrEqual(3);
    expect(contrastRatio(ASSESSMENT_TYPE_FALLBACK_COLOR.barDark, ASSESSMENT_BAR_TRACK_DARK)!).toBeGreaterThanOrEqual(3);
  });

  it("typeColorOf：取首位字母、小写也能认、未知 / 空值走兜底", () => {
    expect(typeColorOf("SIA")).toEqual(ASSESSMENT_TYPE_COLORS.S);
    expect(typeColorOf("s")).toEqual(ASSESSMENT_TYPE_COLORS.S);
    expect(typeColorOf("XYZ")).toEqual(ASSESSMENT_TYPE_FALLBACK_COLOR);
    expect(typeColorOf(null)).toEqual(ASSESSMENT_TYPE_FALLBACK_COLOR);
    expect(typeColorOf("")).toEqual(ASSESSMENT_TYPE_FALLBACK_COLOR);
  });

  it("relativeLuminance / contrastRatio：非法颜色返回 null，黑白色对比 21:1", () => {
    expect(relativeLuminance("#ffffff")).toBeCloseTo(1, 6);
    expect(relativeLuminance("#000000")).toBeCloseTo(0, 6);
    expect(relativeLuminance("not-a-color")).toBeNull();
    expect(contrastRatio("#ffffff", "#000000")).toBeCloseTo(21, 4);
    expect(contrastRatio("#ffffff", "oops")).toBeNull();
  });
});

describe("buildTypeBars", () => {
  it("按最大值归一（百分比一位小数），六型齐全，计数 0 也保留一条空条", () => {
    const bars = buildTypeBars(TYPE_COUNT);
    expect(bars).toHaveLength(6);
    expect(bars.find((bar) => bar.key === "S")).toMatchObject({ count: 9, percent: 100 });
    expect(bars.find((bar) => bar.key === "I")?.percent).toBe(66.7);
    expect(bars.find((bar) => bar.key === "A")).toMatchObject({ count: 0, percent: 0 });
    expect(bars.find((bar) => bar.key === "R")?.barLight).toBe(ASSESSMENT_TYPE_COLORS.R.barLight);
  });

  it("全为 0 时不出现 NaN，百分比统一 0", () => {
    const bars = buildTypeBars(TYPE_COUNT.map((item) => ({ ...item, count: 0 })));
    expect(bars.every((bar) => bar.percent === 0)).toBe(true);
  });

  it("脏数据：负计数钳 0、非字符串 key 被丢弃", () => {
    const bars = buildTypeBars([
      { key: "R", label: "现实型", count: -5 },
      { key: "", label: "空", count: 2 },
    ]);
    expect(bars).toHaveLength(2);
    expect(bars[0]).toMatchObject({ key: "R", count: 0, percent: 0 });
  });
});

describe("sortClassesByNeed：完成进度排序", () => {
  it("交齐比例升序（最该催的在前），未分班恒置末", () => {
    const rows = sortClassesByNeed(CLASSES);
    expect(rows.map((row) => row.name)).toEqual(["2025级1班", "2025级2班", "2025级3班", "未分班"]);
    expect(rows[0].isUnassigned).toBe(false);
    expect(rows[rows.length - 1].isUnassigned).toBe(true);
  });

  it("同比例按班名稳定排序，空数组安全", () => {
    const rows = sortClassesByNeed([
      { classId: 2, name: "二年级", enrolled: 10, assessed: 5, rate: 50 },
      { classId: 1, name: "一年级", enrolled: 10, assessed: 5, rate: 50 },
    ]);
    expect(rows.map((row) => row.name)).toEqual(["二年级", "一年级"].sort((a, b) => a.localeCompare(b, "zh-CN")));
    expect(sortClassesByNeed([])).toEqual([]);
  });

  it("isUnassignedClass：classId 为空或名字是「未分班」", () => {
    expect(isUnassignedClass({ classId: null, name: "2025级1班" })).toBe(true);
    expect(isUnassignedClass({ classId: 1, name: "未分班" })).toBe(true);
    expect(isUnassignedClass({ classId: 1, name: "2025级1班" })).toBe(false);
  });
});

describe("buildCodeChips：热门三字码", () => {
  it("胶囊底色取首位类型色，空 code 被过滤", () => {
    const codes: AssessmentCodeCount[] = [
      { code: "SIA", count: 4, lead: "S", leadLabel: "社会型" },
      { code: "", count: 1, lead: "R", leadLabel: "现实型" },
      { code: "RIC", count: 2, lead: "R", leadLabel: "现实型" },
    ];
    const chips = buildCodeChips(codes);
    expect(chips.map((chip) => chip.code)).toEqual(["SIA", "RIC"]);
    expect(chips[0]).toMatchObject({ chipBg: ASSESSMENT_TYPE_COLORS.S.chipBg });
    expect(chips[1]).toMatchObject({ chipBg: ASSESSMENT_TYPE_COLORS.R.chipBg });
  });
});

describe("下钻目标映射", () => {
  it("三类元素 → 名册接口参数", () => {
    expect(drilldownQuery({ kind: "class", classId: 7, name: "2025级1班" })).toEqual({ classId: 7 });
    expect(drilldownQuery({ kind: "lead", lead: "S", label: "社会型" })).toEqual({ lead: "S" });
    expect(drilldownQuery({ kind: "code", code: "SIA", lead: "S" })).toEqual({ code: "SIA" });
  });

  it("「已测 N / M」：班级取本班，类型 / 三字码的分母是已测总人数", () => {
    const stats = statsFixture();
    expect(drilldownCounts({ kind: "class", classId: 1, name: "2025级1班" }, stats)).toEqual({ assessed: 2, total: 10 });
    expect(drilldownCounts({ kind: "lead", lead: "S", label: "社会型" }, stats)).toEqual({ assessed: 9, total: 21 });
    expect(drilldownCounts({ kind: "code", code: "SIA", lead: "S" }, stats)).toEqual({ assessed: 4, total: 21 });
  });

  it("聚合里找不到目标时返回 0，不抛错（数据刚变过也不会崩）", () => {
    const stats = statsFixture();
    expect(drilldownCounts({ kind: "class", classId: 999, name: "x" }, stats)).toEqual({ assessed: 0, total: 0 });
    expect(drilldownCounts({ kind: "lead", lead: "X", label: "x" }, stats)).toEqual({ assessed: 0, total: 21 });
    expect(drilldownCounts({ kind: "code", code: "ZZZ", lead: "Z" }, stats)).toEqual({ assessed: 0, total: 21 });
  });
});

describe("filterRosterItems：弹窗内筛选", () => {
  const items: AssessmentRosterItem[] = [
    { classId: 1, className: "2025级1班", name: "张三", userCode: "202505050101", code: "SIA", assessedAt: "2026-10-19 10:00:00" },
    { classId: 1, className: "2025级1班", name: "李四", userCode: "202505050102", code: "RIC", assessedAt: "2026-10-19 10:01:00" },
    { classId: 1, className: "2025级1班", name: "Alice", userCode: "202505050103", code: "SIA", assessedAt: "2026-10-19 10:02:00" },
  ];

  it("姓名 / 学号关键字过滤，大小写不敏感", () => {
    expect(filterRosterItems(items, { query: "张" })).toHaveLength(1);
    expect(filterRosterItems(items, { query: "alice" })).toHaveLength(1);
    expect(filterRosterItems(items, { query: "050102" })).toHaveLength(1);
    expect(filterRosterItems(items, { query: "查无此人" })).toEqual([]);
  });

  it("只看某一型按三字码首位过滤，可与关键字叠加", () => {
    expect(filterRosterItems(items, { lead: "S" })).toHaveLength(2);
    expect(filterRosterItems(items, { lead: "R" })).toHaveLength(1);
    expect(filterRosterItems(items, { lead: "S", query: "张" })).toHaveLength(1);
  });

  it("空关键字返回全部；首尾空白不影响", () => {
    expect(filterRosterItems(items, {})).toHaveLength(3);
    expect(filterRosterItems(items, { query: "   " })).toHaveLength(3);
  });
});

describe("resolveSectionState：空态 / 失败态优先级", () => {
  it("先加载、再失败、再看是否开放、再看有没有数据", () => {
    expect(resolveSectionState({ loading: true, failed: false, enabled: true, assessed: 0 })).toBe("loading");
    // 加载中即便之前失败过也先显示加载（重试场景）
    expect(resolveSectionState({ loading: true, failed: true, enabled: true, assessed: 5 })).toBe("loading");
    expect(resolveSectionState({ loading: false, failed: true, enabled: true, assessed: 5 })).toBe("failed");
    expect(resolveSectionState({ loading: false, failed: false, enabled: false, assessed: 5 })).toBe("disabled");
    expect(resolveSectionState({ loading: false, failed: false, enabled: true, assessed: 0 })).toBe("empty");
    expect(resolveSectionState({ loading: false, failed: false, enabled: true, assessed: 3 })).toBe("ready");
  });
});
