import { describe, it, expect } from "vitest";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ASSESSMENT_DASHBOARD_COPY, ADMIN_DASHBOARD_COPY, TEACHER_BOARD_COPY, TEACHER_DASHBOARD_COPY, type DashboardCopy } from "../lib/dashboard-copy";
import {
  isReservedClassName,
  UNASSIGNED_CLASS_KEY,
  UNASSIGNED_CLASS_LABEL,
  UNASSIGNED_CLASS_TEACHER_LABEL,
} from "../lib/class-identity";

/** 教师侧不许出现的统计口径词与控件名（#231 替换表的左列及其同族词） */
const JARGON = [
  "在册",
  "全量口径",
  "口径",
  "单位：",
  "柱顶",
  "时间窗口",
  "时间 窗口",
  "趋势天数",
  "趋势分组",
  "按班级",
  "窗口",
  "加载失败",
  "横幅",
  "标签维度",
  "标签次数",
  "分组对比",
  "提交率",
  "已提交",
  "未提交",
  "还差",
  "全员",
  "学生名单",
  "维度",
  "拆分",
];

/**
 * 每个函数字段的样例入参：按字段真实形状喂参数。
 * 早先对所有函数统一喂 `(days, byClass)` 之类的入参，会把布尔值塞进数字参数，
 * 拼出「已交 7 人，全班 false 人，还有 undefined 人没交」这类脏串参与断言（#242 评审 P4）。
 * 新增函数字段却忘了补样例时会直接抛错，确保收集到的永远是真实文案。
 */
const FUNCTION_SAMPLES: Record<string, unknown[][]> = {
  heroAriaTotals: [[18, 24, 6]],
  heroMissing: [[6]],
  trendEyebrow: [[7, false], [30, true]],
  trendTitle: [[false], [true]],
  trendSummaryPrefix: [[30]],
  trendDaysOptionLabel: [[7], [30]],
  compareTooltipTotals: [[24, "75.0%"]],
  classLabel: [
    [UNASSIGNED_CLASS_KEY, UNASSIGNED_CLASS_LABEL],
    ["未分班", "未分班"],
    ["一年二班", "一年二班"],
  ],
};

/** 收集一份文案表里所有会显示给用户的字符串 */
function collectStrings(copy: DashboardCopy): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(copy)) {
    if (typeof value === "string") {
      out.push(value);
      continue;
    }
    if (typeof value !== "function") continue;
    const samples = FUNCTION_SAMPLES[key];
    if (!samples) throw new Error(`函数字段 ${key} 缺少样例入参（FUNCTION_SAMPLES）`);
    const fn = value as unknown as (...args: unknown[]) => string;
    for (const args of samples) out.push(fn(...args));
  }
  return out.filter((text): text is string => typeof text === "string");
}

/** 去掉注释后的组件源码：注释写给开发者看，不参与验收。只剥 `/* *\/` 与整行 `//`，
    避免把字符串里的 `//`（以后文案里出现链接）也吃掉，导致源码扫描失真（#242 评审 P5）。 */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split(/\r?\n/)
    .map((line) => (line.trimStart().startsWith("//") ? "" : line))
    .join("\n");
}

/** 源码里所有含中文的字符串/模板串字面量（含引号，便于失败信息定位） */
function cjkLiterals(source: string): string[] {
  const s = stripComments(source);
  const literals = new Set<string>();
  const patterns = [/"(?:[^"\\]|\\.)*"/g, /'(?:[^'\\]|\\.)*'/g, /`(?:[^`\\]|\\.)*`/g];
  for (const pattern of patterns) {
    for (const match of s.match(pattern) ?? []) {
      if (/[\u4e00-\u9fa5]/.test(match)) literals.add(match);
    }
  }
  return [...literals].sort();
}

function kitSourceWithoutComments(): string {
  return stripComments(readFileSync(join(process.cwd(), "src/components/admin/DashboardKit.tsx"), "utf8"));
}

describe("TEACHER_DASHBOARD_COPY", () => {
  it("教师侧所有文案都不含统计口径词与开发控件名", () => {
    const strings = collectStrings(TEACHER_DASHBOARD_COPY);
    expect(strings.length).toBeGreaterThan(25);
    for (const text of strings) {
      for (const word of JARGON) {
        expect(text, `教师侧文案残留「${word}」：${text}`).not.toContain(word);
      }
    }
  });

  it("标题不再带单位，单位由 tooltip 与轴表达", () => {
    expect(TEACHER_DASHBOARD_COPY.trendTitle(false)).toBe("提交趋势");
    expect(TEACHER_DASHBOARD_COPY.trendTitle(true)).toBe("各班提交趋势");
    expect(TEACHER_DASHBOARD_COPY.distTitle).toBe("各类标签被提到多少次");
    expect(TEACHER_DASHBOARD_COPY.compareTitle).toBe("各班完成情况（柱子高度＝人数）");
  });

  it("按 issue 替换表逐条落地（「全班」按实际数据范围改成「学生总数」，见 #242 评审 P1）", () => {
    expect(TEACHER_DASHBOARD_COPY.heroSubmittedOfTotal).toBe("已交 / 学生总数");
    expect(TEACHER_DASHBOARD_COPY.heroRateLabel).toBe("交齐比例");
    expect(TEACHER_DASHBOARD_COPY.heroMissing(5)).toBe("还有 5 人没交");
    expect(TEACHER_DASHBOARD_COPY.heroAllSubmitted).toBe("所有学生都交齐了");
    expect(TEACHER_DASHBOARD_COPY.heroProgressFailed).toBe("进度没取到，点上面的「重试」再来一次。");
    expect(TEACHER_DASHBOARD_COPY.heroNoStudents).toBe("还没有学生，导入名单后这里会显示提交进度。");
    expect(TEACHER_DASHBOARD_COPY.trendEyebrow(30, false)).toBe("最近 30 天");
    expect(TEACHER_DASHBOARD_COPY.trendEyebrow(7, true)).toBe("最近 7 天 · 分班级");
    expect(TEACHER_DASHBOARD_COPY.trendDaysAriaLabel).toBe("看几天");
    expect(TEACHER_DASHBOARD_COPY.trendGroupAriaLabel).toBe("怎么看（所有班级 · 分班级）");
    expect(TEACHER_DASHBOARD_COPY.trendScopeNote).toBe("上面两个按钮只改这张图");
    expect(TEACHER_DASHBOARD_COPY.trendLoadingByClass).toBe("正在分班统计…");
    expect(TEACHER_DASHBOARD_COPY.trendEmptyTitle).toBe("这几天还没有学生提交");
    expect(TEACHER_DASHBOARD_COPY.trendEmptyHint).toBe("可以把天数拉长一些，或者提醒学生开始填写。");
    expect(TEACHER_DASHBOARD_COPY.distEyebrow).toBe("学生常提哪类");
    expect(TEACHER_DASHBOARD_COPY.fullScopeNote).toBe("这里统计的是全部记录，不受上面「最近 N 天」影响");
    expect(TEACHER_DASHBOARD_COPY.compareEyebrow).toBe("各班比一比");
    expect(TEACHER_DASHBOARD_COPY.compareRateNote).toBe("每根柱子上方是交齐比例");
    expect(TEACHER_DASHBOARD_COPY.compareEmptyTitle).toBe("还没有学生");
    expect(TEACHER_DASHBOARD_COPY.compareEmptyHint).toBe("先去「班级管理」建班、到「学生管理」导入名单，这里就能比较各班的完成情况。");
    expect(TEACHER_DASHBOARD_COPY.chartFailedHint).toBe("点上面的「重试」再来一次。");
  });

  it("分组按钮的文字与 aria-label 用同一个词，不出现按钮说一套、读屏说一套", () => {
    const aria = TEACHER_DASHBOARD_COPY.trendGroupAriaLabel;
    expect(TEACHER_DASHBOARD_COPY.trendGroupTotalLabel).toBe("所有班级");
    expect(TEACHER_DASHBOARD_COPY.trendGroupClassLabel).toBe("分班级");
    expect(aria).toContain(TEACHER_DASHBOARD_COPY.trendGroupTotalLabel);
    expect(aria).toContain(TEACHER_DASHBOARD_COPY.trendGroupClassLabel);
  });

  it("aria-label 仍完整读出人数，只换措辞", () => {
    expect(TEACHER_DASHBOARD_COPY.heroAriaTotals(18, 24, 6)).toBe("已交 18 人，学生共 24 人，还有 6 人没交");
    for (const number of [18, 24, 6]) {
      expect(TEACHER_DASHBOARD_COPY.heroAriaTotals(18, 24, 6)).toContain(String(number));
    }
  });

  it("不把全校数据说成「本班 / 全班」（数据源没有教师范围过滤，#242 评审 P1）", () => {
    const strings = collectStrings(TEACHER_DASHBOARD_COPY);
    for (const text of strings) {
      expect(text, `教师侧文案暗示了班级范围：${text}`).not.toMatch(/全班|本班/);
    }
  });

  it("只有未分班哨兵改口，真实班名「未分班」原样透出", () => {
    expect(
      TEACHER_DASHBOARD_COPY.classLabel(UNASSIGNED_CLASS_KEY, UNASSIGNED_CLASS_LABEL)
    ).toBe(UNASSIGNED_CLASS_TEACHER_LABEL);
    expect(TEACHER_DASHBOARD_COPY.classLabel("未分班", "未分班")).toBe("未分班");
    expect(TEACHER_DASHBOARD_COPY.classLabel("一年二班", "一年二班")).toBe("一年二班");
    expect(TEACHER_DASHBOARD_COPY.classLabel("", "")).toBe("");
    // 教师口语若被改掉，保留名集合必须同步，否则又能建出同名班级
    expect(
      isReservedClassName(
        TEACHER_DASHBOARD_COPY.classLabel(UNASSIGNED_CLASS_KEY, UNASSIGNED_CLASS_LABEL)
      )
    ).toBe(true);
  });

  it("卡底合计的左右两半拼出与旧版一致的句子", () => {
    expect(`${TEACHER_DASHBOARD_COPY.trendSummaryPrefix(30)}12${TEACHER_DASHBOARD_COPY.trendSummarySuffix}`).toBe("近 30 天共 12 人提交");
  });
});

describe("ADMIN_DASHBOARD_COPY", () => {
  it("管理端沿用改动前的口径词，未被连带修改", () => {
    expect(ADMIN_DASHBOARD_COPY.heroSubmittedOfTotal).toBe("已提交 / 在册");
    expect(ADMIN_DASHBOARD_COPY.heroRateLabel).toBe("提交率");
    expect(ADMIN_DASHBOARD_COPY.heroMissing(5)).toBe("还差 5 人未提交");
    expect(ADMIN_DASHBOARD_COPY.heroAllSubmitted).toBe("全员已提交");
    expect(ADMIN_DASHBOARD_COPY.heroAriaTotals(18, 24, 6)).toBe("已提交 18 人，在册 24 人，未提交 6 人");
    expect(ADMIN_DASHBOARD_COPY.heroProgressFailed).toBe("提交进度加载失败，点上方横幅的「重试」重新获取。");
    expect(ADMIN_DASHBOARD_COPY.heroNoStudents).toBe("还没有在册学生，导入学生名单后这里会显示提交进度。");
    expect(ADMIN_DASHBOARD_COPY.bannerPartialFailure).toBe("部分数据加载失败，图表可能不完整");
    expect(ADMIN_DASHBOARD_COPY.chartFailedTitle).toBe("数据加载失败");
    expect(ADMIN_DASHBOARD_COPY.chartFailedHint).toBe("点上方横幅的「重试」重新获取。");
    expect(ADMIN_DASHBOARD_COPY.trendEyebrow(30, false)).toBe("时间 窗口");
    expect(ADMIN_DASHBOARD_COPY.trendEyebrow(30, true)).toBe("时间 × 班级");
    expect(ADMIN_DASHBOARD_COPY.trendTitle(false)).toBe("提交趋势（单位：人数）");
    expect(ADMIN_DASHBOARD_COPY.trendTitle(true)).toBe("各班提交趋势（单位：人数）");
    expect(ADMIN_DASHBOARD_COPY.trendScopeNote).toBe("趋势天数与分组仅作用于本图");
    expect(ADMIN_DASHBOARD_COPY.trendGroupAriaLabel).toBe("趋势分组");
    expect(ADMIN_DASHBOARD_COPY.trendGroupTotalLabel).toBe("全校");
    expect(ADMIN_DASHBOARD_COPY.trendGroupClassLabel).toBe("按班级");
    expect(ADMIN_DASHBOARD_COPY.trendDaysAriaLabel).toBe("趋势天数");
    expect(ADMIN_DASHBOARD_COPY.trendLoadingByClass).toBe("正在按班级拆分…");
    expect(ADMIN_DASHBOARD_COPY.trendEmptyTitle).toBe("所选窗口内还没有提交记录");
    expect(ADMIN_DASHBOARD_COPY.trendEmptyHint).toBe("把趋势天数调大一些，或确认学生是否已开始填写档案。");
    expect(ADMIN_DASHBOARD_COPY.trendFailedSummary).toBe("趋势数据加载失败，暂不显示本窗口合计");
    expect(ADMIN_DASHBOARD_COPY.distEyebrow).toBe("标签维度");
    expect(ADMIN_DASHBOARD_COPY.distTitle).toBe("标签分类分布（单位：标签次数）");
    expect(ADMIN_DASHBOARD_COPY.fullScopeNote).toBe("全量口径，不随趋势天数与分组变化");
    expect(ADMIN_DASHBOARD_COPY.distCenterLabel).toBe("标签次数");
    expect(ADMIN_DASHBOARD_COPY.distEmptyHint).toBe("学生提交档案后，这里会按兴趣 / 技能 / 性格等维度汇总标签次数。");
    expect(ADMIN_DASHBOARD_COPY.compareEyebrow).toBe("分组对比");
    expect(ADMIN_DASHBOARD_COPY.compareTitle).toBe("班级对比（单位：人数，柱高 = 总人数）");
    expect(ADMIN_DASHBOARD_COPY.compareLegendSubmitted).toBe("已提交");
    expect(ADMIN_DASHBOARD_COPY.compareLegendUnsubmitted).toBe("未提交");
    expect(ADMIN_DASHBOARD_COPY.compareRateNote).toBe("柱顶为该组提交率");
    expect(ADMIN_DASHBOARD_COPY.compareTooltipTotals(24, "75.0%")).toBe("在册 24 人 · 提交率 75.0%");
    expect(ADMIN_DASHBOARD_COPY.compareEmptyTitle).toBe("还没有在册学生");
    expect(ADMIN_DASHBOARD_COPY.compareEmptyHint).toBe("先在「班级管理」与「学生名单」中建立班级并导入学生，这里就能看到各组提交对比。");
  });

  it("班级名一律原样展示，管理端不做口语替换", () => {
    expect(ADMIN_DASHBOARD_COPY.classLabel(UNASSIGNED_CLASS_KEY, "未分班")).toBe("未分班");
    expect(ADMIN_DASHBOARD_COPY.classLabel("未分班", "未分班")).toBe("未分班");
    expect(ADMIN_DASHBOARD_COPY.classLabel("一年二班", "一年二班")).toBe("一年二班");
  });
});

describe("两份文案表的结构", () => {
  it("字段完全对齐，任何一侧漏字段都会在这里暴露", () => {
    const adminKeys = Object.keys(ADMIN_DASHBOARD_COPY).sort();
    expect(Object.keys(TEACHER_DASHBOARD_COPY).sort()).toEqual(adminKeys);
  });

  it("每个字段都有内容，字符串非空、函数对样例入参返回非空", () => {
    for (const copy of [ADMIN_DASHBOARD_COPY, TEACHER_DASHBOARD_COPY]) {
      for (const [key, value] of Object.entries(copy)) {
        if (typeof value === "function") continue;
        expect(value, `${key} 为空`).toBeTruthy();
      }
      const strings = collectStrings(copy);
      expect(strings.length).toBeGreaterThan(0);
      for (const text of strings) expect(text.trim()).not.toBe("");
    }
  });

  it("两侧共用的文案保持一致（重试按钮、整页加载、趋势合计句式、tooltip 单位与日期前缀）", () => {
    expect(TEACHER_DASHBOARD_COPY.retryButton).toBe(ADMIN_DASHBOARD_COPY.retryButton);
    expect(TEACHER_DASHBOARD_COPY.pageLoading).toBe(ADMIN_DASHBOARD_COPY.pageLoading);
    expect(TEACHER_DASHBOARD_COPY.trendPendingNote).toBe(ADMIN_DASHBOARD_COPY.trendPendingNote);
    expect(TEACHER_DASHBOARD_COPY.trendSummaryPrefix(14)).toBe(ADMIN_DASHBOARD_COPY.trendSummaryPrefix(14));
    expect(TEACHER_DASHBOARD_COPY.trendSummarySuffix).toBe(ADMIN_DASHBOARD_COPY.trendSummarySuffix);
    expect(TEACHER_DASHBOARD_COPY.trendTooltipSeriesName).toBe(ADMIN_DASHBOARD_COPY.trendTooltipSeriesName);
    expect(TEACHER_DASHBOARD_COPY.distEmptyTitle).toBe(ADMIN_DASHBOARD_COPY.distEmptyTitle);
    // tooltip 的单位 / 日期前缀与天数按钮文字：两角色同值，但必须都从表里取（组件内不硬编码）
    expect(TEACHER_DASHBOARD_COPY.tooltipPeopleUnit).toBe(ADMIN_DASHBOARD_COPY.tooltipPeopleUnit);
    expect(TEACHER_DASHBOARD_COPY.tooltipDatePrefix).toBe(ADMIN_DASHBOARD_COPY.tooltipDatePrefix);
    expect(TEACHER_DASHBOARD_COPY.trendDaysOptionLabel(7)).toBe("7天");
    expect(TEACHER_DASHBOARD_COPY.trendDaysOptionLabel(7)).toBe(ADMIN_DASHBOARD_COPY.trendDaysOptionLabel(7));
  });
});

describe("DashboardKit 的取数与文案解耦", () => {
  it("组件源码里没有任何面向用户的中文字面量", () => {
    // 未分班的展示文案已随 key/label 分离移到接口与文案表，组件内不再需要数据值白名单。
    // 比「黑名单扫口径词」更硬：以后新增图表时把任何中文文案写回组件，这里都会直接失败（#242 评审 P3）
    expect(cjkLiterals(readFileSync(join(process.cwd(), "src/components/admin/DashboardKit.tsx"), "utf8"))).toEqual([]);
  });

  it("四块卡片与失败态都从 copy 取文，缺 copy 会编译不过", () => {
    const source = kitSourceWithoutComments();
    expect(source).toContain("copy: DashboardCopy");
    for (const component of ["SubmissionHero", "TrendCard", "DistributionCard", "CompareCard", "ChartFailed"]) {
      expect(source, `${component} 未接收 copy`).toMatch(new RegExp(`export function ${component}\\([^)]*copy`));
    }
  });

  it("两个角色各自注入自己的文案表，且互不串用", () => {
    const adminSource = stripComments(readFileSync(join(process.cwd(), "src/components/admin/AdminDashboardTab.tsx"), "utf8"));
    const teacherSource = stripComments(readFileSync(join(process.cwd(), "src/components/admin/TeacherDashboardTab.tsx"), "utf8"));

    expect(adminSource).toContain("ADMIN_DASHBOARD_COPY");
    expect(adminSource).not.toContain("TEACHER_DASHBOARD_COPY");
    expect(adminSource).not.toContain("TEACHER_BOARD_COPY");
    // 教师端：新看板用自己的文案表，仅共用的 DistributionCard 需要 DashboardCopy
    expect(teacherSource).toContain("TEACHER_BOARD_COPY");
    expect(teacherSource).toContain("TEACHER_DASHBOARD_COPY");
    expect(teacherSource).not.toContain("ADMIN_DASHBOARD_COPY");

    // 管理端 hero 零改动：SubmissionHero 只留在管理端；教师端换成新看板的 hero
    expect(adminSource).toContain("SubmissionHero");
    expect(teacherSource).not.toContain("SubmissionHero");
    expect(teacherSource).toContain("DistributionCard");
    for (const component of ["TrendCard", "CompareCard"]) {
      expect(adminSource.split(component).length - 1).toBeGreaterThanOrEqual(1);
      expect(teacherSource.split(component).length - 1).toBe(0);
    }

    // 新看板三块（#314）：页头 → hero → 矩阵 → 行动条
    for (const component of ["TeacherBoardHero", "CompletionMatrix", "ActionStrip"]) {
      expect(teacherSource, `教师端缺少 ${component}`).toContain(component);
    }
    // 旧的重复展示已删除（提交进度 hero / 班级提交列表 / 测评卡）
    for (const component of ["ClassSubmissionCard", "TeacherAssessmentCard"]) {
      expect(teacherSource.split(component).length - 1).toBe(0);
    }
    expect(existsSync(join(process.cwd(), "src/components/admin/TeacherDashboardCards.tsx"))).toBe(false);
    expect(existsSync(join(process.cwd(), "src/components/admin/TeacherAssessmentCard.tsx"))).toBe(false);
  });
});

/** 测评栏（#232）函数字段的样例入参：形状与真实调用一致，漏补会直接抛错 */
const ASSESSMENT_FUNCTION_SAMPLES: Record<string, unknown[][]> = {
  classCounts: [[2, 10]],
  classAriaLabel: [["2025级1班", 2, 10]],
  typeAriaLabel: [["社会型", 9]],
  codeAriaLabel: [["SIA", 4]],
  codeCountLabel: [[4]],
  drilldownSummary: [[4, 10]],
  drilldownTitleClass: [["2025级1班"]],
  drilldownTitleType: [["社会型"]],
  drilldownTitleCode: [["SIA"]],
};

function collectAssessmentStrings(): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(ASSESSMENT_DASHBOARD_COPY)) {
    if (typeof value === "string") {
      out.push(value);
      continue;
    }
    if (typeof value !== "function") continue;
    const samples = ASSESSMENT_FUNCTION_SAMPLES[key];
    if (!samples) throw new Error(`函数字段 ${key} 缺少样例入参（ASSESSMENT_FUNCTION_SAMPLES）`);
    const fn = value as unknown as (...args: unknown[]) => string;
    for (const args of samples) out.push(fn(...args));
  }
  return out;
}

describe("ASSESSMENT_DASHBOARD_COPY（#232 大屏测评栏）", () => {
  it("沿用教师侧口语化词表：不含统计口径词，也不说「全班 / 本班」", () => {
    const strings = collectAssessmentStrings();
    expect(strings.length).toBeGreaterThan(20);
    for (const text of strings) {
      for (const word of JARGON) {
        expect(text, `测评栏文案残留「${word}」：${text}`).not.toContain(word);
      }
      expect(text, `测评栏文案暗示了班级范围：${text}`).not.toMatch(/全班|本班/);
    }
  });

  it("空态是「行动邀请」：不写「暂无数据」这类孤句", () => {
    const strings = collectAssessmentStrings();
    for (const text of strings) {
      expect(text).not.toMatch(/暂无数据|没有数据|暂无内容/);
    }
    expect(ASSESSMENT_DASHBOARD_COPY.emptyTitle).toContain("还没有");
    expect(ASSESSMENT_DASHBOARD_COPY.emptyHint).toContain("职业测评");
    expect(ASSESSMENT_DASHBOARD_COPY.disabledHint).toContain("开放");
  });

  it("三视图 / 两范围 / 下钻文案逐条落地", () => {
    expect(ASSESSMENT_DASHBOARD_COPY.eyebrow).toBe("测评看板");
    expect(ASSESSMENT_DASHBOARD_COPY.title).toBe("职业兴趣测评");
    expect(ASSESSMENT_DASHBOARD_COPY.scopeAllLabel).toBe("所有班级");
    expect(ASSESSMENT_DASHBOARD_COPY.scopeMineLabel).toBe("只看我的班");
    expect(ASSESSMENT_DASHBOARD_COPY.viewProgressLabel).toBe("完成进度");
    expect(ASSESSMENT_DASHBOARD_COPY.viewTypesLabel).toBe("类型分布");
    expect(ASSESSMENT_DASHBOARD_COPY.viewCodesLabel).toBe("热门三字码");
    expect(ASSESSMENT_DASHBOARD_COPY.classCounts(2, 10)).toBe("已交 2 / 10 人");
    expect(ASSESSMENT_DASHBOARD_COPY.drilldownSummary(4, 10)).toBe("已测 4 / 10 人");
    expect(ASSESSMENT_DASHBOARD_COPY.drilldownTitleClass("2025级1班")).toBe("2025级1班的测评明细");
    expect(ASSESSMENT_DASHBOARD_COPY.drilldownTitleType("社会型")).toBe("社会型学生的测评明细");
    expect(ASSESSMENT_DASHBOARD_COPY.drilldownTitleCode("SIA")).toBe("三字码 SIA 的学生");
    // 投屏提醒：常驻在弹窗标题下与页脚，文案本身也要明确「含个人信息」
    expect(ASSESSMENT_DASHBOARD_COPY.drilldownHint).toContain("个人信息");
    expect(ASSESSMENT_DASHBOARD_COPY.drilldownHint).toContain("投屏");
  });

  it("每个字段都有内容；函数字段对样例入参返回非空", () => {
    for (const [key, value] of Object.entries(ASSESSMENT_DASHBOARD_COPY)) {
      if (typeof value === "function") continue;
      expect(value, `${key} 为空`).toBeTruthy();
    }
    for (const text of collectAssessmentStrings()) expect(text.trim()).not.toBe("");
  });

  it("名册弹窗与看板三块的源码里没有任何面向用户的中文字面量（全部走文案表）", () => {
    for (const file of [
      "src/components/admin/TeacherBoardHero.tsx",
      "src/components/admin/CompletionMatrix.tsx",
      "src/components/admin/ActionStrip.tsx",
      "src/components/admin/AssessmentRosterDialog.tsx",
    ]) {
      expect(cjkLiterals(readFileSync(join(process.cwd(), file), "utf8")), `${file} 里有硬编码中文`).toEqual([]);
    }
  });

  it("投屏提醒在弹窗里常驻：标题下与页脚各出现一次，且不受加载态影响", () => {
    const dialogSource = stripComments(
      readFileSync(join(process.cwd(), "src/components/admin/AssessmentRosterDialog.tsx"), "utf8")
    );
    const occurrences = dialogSource.split("copy.drilldownHint").length - 1;
    expect(occurrences).toBeGreaterThanOrEqual(2);
  });
});

/** #314 看板文案表的函数字段样例：形状与真实调用一致，漏补会直接抛错 */
const BOARD_FUNCTION_SAMPLES: Record<string, unknown[][]> = {
  heroMissing: [[45]],
  heroGridAria: [[68, 113]],
  heroGridGroup: [["1班", 29, 53]],
  matrixEnrolledSub: [[53]],
  matrixCellRate: [["55.0%"]],
  matrixProfileCellLabel: [["2025级1班", 29, 53]],
  matrixScaleCellAria: [["2025级1班", "兴趣测评", 1, 34]],
  matrixMissingAria: [["2025级1班", "兴趣测评", 45]],
  matrixCompositionSummary: [[2, "社会型 1 · 研究型 1"]],
  matrixCompositionSegmentAria: [["社会型", 1]],
  actionNotStarted: [["1班、2班"]],
  actionMissing: [["兴趣测评", 111]],
  rosterTitleDone: [["2025级1班", "兴趣测评"]],
  rosterTitleAllDone: [["兴趣测评"]],
  rosterTitleAllMissing: [["兴趣测评"]],
  rosterTitleMissing: [["2025级1班", "兴趣测评"]],
  rosterBandLabel: [["high"], ["medium"], ["low"]],
  rosterCountLabel: [[12]],
};

function collectBoardStrings(): string[] {
  const out: string[] = [];
  for (const [key, value] of Object.entries(TEACHER_BOARD_COPY)) {
    if (typeof value === "string") {
      out.push(value);
      continue;
    }
    if (typeof value !== "function") continue;
    const samples = BOARD_FUNCTION_SAMPLES[key];
    if (!samples) throw new Error(`函数字段 ${key} 缺少样例入参（BOARD_FUNCTION_SAMPLES）`);
    const fn = value as unknown as (...args: unknown[]) => string;
    for (const args of samples) out.push(fn(...args));
  }
  return out;
}

describe("TEACHER_BOARD_COPY（#314 测评看板）", () => {
  it("沿用教师侧禁用词表，且不说「全校 / 全班 / 本班」", () => {
    const strings = collectBoardStrings();
    expect(strings.length).toBeGreaterThan(40);
    for (const text of strings) {
      for (const word of JARGON) {
        expect(text, `看板文案残留「${word}」：${text}`).not.toContain(word);
      }
      expect(text, `看板文案暗示了范围：${text}`).not.toMatch(/全校|全班|本班/);
    }
  });

  it("空态是「行动邀请」，不写「暂无数据」这类孤句", () => {
    const strings = collectBoardStrings();
    for (const text of strings) {
      expect(text).not.toMatch(/暂无数据|没有数据|暂无内容/);
    }
    expect(TEACHER_BOARD_COPY.heroNoStudents).toContain("还没有");
    expect(TEACHER_BOARD_COPY.matrixEmptyTitle).toContain("还没有");
    expect(TEACHER_BOARD_COPY.matrixEmptyHint).toContain("导入名单");
  });

  it("页头 / hero / 矩阵 / 行动条 / 名册文案逐条落地", () => {
    expect(TEACHER_BOARD_COPY.eyebrow).toBe("数据中心 / 数据大屏");
    expect(TEACHER_BOARD_COPY.title).toBe("测评看板");
    expect(TEACHER_BOARD_COPY.scopeMineLabel).toBe("我带的班");
    expect(TEACHER_BOARD_COPY.scopeAllLabel).toBe("所有班级");
    expect(TEACHER_BOARD_COPY.heroGridCaption).toBe("每格 1 人 · 按班排列");
    expect(TEACHER_BOARD_COPY.heroGridAria(68, 113)).toBe("已交 68 人，学生共 113 人，按班分组示意");
    expect(TEACHER_BOARD_COPY.heroMissing(45)).toBe("还有 45 人没交");
    expect(TEACHER_BOARD_COPY.heroScaleNote).toBe("与档案提交分开计算");
    expect(TEACHER_BOARD_COPY.matrixCellEmpty).toBe("还没开始");
    expect(TEACHER_BOARD_COPY.matrixScaleCellAria("2025级1班", "兴趣测评", 1, 34)).toBe(
      "2025级1班 · 兴趣测评 · 已测 1 / 34 人 · 查看名单"
    );
    expect(TEACHER_BOARD_COPY.matrixProfileCellLabel("2025级1班", 29, 53)).toBe(
      "2025级1班 · 档案提交 · 已交 29 / 53 人"
    );
    expect(TEACHER_BOARD_COPY.matrixCompositionTooltip).toContain("一人只按三字码首位计一次");
    expect(TEACHER_BOARD_COPY.actionMissing("兴趣测评", 111)).toBe("兴趣测评还有 111 人没交");
    expect(TEACHER_BOARD_COPY.actionNotStarted("1班、2班")).toBe("1班、2班还没开始");
    expect(TEACHER_BOARD_COPY.actionCopySuccess).toBe("已复制提醒话术");
    expect(TEACHER_BOARD_COPY.rosterTitleMissing("2025级1班", "兴趣测评")).toBe(
      "2025级1班 · 兴趣测评 · 没交名单"
    );
    expect(TEACHER_BOARD_COPY.rosterBandLabel("high")).toBe("偏高");
    expect(TEACHER_BOARD_COPY.rosterBandLabel("low")).toBe("偏低");
    expect(TEACHER_BOARD_COPY.rosterBandLabel("medium")).toBe("中等");
  });

  it("量表口语短名在文案表里定义（接口只给 code 与正式名）", () => {
    expect(TEACHER_BOARD_COPY.scaleLabels.riasec).toBe("兴趣测评");
    expect(TEACHER_BOARD_COPY.scaleLabels["ipip-neo-ffi"]).toBe("人格测评");
  });

  it("每个字段都有内容；函数字段对样例入参返回非空", () => {
    for (const [key, value] of Object.entries(TEACHER_BOARD_COPY)) {
      if (typeof value !== "string") continue;
      expect(value, `${key} 为空`).toBeTruthy();
    }
    for (const text of collectBoardStrings()) expect(text.trim()).not.toBe("");
  });
});

