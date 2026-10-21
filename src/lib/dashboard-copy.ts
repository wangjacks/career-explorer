import { UNASSIGNED_CLASS_KEY, UNASSIGNED_CLASS_TEACHER_LABEL } from "@/lib/class-identity";

/**
 * 数据大屏文案表（#231）。
 *
 * 大屏组件（`DashboardKit.tsx`）由管理员端与教师端共用，但受众不同：管理员熟悉系统口径，
 * 一线教师读不懂「在册 / 全量口径 / 单位：标签次数 / 时间窗口」这类统计与工程用语。
 * 因此所有面向用户的字符串一律从这里取，**共用的 `DashboardKit` 内不得硬编码大屏文案**
 * （各 Tab 是角色专属文件，写死自己的措辞不会串台，如 hero 的 caption）——新增图表时补两个
 * 字段（`ADMIN_DASHBOARD_COPY` 沿用既有口径，`TEACHER_DASHBOARD_COPY` 写口语），而不是把旧术语抄回去。
 *
 * 只影响显示：数据口径、取数参数、图表类型、排序与无障碍语义都不经由这里传递。
 * 例外是 `classLabel`——接口同时下发 `key`（身份）与 `label`（展示），比较、排序与下钻
 * 认 `key`，教师侧只把未分班哨兵键的展示文案换成「还没分班」。
 *
 * **范围口径**：两端读的是同一份**全校**数据（`/api/manage/stats/*` 没有教师/班级过滤），
 * 所以教师侧文案里不能出现「本班 / 全班」这类会被理解成「只看我这个班」的词，
 * 一律用「学生总数 / 所有学生」这类与数据范围一致的说法（#242 评审 P1）。
 */

export interface DashboardCopy {
  /* 页面级 */
  /** 顶部「部分数据取数失败」横幅正文 */
  bannerPartialFailure: string;
  /** 横幅里的重试按钮 */
  retryButton: string;
  /** 首次取数的整页占位 */
  pageLoading: string;

  /* 通用图表状态 */
  /** 卡片内取数失败态标题 */
  chartFailedTitle: string;
  /** 卡片内取数失败态的下一步指引 */
  chartFailedHint: string;
  /** tooltip 数值后缀单位（含前导空格，直接拼在数字后） */
  tooltipPeopleUnit: string;
  /** tooltip 日期行前缀（含尾随空格） */
  tooltipDatePrefix: string;

  /* 提交进度大屏 */
  heroSubmittedOfTotal: string;
  heroRateLabel: string;
  heroAriaTotals: (submitted: number, enrolled: number, unsubmitted: number) => string;
  heroMissing: (count: number) => string;
  heroAllSubmitted: string;
  heroProgressFailed: string;
  heroNoStudents: string;

  /* 提交趋势卡 */
  trendEyebrow: (days: number, byClass: boolean) => string;
  trendTitle: (byClass: boolean) => string;
  /** 控件作用域说明：这张图只受上方两个按钮影响 */
  trendScopeNote: string;
  trendGroupAriaLabel: string;
  /** 分组按钮的可见文字，须与 trendGroupAriaLabel 的说法一致 */
  trendGroupTotalLabel: string;
  trendGroupClassLabel: string;
  trendDaysAriaLabel: string;
  /** 天数按钮的文字（单位两角色一致，但同样收进文案表，避免组件里再出现面向用户的硬编码） */
  trendDaysOptionLabel: (days: number) => string;
  trendLoadingByClass: string;
  trendPendingNote: string;
  trendEmptyTitle: string;
  trendEmptyHint: string;
  trendFailedSummary: string;
  /** 卡底合计的左右两半，数字仍由组件用等宽字体单独包裹 */
  trendSummaryPrefix: (days: number) => string;
  trendSummarySuffix: string;
  trendTooltipSeriesName: string;

  /* 标签分布卡 */
  distEyebrow: string;
  distTitle: string;
  /** 全量口径说明，趋势与分组不影响这两块图 */
  fullScopeNote: string;
  distCenterLabel: string;
  distEmptyTitle: string;
  distEmptyHint: string;

  /* 班级对比卡 */
  compareEyebrow: string;
  compareTitle: string;
  compareLegendSubmitted: string;
  compareLegendUnsubmitted: string;
  compareRateNote: string;
  compareTooltipTotals: (enrolled: number, rateText: string) => string;
  compareEmptyTitle: string;
  compareEmptyHint: string;
  /** 班级名展示：key 用于比较/排序/下钻，label 是接口给的展示名 */
  classLabel: (key: string, label: string) => string;
}

/** 管理端：保持既有系统口径，不随教师侧改动 */
export const ADMIN_DASHBOARD_COPY: DashboardCopy = {
  bannerPartialFailure: "部分数据加载失败，图表可能不完整",
  retryButton: "重试",
  pageLoading: "加载中...",

  chartFailedTitle: "数据加载失败",
  chartFailedHint: "点上方横幅的「重试」重新获取。",
  tooltipPeopleUnit: " 人",
  tooltipDatePrefix: "日期 ",

  heroSubmittedOfTotal: "已提交 / 在册",
  heroRateLabel: "提交率",
  heroAriaTotals: (submitted, enrolled, unsubmitted) =>
    `已提交 ${submitted} 人，在册 ${enrolled} 人，未提交 ${unsubmitted} 人`,
  heroMissing: (count) => `还差 ${count} 人未提交`,
  heroAllSubmitted: "全员已提交",
  heroProgressFailed: "提交进度加载失败，点上方横幅的「重试」重新获取。",
  heroNoStudents: "还没有在册学生，导入学生名单后这里会显示提交进度。",

  // 原文案由 JSX 的两个节点拼出（`时间 {byClass ? "× 班级" : "窗口"}`），空格是节点间距的产物，照抄以保持管理端零变化
  trendEyebrow: (_days, byClass) => (byClass ? "时间 × 班级" : "时间 窗口"),
  trendTitle: (byClass) => (byClass ? "各班提交趋势（单位：人数）" : "提交趋势（单位：人数）"),
  trendScopeNote: "趋势天数与分组仅作用于本图",
  trendGroupAriaLabel: "趋势分组",
  trendGroupTotalLabel: "全校",
  trendGroupClassLabel: "按班级",
  trendDaysAriaLabel: "趋势天数",
  trendDaysOptionLabel: (days) => `${days}天`,
  trendLoadingByClass: "正在按班级拆分…",
  trendPendingNote: "更新中",
  trendEmptyTitle: "所选窗口内还没有提交记录",
  trendEmptyHint: "把趋势天数调大一些，或确认学生是否已开始填写档案。",
  trendFailedSummary: "趋势数据加载失败，暂不显示本窗口合计",
  trendSummaryPrefix: (days) => `近 ${days} 天共 `,
  trendSummarySuffix: " 人提交",
  trendTooltipSeriesName: "提交人数",

  distEyebrow: "标签维度",
  distTitle: "标签分类分布（单位：标签次数）",
  fullScopeNote: "全量口径，不随趋势天数与分组变化",
  distCenterLabel: "标签次数",
  distEmptyTitle: "还没有标签数据",
  distEmptyHint: "学生提交档案后，这里会按兴趣 / 技能 / 性格等维度汇总标签次数。",

  compareEyebrow: "分组对比",
  compareTitle: "班级对比（单位：人数，柱高 = 总人数）",
  compareLegendSubmitted: "已提交",
  compareLegendUnsubmitted: "未提交",
  compareRateNote: "柱顶为该组提交率",
  compareTooltipTotals: (enrolled, rateText) => `在册 ${enrolled} 人 · 提交率 ${rateText}`,
  compareEmptyTitle: "还没有在册学生",
  compareEmptyHint: "先在「班级管理」与「学生名单」中建立班级并导入学生，这里就能看到各组提交对比。",
  classLabel: (_key, label) => label,
};

/** 教师端：面向一线教师的口语表述，口径词与控件名全部替换 */
export const TEACHER_DASHBOARD_COPY: DashboardCopy = {
  bannerPartialFailure: "有些数据没取到，图表可能不完整",
  retryButton: "重试",
  pageLoading: "加载中...",

  chartFailedTitle: "数据没取到",
  chartFailedHint: "点上面的「重试」再来一次。",
  tooltipPeopleUnit: " 人",
  tooltipDatePrefix: "日期 ",

  heroSubmittedOfTotal: "已交 / 学生总数",
  heroRateLabel: "交齐比例",
  heroAriaTotals: (submitted, enrolled, unsubmitted) =>
    `已交 ${submitted} 人，学生共 ${enrolled} 人，还有 ${unsubmitted} 人没交`,
  heroMissing: (count) => `还有 ${count} 人没交`,
  heroAllSubmitted: "所有学生都交齐了",
  heroProgressFailed: "进度没取到，点上面的「重试」再来一次。",
  heroNoStudents: "还没有学生，导入名单后这里会显示提交进度。",

  trendEyebrow: (days, byClass) => (byClass ? `最近 ${days} 天 · 分班级` : `最近 ${days} 天`),
  trendTitle: (byClass) => (byClass ? "各班提交趋势" : "提交趋势"),
  trendScopeNote: "上面两个按钮只改这张图",
  trendGroupAriaLabel: "怎么看（所有班级 · 分班级）",
  trendGroupTotalLabel: "所有班级",
  trendGroupClassLabel: "分班级",
  trendDaysAriaLabel: "看几天",
  trendDaysOptionLabel: (days) => `${days}天`,
  trendLoadingByClass: "正在分班统计…",
  trendPendingNote: "更新中",
  trendEmptyTitle: "这几天还没有学生提交",
  trendEmptyHint: "可以把天数拉长一些，或者提醒学生开始填写。",
  trendFailedSummary: "趋势没取到，这几天的合计数先不显示",
  trendSummaryPrefix: (days) => `近 ${days} 天共 `,
  trendSummarySuffix: " 人提交",
  trendTooltipSeriesName: "提交人数",

  distEyebrow: "学生常提哪类",
  distTitle: "各类标签被提到多少次",
  fullScopeNote: "这里统计的是全部记录，不受上面「最近 N 天」影响",
  distCenterLabel: "被提到次数",
  distEmptyTitle: "还没有标签数据",
  distEmptyHint: "学生提交之后，这里会统计兴趣 / 技能 / 性格等标签各被提到多少次。",

  compareEyebrow: "各班比一比",
  compareTitle: "各班完成情况（柱子高度＝人数）",
  compareLegendSubmitted: "已交",
  compareLegendUnsubmitted: "没交",
  compareRateNote: "每根柱子上方是交齐比例",
  compareTooltipTotals: (enrolled, rateText) => `共 ${enrolled} 人 · 交齐比例 ${rateText}`,
  compareEmptyTitle: "还没有学生",
  compareEmptyHint: "先去「班级管理」建班、到「学生管理」导入名单，这里就能比较各班的完成情况。",
  classLabel: (key, label) =>
    key === UNASSIGNED_CLASS_KEY ? UNASSIGNED_CLASS_TEACHER_LABEL : label,
};

/**
 * 教师端数据大屏「职业兴趣测评」栏的文案（#232）。
 *
 * 为什么单独一张表而不是塞进 `DashboardCopy`：这块只有教师端渲染（管理员侧大屏保持原样），
 * 塞进去会让管理员文案表出现一批永远不用的字段。措辞仍沿用教师侧口语化词表——
 * 不出现「提交率 / 在册 / 口径 / 维度 / 已提交」等统计口径词，也不说「全班 / 本班」。
 */
export const ASSESSMENT_DASHBOARD_COPY = {
  eyebrow: "测评看板",
  title: "职业兴趣测评",
  subtitle: "三字码来自学生答完的兴趣测评；点下面任意一项，都能看到具体是谁",

  /* 范围切换 */
  scopeAriaLabel: "测评统计范围",
  scopeAllLabel: "所有班级",
  scopeMineLabel: "只看我的班",

  /* 视图切换 */
  viewAriaLabel: "换一种看法",
  viewProgressLabel: "完成进度",
  viewTypesLabel: "类型分布",
  viewCodesLabel: "热门三字码",

  /* 完成进度 */
  progressNote: "按交齐比例从低到高排，最该提醒的班在最上面",
  classCounts: (assessed: number, enrolled: number) => `已交 ${assessed} / ${enrolled} 人`,
  classAriaLabel: (label: string, assessed: number, enrolled: number) =>
    `查看${label}的测评明细：已交 ${assessed} 人，共 ${enrolled} 人`,
  unassignedHint: "还没分班的学生暂时不能单独看明细",
  /** 「未分班」是接口数据值，教师侧只在展示时换口语（与 TEACHER_DASHBOARD_COPY.classLabel 同口径） */
  unassignedLabel: "还没分班",
  progressEmptyTitle: "还没有可看的班",
  progressEmptyHint: "先去「班级管理」建班、到「学生管理」导入名单，这里会按班列出测评进度。",

  /* 类型分布 */
  typesNote: "每型一条，右边是人数；鼠标停在哪条（或键盘移到哪条），人数就显示在中间",
  typesCenterLabel: "已测人数",
  typeAriaLabel: (label: string, count: number) => `查看${label}的测评明细：${count} 人`,

  /* 热门三字码 */
  codesNote: "人数最多的十个三字码，颜色是它的第一位类型",
  codeAriaLabel: (code: string, count: number) => `查看三字码 ${code} 的测评明细：${count} 人`,
  codeCountLabel: (count: number) => `${count} 人`,

  /* 空态 / 失败态 */
  loadingLabel: "正在取测评数据…",
  disabledTitle: "这个测评还没开放",
  disabledHint: "开放后学生就能在面板里作答，这里会显示各班进度和六型分布。",
  emptyTitle: "还没有学生完成测评",
  emptyHint: "提醒学生到「职业测评」里答完题，完成后这里就会出现各班进度和六型分布。",
  failedTitle: "测评数据没取到",
  failedHint: "点「重试」再来一次；上面的其它图表不受影响。",
  retryLabel: "重试",

  /* 下钻弹窗 */
  drilldownHint: "明细含学生个人信息，投屏时请注意",
  drilldownLoading: "正在加载明细…",
  userCodeMaskedTooltip: "学号已脱敏",
  drilldownSummary: (assessed: number, total: number) => `已测 ${assessed} / ${total} 人`,
  drilldownTitleClass: (label: string) => `${label}的测评明细`,
  drilldownTitleType: (label: string) => `${label}学生的测评明细`,
  drilldownTitleCode: (code: string) => `三字码 ${code} 的学生`,
  drilldownSearchPlaceholder: "搜索姓名或学号",
  drilldownTypeFilterAriaLabel: "只看某一型",
  drilldownAllTypesLabel: "全部",
  drilldownColumnName: "姓名",
  drilldownColumnUserCode: "学号",
  drilldownColumnCode: "三字码",
  drilldownColumnTime: "完成时间",
  drilldownEmptyTitle: "没有符合条件的学生",
  drilldownEmptyHint: "换个关键字或清除筛选再看看。",
  drilldownFilteredEmptyLabel: "清除筛选",
  drilldownFailedTitle: "明细没取到",
  drilldownFailedHint: "请检查网络后重试，或先关掉弹窗继续看其他内容。",
  drilldownCloseLabel: "关闭明细",

  footerNote: "点班级、类型条或三字码，都能下钻到具体学生",
};

/**
 * 教师端「测评看板」（#314）的文案。
 *
 * 与 #232 的 `ASSESSMENT_DASHBOARD_COPY` 分开：那套是「卡内切三视图」形态的文案，
 * 新看板是「页头 + hero + 完成矩阵 + 行动条」，措辞与字段都不同，混在一张表里会让两张表的
 * 失效字段互相掩护。禁词与 `TEACHER_DASHBOARD_COPY` 完全一致（不出现
 * 「在册 / 口径 / 提交率 / 已提交 / 未提交 / 还差 / 维度 / 学生名单 / 全校 / 全班 / 本班」…）。
 */
export const TEACHER_BOARD_COPY = {
  /* 页头 */
  eyebrow: "数据中心 / 数据大屏",
  title: "测评看板",
  subtitle: "看各班做到哪、兴趣偏哪、性格什么样。",
  scopeAriaLabel: "看的范围",
  scopeMineLabel: "我带的班",
  scopeAllLabel: "所有班级",
  refreshLabel: "刷新",
  pageLoading: "加载中...",

  /**
   * 量表口语短名（#314 §9）：前端按 `code` 映射，接口只给 code 与正式名；
   * 找不到映射时回退接口下发的正式名（`scaleLabelOf`）。
   */
  scaleLabels: {
    riasec: "兴趣测评",
    "ipip-neo-ffi": "人格测评",
  } as Readonly<Record<string, string>>,

  /* 通用失败 / 重试 */
  bannerPartialFailure: "有些数据没取到，图表可能不完整",
  retryButton: "重试",
  failedTitle: "数据没取到",
  failedHint: "点「重试」再来一次。",

  /* hero：档案完成进度 */
  heroProfileLabel: "档案提交",
  heroRateLabel: "完成情况",
  heroMissing: (count: number) => `还有 ${count} 人没交`,
  heroAllDone: "所有学生都交齐了",
  heroNoStudents: "还没有学生，导入名单后这里会显示完成情况。",
  heroFailedTitle: "完成情况没取到",
  heroFailedHint: "点「重试」再来一次。",

  /* hero：点阵 */
  heroGridCaption: "每格 1 人 · 按班排列",
  heroGridLegendDone: "已交",
  heroGridLegendMissing: "没交",
  heroGridAria: (done: number, total: number) =>
    `已交 ${done} 人，学生共 ${total} 人，按班分组示意`,
  heroGridGroup: (name: string, done: number, total: number) => `${name} ${done}/${total}`,
  heroGridOverflow: "人数较多，这里按比例显示",

  /* hero：各量表进度 */
  heroScaleEyebrow: "测评进度",
  heroScaleNote: "与档案提交分开计算",
  heroScaleEmpty: "还没有学生开始",

  /* 班级完成矩阵 */
  matrixTitle: "班级进度",
  matrixNote: "一行一个班，按档案完成从低到高排；点格子看名单",
  matrixEnrolledNote: "统计全部学生",
  matrixColumnClass: "班级",
  matrixColumnProfile: "档案提交",
  matrixColumnComposition: "兴趣构成",
  matrixColumnActions: "操作",
  matrixEnrolledSub: (enrolled: number) => `${enrolled} 人`,
  matrixCellEmpty: "还没开始",
  matrixCellRate: (rate: string) => rate,
  matrixProfileCellLabel: (className: string, done: number, enrolled: number) =>
    `${className} · 档案提交 · 已交 ${done} / ${enrolled} 人`,
  matrixScaleCellAria: (className: string, scaleLabel: string, done: number, enrolled: number) =>
    `${className} · ${scaleLabel} · 已测 ${done} / ${enrolled} 人 · 查看名单`,
  matrixMissingAction: "看未完成",
  matrixMissingAria: (className: string, scaleLabel: string, missing: number) =>
    `${className} · ${scaleLabel} · 还有 ${missing} 人没交 · 查看没交名单`,
  matrixCompositionTooltip: "一人只按三字码首位计一次",
  matrixCompositionEmpty: "还没人完成",
  matrixCompositionSummary: (assessed: number, detail: string) => `${assessed} 人已测 · ${detail}`,
  matrixCompositionSegmentAria: (label: string, count: number) => `${label} ${count} 人`,
  matrixNoDrilldownHint: "切到「所有班级」时不能看个人名单",
  matrixEmptyTitle: "还没有可看的班",
  matrixEmptyHint:
    "先去「班级管理」建班、到「学生管理」导入名单，这里会按班列出完成情况。",
  matrixFailedTitle: "班级进度没取到",
  matrixFailedHint: "点「重试」再来一次。",

  /* 行动条 */
  actionTitle: "下一步",
  actionNotStarted: (classes: string) => `${classes}还没开始`,
  actionMissing: (scaleLabel: string, count: number) => `${scaleLabel}还有 ${count} 人没交`,
  actionHint: "建议留出 10 分钟统一作答，完成后这条提醒会自动消失。",
  actionAllDone: "这轮该做的都做完了，做得不错。",
  actionSeeMissing: "看未完成名单",
  actionCopyReminder: "复制提醒话术",
  actionCopySuccess: "已复制提醒话术",
  actionCopyFailed: "复制没成功，请手动复制",

  /* 名册弹窗（个人明细；与 #232 的公共字段共用 ASSESSMENT_DASHBOARD_COPY） */
  rosterTitleDone: (className: string, scaleLabel: string) => `${className} · ${scaleLabel} · 已完成名单`,
  rosterTitleMissing: (className: string, scaleLabel: string) => `${className} · ${scaleLabel} · 没交名单`,
  rosterTitleAllDone: (scaleLabel: string) => `${scaleLabel} · 已完成名单`,
  rosterTitleAllMissing: (scaleLabel: string) => `${scaleLabel} · 没交名单`,
  rosterColumnClass: "班级",
  rosterScaleTabsAria: "换一套量表",
  rosterColumnBands: "五项档位",
  rosterBandLabel: (band: string) =>
    band === "high" ? "偏高" : band === "low" ? "偏低" : "中等",
  rosterCountLabel: (count: number) => `${count} 人`,
  rosterMissingHint: "只列还没交这套量表的学生；有草稿也算没交。",
  rosterTitleCode: (code: string, labels: string) => `三字码 ${code}（${labels}）· 已完成名单`,
  rosterTitleCodeClass: (className: string, code: string, labels: string) =>
    `${className} · 三字码 ${code}（${labels}）· 已完成名单`,

  /* 结构卡（#315）：两卡共用一个班级选择器 */
  structureClassLabel: "看的班级",
  structureAllClassesLabel: "全部班级",
  structureHelpButton: "怎么看这份数据",
  structureDisabledTitle: "这个测评还没开放",
  structureDisabledHint: "开放后学生就能在面板里作答，这里会显示分布。",

  /* 兴趣结构卡（#315） */
  interestTitle: "兴趣结构",
  interestNote: "按第一兴趣归型，只看已测学生",
  interestCenterLabel: "已测学生",
  interestLegendAria: (label: string, letter: string, count: number) =>
    `${label}（${letter}）${count} 人`,
  interestSampleHint: "已测人数少于 5，分布仅供参考",
  interestCodeTitle: "常见兴趣组合",
  interestCodeHint: "三字码从左到右读，第一位最重要",
  interestCodeLabel: (code: string, labels: string) => `${code}（${labels}）`,
  interestCodeAria: (code: string, labels: string, count: number) =>
    `${code}（${labels}）· ${count} 人 · 查看名单`,
  interestCodeAllOnlyHint: "选「全部班级」时显示常见组合",
  interestCodeRestrictedHint: "当前范围只提供合计；切到「我带的班」可查看名单",
  interestEmptyTitle: "还没有学生完成兴趣测评",
  interestEmptyHint: "提醒学生到「职业测评」里答完题，这里会出现六型结构和常见组合。",
  interestFailedTitle: "兴趣结构没取到",
  interestHelpLabel: "六型怎么看？",

  /* 人格轮廓卡（#315） */
  bigFiveTitle: "人格轮廓",
  bigFiveNote: "只看倾向，不贴类型",
  bigFiveLegendLow: "偏低",
  bigFiveLegendMedium: "中等",
  bigFiveLegendHigh: "偏高",
  bigFiveRowAria: (label: string, low: number, medium: number, high: number) =>
    `${label}：偏低 ${low} 人、中等 ${medium} 人、偏高 ${high} 人`,
  bigFiveCountLabel: (low: number, medium: number, high: number) =>
    `偏低 ${low} · 中等 ${medium} · 偏高 ${high}`,
  bigFiveInvalidNote: (count: number) => `另有 ${count} 人快照不完整，不计入分布`,
  bigFiveDisabledTitle: "人格测评未开放",
  bigFiveDisabledHint: "开放后学生就能在面板里作答，这里会显示五项的分布。",
  bigFiveEmptyTitle: "还没有学生完成人格测评",
  bigFiveEmptyHint: "提醒学生到「职业测评」里答完题，这里会出现五项分布。",
  bigFiveFailedTitle: "人格轮廓没取到",
  bigFiveHelpLabel: "五项怎么看？",
  bigFiveRosterButton: "查看已完成名单",
  bigFiveRosterAria: "查看完成人格测评的名单",

  /* 说明抽屉（#315） */
  helpEyebrow: "结果说明",
  helpTitle: "老师怎么看这些结果",
  helpSubtitle: "先看完成度，再看结构；用来理解学生，不用来贴标签。",
  helpTabsAria: "说明分类",
  helpTabRiasec: "兴趣六型",
  helpTabBigFive: "人格五项",
  helpTabHow: "怎么用",
  helpClose: "知道了",
  helpCloseAria: "关闭说明",
  helpFooterNote: "结果用于生涯探索与教学参考，不构成心理诊断。",
  helpRiasecLead: "兴趣没有好坏，只说明学生更愿意把精力放在哪类事情上。先看哪些型更集中，再看具体是谁。",
  helpBigFiveLead: "大五不是五种类型。每个人五项都有分数，只看偏高 / 中等 / 偏低；没有好坏，也不预测成绩。",
  helpHowLead: "这些结果最适合用来开启谈话、设计分组和调整任务，不适合用来评价学生。",
  helpCodeExampleTitle: "三字码怎么读",
  helpExampleCode: "SIA",
  helpClassroomLabel: "课堂上",
  helpConversationTitle: "可以这样和学生聊",
  helpHighLabel: "偏高",
  helpLowLabel: "偏低",
} as const;

