import { describe, it, expect } from "vitest";
import {
  HERO_BG_DARK,
  PROGRESS_GRID_CAP,
  PROGRESS_GRID_MAX_COLUMNS,
  PROGRESS_GRID_MIN_COLUMNS,
  TICK_STROKE_DARK,
  buildHeroRows,
  buildInterestCompositionBar,
  buildProgressGrid,
  buildReminderText,
  assessmentCodeOfColumn,
  formatRate,
  lowestScaleColumnForRow,
  normalizeCompletionStats,
  normalizeInterestByClass,
  pickActionTarget,
  scaleLabelOf,
  type CompletionColumnView,
  type CompletionRowView,
} from "../lib/teacher-board";

const PROFILE = "profile";
const RIASEC = "assessment:riasec";
const BIG_FIVE = "assessment:ipip-neo-ffi";

function columns(): CompletionColumnView[] {
  return [
    { key: PROFILE, label: "档案提交", scaleName: "", scoringMode: null },
    { key: RIASEC, label: "兴趣测评", scaleName: "霍兰德职业兴趣测评", scoringMode: "typological" },
    { key: BIG_FIVE, label: "人格测评", scaleName: "大五人格测评", scoringMode: "dimensional" },
  ];
}

function row(
  classId: number,
  name: string,
  enrolled: number,
  values: { profile: number; riasec?: number; bigFive?: number },
  canDrilldown = true
): CompletionRowView {
  const rate = (done: number) => (enrolled > 0 ? Math.round((done / enrolled) * 1000) / 10 : 0);
  return {
    classId,
    name,
    enrolled,
    canDrilldown,
    cells: {
      [PROFILE]: { done: values.profile, rate: rate(values.profile) },
      [RIASEC]: { done: values.riasec ?? 0, rate: rate(values.riasec ?? 0) },
      [BIG_FIVE]: { done: values.bigFive ?? 0, rate: rate(values.bigFive ?? 0) },
    },
  };
}

describe("buildProgressGrid（#314 点阵规格）", () => {
  it("按班名 zh-CN 排序、同名用 classId 破平、未分班置末", () => {
    const grid = buildProgressGrid(
      [
        row(3, "测试班", 2, { profile: 1 }),
        row(2, "2026智能2班", 3, { profile: 1 }),
        row(1, "2026智能1班", 4, { profile: 2 }),
      ],
      { name: "还没分班", enrolled: 2, cells: { [PROFILE]: { done: 1, rate: 50 } } }
    );
    expect(grid.groups.map((group) => group.name)).toEqual([
      "2026智能1班",
      "2026智能2班",
      "测试班",
      "还没分班",
    ]);
    expect(grid.groups[grid.groups.length - 1].classId).toBeNull();
  });

  it("组内填充该班前 assessed 格，其余为未交", () => {
    const grid = buildProgressGrid([row(1, "1班", 5, { profile: 2 })]);
    expect(grid.groups[0].ticks).toEqual([true, true, false, false, false]);
    expect(grid.groups[0].assessed).toBe(2);
    expect(grid.groups[0].total).toBe(5);
  });

  it("列数 clamp(12, 60, ceil(total / 2))：小班取下限、大校取上限", () => {
    const small = buildProgressGrid([row(1, "1班", 3, { profile: 1 })]);
    expect(small.columns).toBe(PROGRESS_GRID_MIN_COLUMNS);
    // 4 人 → ceil(2) 也不足下限，仍取 12
    expect(small.mode).toBe("ticks");

    const many = Array.from({ length: 10 }, (_, index) =>
      row(index + 1, `${index + 1}班`, 13, { profile: 0 })
    ); // 130 人 → ceil(65) 钳到 60
    const grid = buildProgressGrid(many);
    expect(grid.total).toBe(130);
    expect(grid.columns).toBe(PROGRESS_GRID_MAX_COLUMNS);
  });

  it("人数超过 cap 整体退化为比例轨（不再是逐格点阵）", () => {
    const many = Array.from({ length: 3 }, (_, index) =>
      row(index + 1, `${index + 1}班`, 70, { profile: 10 })
    ); // 210 人 > 200
    const grid = buildProgressGrid(many);
    expect(grid.total).toBe(210);
    expect(grid.mode).toBe("ratio");
    expect(grid.columns).toBe(0);
    expect(grid.groups.every((group) => group.ticks.length === 0)).toBe(true);
    expect(grid.rate).toBeCloseTo(14.3, 1);
  });

  it("正好等于 cap 时仍走逐格点阵", () => {
    const exact = Array.from({ length: 4 }, (_, index) =>
      row(index + 1, `${index + 1}班`, 50, { profile: 5 })
    );
    const grid = buildProgressGrid(exact, null, PROGRESS_GRID_CAP);
    expect(grid.total).toBe(PROGRESS_GRID_CAP);
    expect(grid.mode).toBe("ticks");
    expect(grid.columns).toBe(PROGRESS_GRID_MAX_COLUMNS);
  });

  it("输出不含任何学生身份：每格只有布尔位，没有 title / 学号 / 姓名", () => {
    const grid = buildProgressGrid([row(1, "1班", 3, { profile: 1 })]);
    const serialized = JSON.stringify(grid);
    for (const banned of ["title", "userCode", "student", "姓名"]) {
      expect(serialized).not.toContain(banned);
    }
    for (const group of grid.groups) {
      for (const tick of group.ticks) expect(typeof tick).toBe("boolean");
    }
  });

  it("空班不进入点阵（enrolled = 0 的班不占格）", () => {
    const grid = buildProgressGrid([row(1, "空班", 0, { profile: 0 })]);
    expect(grid.groups).toEqual([]);
    expect(grid.total).toBe(0);
    expect(grid.rate).toBe(0);
  });
});

describe("pickActionTarget（行动条优先级）", () => {
  it("只在允许下钻的行里选完成率最低的启用量表", () => {
    const rows = [
      row(1, "1班", 10, { profile: 9, riasec: 2, bigFive: 5 }),
      row(2, "2班", 10, { profile: 8, riasec: 1, bigFive: 9 }),
    ];
    const target = pickActionTarget(rows, columns());
    expect(target?.columnKey).toBe(RIASEC);
    expect(target?.scaleLabel).toBe("兴趣测评");
    expect(target?.missingCount).toBe(17);
    expect(target?.done).toBe(3);
    expect(target?.enrolled).toBe(20);
  });

  it("切「所有班级」时行不可下钻 → 行动条不出现", () => {
    const rows = [row(1, "1班", 10, { profile: 9, riasec: 2 }, false)];
    expect(pickActionTarget(rows, columns())).toBeNull();
  });

  it("按缺口降序列出班、并标出完全没开始的班", () => {
    const rows = [
      row(1, "1班", 10, { profile: 9, riasec: 0, bigFive: 10 }),
      row(2, "2班", 10, { profile: 9, riasec: 8, bigFive: 10 }),
      row(3, "3班", 10, { profile: 9, riasec: 3, bigFive: 10 }),
    ];
    const target = pickActionTarget(rows, columns());
    expect(target?.notStarted).toEqual(["1班"]);
    expect(target?.missingClasses.map((item) => item.name)).toEqual(["1班", "3班", "2班"]);
    expect(target?.missingCount).toBe(10 + 7 + 2);
  });

  it("全部做完时仍返回目标（missingCount = 0，文案走正向提示）", () => {
    const rows = [row(1, "1班", 10, { profile: 10, riasec: 10, bigFive: 10 })];
    const target = pickActionTarget(rows, columns());
    expect(target?.missingCount).toBe(0);
    expect(target?.notStarted).toEqual([]);
  });

  it("没有启用量表列时返回 null（只算档案进度不构成行动条）", () => {
    const rows = [row(1, "1班", 10, { profile: 5 })];
    expect(pickActionTarget(rows, [columns()[0]])).toBeNull();
  });
});

describe("buildReminderText（提醒话术）", () => {
  it("包含班名与人数，不含学生姓名与「全校 / 还差」", () => {
    const text = buildReminderText(
      [
        { name: "1班", missing: 10 },
        { name: "2班", missing: 7 },
      ],
      "兴趣测评"
    );
    expect(text).toContain("1班");
    expect(text).toContain("2班");
    expect(text).toContain("17");
    expect(text).toContain("兴趣测评");
    for (const banned of ["全校", "还差", "在册", "提交率", "已提交", "未提交"]) {
      expect(text).not.toContain(banned);
    }
  });

  it("超过 3 个班只列前三个并标出总班数，人数按全部缺交班合计", () => {
    const text = buildReminderText(
      [
        { name: "1班", missing: 10 },
        { name: "2班", missing: 5 },
        { name: "3班", missing: 3 },
        { name: "4班", missing: 2 },
        { name: "5班", missing: 1 },
      ],
      "兴趣测评"
    );
    expect(text).toContain("1班、2班、3班 等 5 个班");
    expect(text).toContain("21");
    expect(text).not.toContain("4班");
  });

  it("没人缺交或班名为空时不生成话术", () => {
    expect(buildReminderText([{ name: "1班", missing: 0 }], "兴趣测评")).toBe("");
    expect(buildReminderText([], "兴趣测评")).toBe("");
    expect(buildReminderText([{ name: "  ", missing: 3 }], "兴趣测评")).toBe("");
  });

  it("负数与脏人数按 0 处理", () => {
    expect(buildReminderText([{ name: "1班", missing: Number.NaN }], "兴趣测评")).toBe("");
    expect(buildReminderText([{ name: "1班", missing: -5 }], "兴趣测评")).toBe("");
  });
});

describe("buildInterestCompositionBar（矩阵兴趣构成列）", () => {
  const byClass = [
    {
      classId: 1,
      name: "1班",
      assessed: 3,
      types: [
        { key: "S", count: 2 },
        { key: "I", count: 1 },
        { key: "R", count: 0 },
        { key: "A", count: 0 },
        { key: "E", count: 0 },
        { key: "C", count: 0 },
      ],
    },
  ];

  it("只输出计数 > 0 的类型，百分比按已测人数归一", () => {
    const bar = buildInterestCompositionBar(byClass, 1);
    expect(bar.assessed).toBe(3);
    expect(bar.segments.map((segment) => segment.key)).toEqual(["I", "S"]);
    const social = bar.segments.find((segment) => segment.key === "S");
    expect(social?.count).toBe(2);
    expect(social?.percent).toBeCloseTo(66.7, 1);
    expect(social?.label).toBe("社会型");
    expect(social?.color).toBeTruthy();
  });

  it("没有该班数据 / 全是 0 时返回空段", () => {
    expect(buildInterestCompositionBar(byClass, 99)).toEqual({ assessed: 0, segments: [] });
    expect(
      buildInterestCompositionBar(
        [{ classId: 2, name: "2班", assessed: 0, types: [{ key: "S", count: 0 }] }],
        2
      )
    ).toEqual({ assessed: 0, segments: [] });
    expect(buildInterestCompositionBar(null, 1)).toEqual({ assessed: 0, segments: [] });
  });

  it("未分班（classId = null）也能取到自己的构成", () => {
    const bar = buildInterestCompositionBar(
      [{ classId: null as unknown as number, name: "还没分班", assessed: 1, types: [{ key: "E", count: 1 }] }],
      null
    );
    expect(bar.assessed).toBe(1);
  });
});

describe("防御式解析（界面不出现 NaN）", () => {
  it("normalizeCompletionStats：脏计数按 0、空班剔除、列由接口驱动", () => {
    const parsed = normalizeCompletionStats({
      columns: [
        { key: "profile", label: "档案提交" },
        { key: "assessment:riasec", label: "兴趣测评", scoringMode: "typological" },
        { key: "assessment:riasec", label: "重复列" },
        { key: "assessment:broken", label: "" },
      ],
      rows: [
        {
          classId: 1,
          name: "1班",
          enrolled: 10,
          canDrilldown: true,
          cells: { profile: { done: "x", rate: Number.NaN }, "assessment:riasec": { done: 3, rate: 30 } },
        },
        { classId: 2, name: "空班", enrolled: 0, cells: {} },
        { classId: "bad", name: "脏班", enrolled: 5, cells: {} },
      ],
      unassigned: { name: "还没分班", enrolled: 2, cells: { profile: { done: 1, rate: 50 } } },
      total: { enrolled: 12, cells: { profile: { done: 1, rate: 8.3 } } },
    });
    expect(parsed).not.toBeNull();
    expect(parsed?.columns.map((column) => column.key)).toEqual(["profile", "assessment:riasec", "assessment:broken"]);
    expect(parsed?.rows.map((item) => item.name)).toEqual(["1班"]);
    expect(parsed?.rows[0].cells.profile).toEqual({ done: 0, rate: 0 });
    expect(parsed?.unassigned?.enrolled).toBe(2);
    expect(parsed?.total.enrolled).toBe(12);
    const serialized = JSON.stringify(parsed);
    expect(serialized).not.toContain("NaN");
  });

  it("normalizeCompletionStats：形状不对返回 null（页面走失败态），不是空矩阵", () => {
    expect(normalizeCompletionStats(null)).toBeNull();
    expect(normalizeCompletionStats({ columns: [], rows: [] })).not.toBeNull();
    expect(normalizeCompletionStats({})).toBeNull();
    expect(normalizeCompletionStats({ columns: "x", rows: [] })).toBeNull();
  });

  it("normalizeInterestByClass：脏类型过滤", () => {
    const parsed = normalizeInterestByClass({
      byClass: [
        { classId: 1, name: "1班", assessed: "x", types: [{ key: "s", count: "2" }, { key: "?", count: 3 }] },
        { classId: 0, types: [] },
      ],
    });
    expect(parsed).toHaveLength(1);
    expect(parsed[0].assessed).toBe(0);
    expect(parsed[0].types).toEqual([{ key: "S", count: 0 }]);
  });
});

describe("小工具", () => {
  it("formatRate：一位小数、越界钳制、脏值给 -", () => {
    expect(formatRate(55)).toBe("55.0%");
    expect(formatRate(0)).toBe("0.0%");
    expect(formatRate(120)).toBe("100.0%");
    expect(formatRate(Number.NaN)).toBe("-");
  });

  it("assessmentCodeOfColumn / scaleLabelOf：短名映射与回退", () => {
    expect(assessmentCodeOfColumn(RIASEC)).toBe("riasec");
    expect(assessmentCodeOfColumn(PROFILE)).toBeNull();
    expect(scaleLabelOf("riasec", "正式名", { riasec: "兴趣测评" })).toBe("兴趣测评");
    expect(scaleLabelOf("unknown", "正式名", { riasec: "兴趣测评" })).toBe("正式名");
    expect(scaleLabelOf(null, "正式名", {})).toBe("正式名");
  });

  it("lowestScaleColumnForRow：取该行完成率最低的量表", () => {
    const r = row(1, "1班", 10, { profile: 5, riasec: 9, bigFive: 2 });
    expect(lowestScaleColumnForRow(r, columns())?.key).toBe(BIG_FIVE);
  });

  it("buildHeroRows：行由列驱动，空量表显示 untouched", () => {
    const rows = buildHeroRows(
      columns(),
      {
        enrolled: 10,
        cells: {
          profile: { done: 6, rate: 60 },
          [RIASEC]: { done: 0, rate: 0 },
          [BIG_FIVE]: { done: 4, rate: 40 },
        },
      },
      { riasec: "兴趣测评", "ipip-neo-ffi": "人格测评" }
    );
    expect(rows.map((item) => item.label)).toEqual(["档案提交", "兴趣测评", "人格测评"]);
    expect(rows[1].untouched).toBe(true);
    expect(rows[2].done).toBe(4);
  });
});

describe("深色主题点阵描边对比度（#314 验收）", () => {
  /** sRGB → 相对亮度（WCAG 2.x） */
  function luminance(rgb: [number, number, number]): number {
    const [r, g, b] = rgb.map((value) => {
      const channel = value / 255;
      return channel <= 0.03928 ? channel / 12.92 : Math.pow((channel + 0.055) / 1.055, 2.4);
    });
    return 0.2126 * r + 0.7152 * g + 0.0722 * b;
  }

  function parseHex(hex: string): [number, number, number] {
    const clean = hex.replace("#", "");
    return [0, 2, 4].map((offset) => parseInt(clean.slice(offset, offset + 2), 16)) as [number, number, number];
  }

  function parseRgba(value: string): { rgb: [number, number, number]; alpha: number } {
    const match = value.match(/rgba?\(([^)]+)\)/);
    if (!match) throw new Error(`bad color: ${value}`);
    const parts = match[1].split(",").map((part) => Number(part.trim()));
    return { rgb: [parts[0], parts[1], parts[2]], alpha: parts[3] ?? 1 };
  }

  function contrast(color: string, background: string): number {
    const bg = parseHex(background);
    const fg = parseRgba(color);
    const blended = fg.rgb.map((channel, index) =>
      Math.round(channel * fg.alpha + bg[index] * (1 - fg.alpha))
    ) as [number, number, number];
    const light = Math.max(luminance(blended), luminance(bg));
    const dark = Math.min(luminance(blended), luminance(bg));
    return (light + 0.05) / (dark + 0.05);
  }

  it("深色 hero 上的半透明薄荷绿描边 ≥ 3:1", () => {
    expect(contrast(TICK_STROKE_DARK, HERO_BG_DARK)).toBeGreaterThanOrEqual(3);
  });
});

/* ------------------------------------------------------------------ */
/* 结构卡（#315）：兴趣结构与人格轮廓                                     */
/* ------------------------------------------------------------------ */

import {
  INTEREST_SAMPLE_THRESHOLD,
  buildBigFiveTeacherRows,
  buildInterestStructure,
  buildStructureClassOptions,
  interestCodeLabel,
  normalizeBigFiveStats,
  normalizeInterestStats,
  type BigFiveStatsView,
  type InterestStatsView,
} from "../lib/teacher-board";

function interestPayload() {
  return {
    scope: "mine",
    assessment: { code: "riasec", name: "霍兰德职业兴趣测评", scaleVersion: "1.0", enabled: true },
    types: [
      { key: "R", label: "现实型", count: 0 },
      { key: "I", label: "研究型", count: 1 },
      { key: "A", label: "艺术型", count: 0 },
      { key: "S", label: "社会型", count: 2 },
      { key: "E", label: "企业型", count: 1 },
      { key: "C", label: "常规型", count: 0 },
    ],
    byClass: [
      {
        classId: 1,
        name: "1班",
        assessed: 2,
        types: [
          { key: "S", count: 2 },
          { key: "I", count: 0 },
        ],
      },
      {
        classId: 2,
        name: "2班",
        assessed: 2,
        types: [
          { key: "I", count: 1 },
          { key: "E", count: 1 },
        ],
      },
    ],
    codes: [
      { code: "SIA", count: 2 },
      { code: "IEC", count: 1 },
    ],
    total: { enrolled: 10, assessed: 4, rate: 40, lastSubmittedAt: "2026-10-20 10:00" },
  };
}

function bigFivePayload() {
  return {
    scope: "mine",
    assessment: {
      code: "ipip-neo-ffi",
      name: "大五人格测评",
      enabled: true,
      scoringMode: "dimensional",
      dimensions: [
        { key: "N", label: "神经质" },
        { key: "E", label: "外向性" },
      ],
    },
    total: { enrolled: 10, assessed: 6, rate: 60, invalidCount: 2, lastSubmittedAt: "2026-10-20 11:00" },
    dimensions: [
      { key: "N", label: "神经质", low: 1, medium: 2, high: 1 },
      { key: "E", label: "外向性", low: "x", medium: 3, high: 0 },
    ],
  };
}

describe("结构卡班级选择（#315）", () => {
  it("全部班级排第一，空班不进选项，其余沿用矩阵顺序", () => {
    const options = buildStructureClassOptions([
      { classId: 2, name: "2班", enrolled: 10 },
      { classId: 1, name: "1班", enrolled: 0 },
      { classId: 3, name: "3班", enrolled: 5 },
    ]);
    expect(options.map((option) => option.classId)).toEqual([null, 2, 3]);
    expect(options[0].name).toBe("");
  });
});

describe("normalizeInterestStats / buildInterestStructure（#315 兴趣结构卡）", () => {
  it("六型恒补齐为 RIASEC 顺序，缺的补 0、标签回退中文名", () => {
    const stats = normalizeInterestStats({
      ...interestPayload(),
      types: [{ key: "S", count: 2 }],
    });
    expect(stats?.types.map((type) => type.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(stats?.types.find((type) => type.key === "S")?.count).toBe(2);
    expect(stats?.types.find((type) => type.key === "R")?.label).toBe("现实型");
  });

  it("全部班级：按合计出六条切片、中心数字 = 计数之和、组合胶囊取 Top-6", () => {
    const stats = normalizeInterestStats(interestPayload());
    const view = buildInterestStructure(stats, null);
    expect(view.assessed).toBe(4);
    expect(view.slices).toHaveLength(6);
    expect(view.slices.find((slice) => slice.key === "S")?.percent).toBe(50);
    expect(view.slices.find((slice) => slice.key === "S")?.count).toBe(2);
    expect(view.codes.map((chip) => chip.code)).toEqual(["SIA", "IEC"]);
    expect(interestCodeLabel("SIA")).toBe("社会型 · 研究型 · 艺术型");
  });

  it("选具体班：在前端按 byClass 过滤（不重发请求），班级维度没有组合数据", () => {
    const stats = normalizeInterestStats(interestPayload());
    const view = buildInterestStructure(stats, 2);
    expect(view.assessed).toBe(2);
    expect(view.slices.find((slice) => slice.key === "I")?.count).toBe(1);
    expect(view.slices.find((slice) => slice.key === "E")?.count).toBe(1);
    expect(view.slices.find((slice) => slice.key === "S")?.count).toBe(0);
    expect(view.codes).toEqual([]);
  });

  it("样本门槛：少于 5 人提示仅供参考；0 人交给页面空态", () => {
    const stats = normalizeInterestStats(interestPayload());
    expect(buildInterestStructure(stats, null).sampleTooSmall).toBe(true);
    expect(buildInterestStructure(stats, 99).assessed).toBe(0);
    expect(buildInterestStructure(stats, 99).sampleTooSmall).toBe(false);
    expect(INTEREST_SAMPLE_THRESHOLD).toBe(5);
  });

  it("脏数据：错误形状返回 null，脏计数按 0，界面不会出现 NaN", () => {
    expect(normalizeInterestStats(null)).toBeNull();
    expect(normalizeInterestStats({})).not.toBeNull();
    const dirty = normalizeInterestStats({
      assessment: { code: "riasec", name: "x", enabled: false },
      types: [{ key: "S", count: "oops" }],
      codes: [{ code: "sia", count: 1 }, { code: "sia", count: 2 }],
      total: { enrolled: Number.NaN, assessed: -3, rate: 999 },
    });
    expect(dirty?.enabled).toBe(false);
    expect(dirty?.types.find((type) => type.key === "S")?.count).toBe(0);
    // 同码去重；比例钳到 100
    expect(dirty?.codes).toEqual([{ code: "SIA", count: 1 }]);
    expect(dirty?.total.rate).toBe(100);
    expect(JSON.stringify(dirty)).not.toContain("NaN");
  });
});

describe("normalizeBigFiveStats / buildBigFiveTeacherRows（#315 人格轮廓卡）", () => {
  it("保持接口下发的五项顺序，不做分值排序；三档百分比按本行合计归一", () => {
    const stats = normalizeBigFiveStats(bigFivePayload());
    expect(stats?.dimensions.map((row) => row.key)).toEqual(["N", "E"]);
    const n = stats?.dimensions[0];
    expect(n?.total).toBe(4);
    expect(n?.percents).toEqual({ low: 25, medium: 50, high: 25 });
    // 脏计数按 0：E 行 = 0 + 3 + 0 = 3
    expect(stats?.dimensions[1].total).toBe(3);
    expect(stats?.dimensions[1].low).toBe(0);
  });

  it("invalidCount 钳到已测人数以内；停用返回 enabled=false（页面显示未开放）", () => {
    const dirty = normalizeBigFiveStats({
      ...bigFivePayload(),
      total: { enrolled: 10, assessed: 3, rate: 30, invalidCount: 99 },
    });
    expect(dirty?.total.invalidCount).toBe(3);
    expect(dirty?.enabled).toBe(true);

    const disabled = normalizeBigFiveStats({
      ...bigFivePayload(),
      assessment: { ...bigFivePayload().assessment, enabled: false },
    });
    expect(disabled?.enabled).toBe(false);
  });

  it("形状不对返回 null；五项为空数组仍可渲染空态", () => {
    expect(normalizeBigFiveStats(null)).toBeNull();
    expect(normalizeBigFiveStats({})).toBeNull();
    const empty = normalizeBigFiveStats({
      assessment: { code: "ipip-neo-ffi", name: "大五人格测评", enabled: true },
      dimensions: [],
      total: { enrolled: 10, assessed: 0, rate: 0, invalidCount: 0 },
    });
    expect(empty?.dimensions).toEqual([]);
  });

  it("教师显示名按 key 注入（N 换成情绪敏感度），行顺序不变", () => {
    const stats = normalizeBigFiveStats(bigFivePayload()) as BigFiveStatsView;
    const rows = buildBigFiveTeacherRows(stats, (key, fallback) =>
      key === "N" ? "情绪敏感度（神经质 N）" : fallback
    );
    expect(rows.map((row) => row.teacherLabel)).toEqual(["情绪敏感度（神经质 N）", "外向性"]);
    expect(rows.map((row) => row.key)).toEqual(["N", "E"]);
  });

  it("兴趣/人格的结构视图都不携带个人标识", () => {
    const interest = buildInterestStructure(normalizeInterestStats(interestPayload()) as InterestStatsView, null);
    const bigFive = normalizeBigFiveStats(bigFivePayload());
    for (const payload of [interest, bigFive]) {
      const text = JSON.stringify(payload);
      expect(text).not.toContain("userCode");
      expect(text).not.toContain("name\":\"张");
    }
  });
});