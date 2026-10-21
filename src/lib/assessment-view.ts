/**
 * 职业兴趣测评结果的视图模型（#224）：纯函数 + 面向学生的通俗解读文案。
 *
 * 数据来自 `/api/shared/assessment/results`（#223）的 `scores` 快照（`DimensionScore[]`）。
 * 这里只做「渲染前的整理」：固定 RIASEC 顺序、补齐缺失维度、排好名次、把三字码翻成中文，
 * 不做任何取数或计算——得分是当时算好的快照，页面不重算（口径见 #221）。
 *
 * 为什么单独一层：雷达图/条状排名/解读/职业卡的形状都由这里决定，组件只负责画；
 * 纯函数可以被单测覆盖（仓库没有 DOM 测试环境，界面逻辑一律先落到这里）。
 */

import type { DimensionScore } from "./assessment-scoring";
import { MAX_RESULT_VERSIONS } from "./assessment-flow";
import { RIASEC_KEYS, RIASEC_LABELS, normalizeHollandCode, type RiasecKey } from "./assessment-match";

/** 六型通俗解读：写给第一次看结果的学生，不出现「维度 / 标准分 / 口径」这类术语 */
export const RIASEC_INTERPRETATIONS: Readonly<Record<RiasecKey, string>> = {
  R: "喜欢动手和实物打交道：拆装、修理、户外作业或摆弄工具设备，会让你觉得有干劲。",
  I: "喜欢分析和探究：查资料、做实验、把一个问题彻底弄明白，本身就很吸引你。",
  A: "喜欢创作和表达：画画、写作、设计、音乐这类能自由发挥的事，更容易让你投入。",
  S: "喜欢和人打交道：帮助、教导、照顾别人，会让你觉得做的事情有价值。",
  E: "喜欢推动事情发生：说服别人、组织活动、带着团队把想法做成，会让你兴奋。",
  C: "喜欢把事理清楚：整理数据、核对细节、让流程井井有条，会让你觉得踏实。",
};

/**
 * 大五人格每维的高分 / 低分两段通俗解读（#292）：5 维 × 2 = 10 段。
 *
 * 键用 IPIP NEO-FFI 的维度键（N/E/O/A/C）；其中 E/A/C 与霍兰德字母**同名不同义**
 * （外向性 ≠ 企业型、宜人性 ≠ 艺术型、尽责性 ≠ 常规型），所以这份表只允许
 * `buildBigFive*` 使用，绝不能传进 RIASEC 的视图函数（分流在结果卡入口按 scoringMode 判定）。
 */
export const BIG_FIVE_INTERPRETATIONS: Readonly<Record<string, { high: string; low: string }>> = {
  N: {
    high: "你的情绪比较丰富，遇到压力或不确定的事容易先紧张、多想；这也意味着你对风险更敏感，提前做准备常常能帮你稳住。",
    low: "你情绪比较稳，遇到烦心事不容易慌，压力下也能保持平常心，身边的人常觉得你可靠、沉得住气。",
  },
  E: {
    high: "你从和人打交道里获得能量：聊天、讨论、一起做事会让你更有劲，热闹的场合通常让你舒服。",
    low: "你更喜欢安静和独处：人多的场合容易消耗你，一个人专注做事、或和少数熟人相处时，你反而更放松。",
  },
  O: {
    high: "你对新东西好奇，愿意尝试没做过的事，喜欢想问题、聊想法，也容易被艺术、创作和新鲜观点吸引。",
    low: "你更看重实用和熟悉的方式：比起尝鲜，你更愿意把已经有效的做法做扎实，做事讲究稳妥、落地。",
  },
  A: {
    high: "你待人友善，愿意体谅和配合别人，冲突里常先想对方的难处，团队里容易成为让人放心的人。",
    low: "你比较直接，有自己的判断，不会为了迎合别人轻易让步；必要时你能坦率地说「不」，也更能坚持自己的立场。",
  },
  C: {
    high: "你有计划、守承诺，事情交到你手上会想把它做完整；这种自律让你在长期目标上更容易走远。",
    low: "你更随性灵活，不喜欢被计划框住，临时调整对你来说不算难事；比起按部就班，你更享受即兴和自由。",
  },
};

/**
 * 「人格与兴趣一起看」的对应关系（#292）：霍兰德某型与大五某维在研究上常一起出现，
 * 用学生语言解释「两边对得上说明什么」。
 *
 * 文案是给学生看的科普，不是诊断；`riasec` 只用来对照霍兰德字母，不参与任何计分。
 */
export const CROSS_SCALE_LINKS: readonly {
  riasec: RiasecKey;
  bigFive: string;
  riasecLabel: string;
  bigFiveLabel: string;
  text: string;
}[] = [
  {
    riasec: "S",
    bigFive: "A",
    riasecLabel: "社会型",
    bigFiveLabel: "宜人性",
    // 文案是通用科普，不假设学生两边都高：写成条件句，避免对具体结果下错判断
    text: "社会型和宜人性常常一起出现：两边都高的人，喜欢帮人不只是一时兴起，性格里本来就带着耐心和体谅。",
  },
  {
    riasec: "E",
    bigFive: "E",
    riasecLabel: "企业型",
    bigFiveLabel: "外向性",
    text: "企业型和外向性常常一起出现：两边都高的人，组织活动、说服别人会更自然，也更容易从人群里获得能量。",
  },
  {
    riasec: "C",
    bigFive: "C",
    riasecLabel: "常规型",
    bigFiveLabel: "尽责性",
    text: "常规型和尽责性常常一起出现：两边都高的人，既喜欢把事情理清楚，也有把它做到底的自律。",
  },
];

/** 三字码徽章里的一枚字母 */
export interface TypeCodePart {
  key: RiasecKey;
  label: string;
}

/** 条状排名的一项 */
export interface RiasecBar {
  key: RiasecKey;
  label: string;
  /** 0–100 标准分 */
  standard: number;
  /** 进度条宽度（0–100，越界已钳制） */
  percent: number;
  /** 是否属于三字码里的前三型（展示「主要兴趣」用） */
  isTop: boolean;
}

/** 雷达图的一个顶点（顺序由传入的维度定义决定，缺的维度补 0，保证多边形闭合） */
export interface RadarPoint {
  /** #292 起泛化为任意维度键（霍兰德 R/I/A/S/E/C 与大五 N/E/O/A/C 都走同一套雷达） */
  key: string;
  label: string;
  standard: number;
}

/** 大五条状排名的一项（#292） */
export interface BigFiveBar {
  key: string;
  label: string;
  /** 0–100 标准分 */
  standard: number;
  /** 进度条宽度（0–100，越界已钳制） */
  percent: number;
  /** 是否属于画像标签里的前两维（展示「主要特质」用） */
  isPrimary: boolean;
}

/** 大五逐维解读（按排名顺序，便于和条形对照） */
export interface BigFiveInterpretation {
  key: string;
  label: string;
  /** 这一维按 50 分中线取高分 / 低分文案 */
  level: "high" | "low";
  text: string;
  isPrimary: boolean;
}

/** 每一项解读（条状排名的顺序，便于和排名对照阅读） */
export interface RiasecInterpretation {
  key: RiasecKey;
  label: string;
  text: string;
  isTop: boolean;
}

/**
 * 结果卡分流（#292）：**在入口按计分模式判定**，不做「有没有三字码」这类内容推断。
 *
 * - `dimensional`（大五人格）→ `big-five` 卡：画像标签 + 五维雷达 + 条形 + 高低分解读，无三字码、无职业推荐；
 * - 其余（含字段缺失的老接口）→ `holland` 卡：沿用 #224 的三字码 + 六型卡。
 *
 * 这里只决定「画哪张卡」；两张卡的数据线互不相通——大五的分永远不会进 `buildRiasec*`
 * （大五的 E/A/C 与霍兰德同名不同义，混用会把「外向性」画成「企业型」）。
 */
export type ResultCardMode = "holland" | "big-five";

export function resultCardMode(assessment: { scoringMode?: string } | null | undefined): ResultCardMode {
  return assessment?.scoringMode === "dimensional" ? "big-five" : "holland";
}

/** 结果快照（`/api/shared/assessment/results` 的 `current` / `history` 项） */
export interface AssessmentResultSnapshot {
  id: number;
  typeCode: string | null;
  scores: DimensionScore[];
  completedAt: string;
  isCurrent: boolean;
  /** 该条结果实际作答量（旧记录回退为当时作答数；#283 起由结果接口逐条下发） */
  questionCount?: number;
}

/** 量表元信息（`/results` 的 `assessment`；`assessments` 清单项同形，#292） */
export interface AssessmentScaleMeta {
  code: string;
  name: string;
  /** 每次作答题数（启用抽题时是抽题数，不是题库总量） */
  questionCount: number;
  /** 题库总量（#282；旧接口没有该字段） */
  poolSize?: number;
  scaleVersion: string;
  dimensions: { key: string; label: string }[];
  attribution: string;
  licenseText: string;
  disclaimer: string;
  /** `typological` / `dimensional`（#292 结果卡据此分流） */
  scoringMode?: string;
  /** 量表是否开放（停用时只读历史结果） */
  enabled?: boolean;
}

/** `GET /api/shared/assessment/results` 的返回（**单套**量表；档案页结果区按 #291 的清单逐套取数） */
export interface AssessmentResultsPayload {
  assessment: AssessmentScaleMeta;
  current: AssessmentResultSnapshot | null;
  history: AssessmentResultSnapshot[];
  inProgress: { answered: number; total: number; updatedAt: string } | null;
}

/** 结果卡折叠态的状态（#322）：只决定标题行显示「已测 / 进行中 / 未测」，不参与计分 */
export type ResultCardStatus = "completed" | "in-progress" | "not-started";

/** 结果卡状态（#322）：有当前结果 > 有未完成草稿 > 未开始，优先级与 `deriveAssessmentCenter` 一致 */
export function resultCardStatus(
  data: Pick<AssessmentResultsPayload, "current" | "inProgress">
): ResultCardStatus {
  if (data.current) return "completed";
  if (data.inProgress) return "in-progress";
  return "not-started";
}

/**
 * 维度分快照能不能画（#234 / #332）：`completed` 但快照缺失或损坏（解析后为空）时返回 false，
 * 结果卡与速览卡据此降级——按 0 分画六条 / 雷达 / 画像等于凭空造结论。
 */
export function hasScoreSnapshot(scores: readonly RiasecScoreSnapshot[] | null | undefined): boolean {
  return Array.isArray(scores) && scores.length > 0;
}

/** 速览卡在快照缺失时的主文案 */
export const SNAPSHOT_MISSING_HEADLINE = "已测 · 分数快照缺失";

/** 详情卡在快照缺失时的说明（人称按受众切换） */
export function scoreSnapshotNotice(viewer: "student" | "teacher"): string {
  return viewer === "teacher"
    ? "这份报告只取到了结论：该生的维度分快照缺失，因此不画分数条与雷达图；需要完整画像请让学生重新作答。"
    : "这份报告只取到了结论：维度分快照缺失，因此暂时不画分数条与雷达图；重新作答可以生成完整画像。";
}

/**
 * 结果卡右上角的口径行（#283/#292）：本次题量 · 完成时间 · 这是第几次测评。
 * 版本数撞上接口上限时显示 `N+`，不谎报正好 N 次。
 */
export function buildResultTrailing(input: {
  questionCount?: number;
  completedAt?: string;
  historyCount: number;
}): string {
  const parts: string[] = [];
  if (input.questionCount && input.questionCount > 0) parts.push(`本次 ${input.questionCount} 题`);
  if (input.completedAt) parts.push(`完成于 ${input.completedAt}`);
  if (input.historyCount > 0) {
    parts.push(
      input.historyCount >= MAX_RESULT_VERSIONS ? `第 ${MAX_RESULT_VERSIONS}+ 次` : `第 ${input.historyCount} 次`
    );
  }
  return parts.join(" · ") || "已完成";
}

/** 推荐职业卡的渲染数据（只保留渲染需要的字段） */
export interface CareerCardView {
  code: string;
  /** 中文名优先；无译名时用「职业群 · 学历」兜底，不把英文长名顶到主标题（#322） */
  displayName: string;
  /** 英文原名：有中文译名时作副标题；未译名时同样只作小字，不裸露在主标题 */
  englishName: string;
  /** 是否有中文译名 */
  hasChineseName: boolean;
  /** 职业群 · 常见学历，如「计算机与数学 · 本科」；未译名时已并入主标题，留空避免重复 */
  meta: string;
}

/**
 * 条形图/雷达图的最小输入：只需要「维度 + 标准分」。
 * `label` 缺省时回退 `RIASEC_LABELS` 的中文型名——教师端列表（#234）下发的是轻量快照
 * （不带 raw / band / 作答计数），照样复用同一套整理口径，不用另写一份。
 */
export interface RiasecScoreSnapshot {
  key: string;
  label?: string;
  standard: number;
}

/** 结果快照里的 `scores` 可能带任意历史键：只认传入的 key，其余忽略 */
function scoreOf<T extends { key: string }>(scores: readonly T[], key: string): T | undefined {
  return scores.find((score) => score.key === key);
}

function clampStandard(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

/** 三字码 → 徽章字母；非法/缺失返回空数组（界面显示「—」） */
export function parseTypeCodeParts(typeCode: string | null | undefined): TypeCodePart[] {
  const normalized = normalizeHollandCode(typeCode);
  if (!normalized) return [];
  return [...normalized].map((letter) => ({ key: letter as RiasecKey, label: RIASEC_LABELS[letter as RiasecKey] }));
}

/** 三字码 → 中文串，如 `SIA` → 「社会型 · 研究型 · 艺术型」；无码返回空串 */
export function describeTypeCode(typeCode: string | null | undefined): string {
  return parseTypeCodeParts(typeCode)
    .map((part) => part.label)
    .join(" · ");
}

/**
 * 条状排名：按标准分降序，同分按 RIASEC 固有顺序（稳定，同一结果每次渲染顺序一致）；
 * `isTop` 标出三字码里的前三型。
 */
export function buildRiasecBars(
  scores: readonly RiasecScoreSnapshot[],
  typeCode: string | null | undefined
): RiasecBar[] {
  const topKeys = new Set(parseTypeCodeParts(typeCode).map((part) => part.key));
  const bars = RIASEC_KEYS.map((key, order) => {
    const score = scoreOf(scores, key);
    const standard = clampStandard(score?.standard ?? 0);
    return {
      key,
      label: score?.label || RIASEC_LABELS[key],
      standard,
      percent: standard,
      isTop: topKeys.has(key),
      order,
    };
  });
  bars.sort((a, b) => b.standard - a.standard || a.order - b.order);
  return bars.map((bar) => ({
    key: bar.key,
    label: bar.label,
    standard: bar.standard,
    percent: bar.percent,
    isTop: bar.isTop,
  }));
}

/**
 * 雷达图顶点（#292 泛化）：按传入的**维度定义顺序**排布（多边形按量表自己的维度环排列，
 * 不随得分排序），缺失维度补 0；标签优先取结果快照里的中文名，回退维度定义。
 *
 * 霍兰德卡传入 R-I-A-S-E-C 顺序，大五卡传入 N-E-O-A-C 顺序——顺序由调用方给，
 * 本函数不认任何一套字母，避免两套量表的 E/A/C 在雷达层被混用。
 */
export function buildRadarPoints(
  scores: readonly DimensionScore[],
  dimensions: readonly { key: string; label: string }[]
): RadarPoint[] {
  return dimensions.map(({ key, label }) => {
    const score = scoreOf(scores, key);
    return {
      key,
      label: score?.label || label,
      standard: clampStandard(score?.standard ?? 0),
    };
  });
}

/** 大五画像标签取前两维（#292）：如「高开放性 · 高尽责性」；无维度时返回空串 */
const PRIMARY_TRAIT_COUNT = 2;

/** 大五 50 分中线：标准分 ≥ 50 记高分文案，否则低分（1–5 线性折算，3 分恒为 50） */
const BIG_FIVE_MIDPOINT = 50;

/** 大五排名：按标准分降序，同分按量表维度顺序（稳定）；前两维标 `isPrimary` */
function rankBigFive(
  scores: readonly RiasecScoreSnapshot[],
  dimensions: readonly { key: string; label: string }[]
): { key: string; label: string; standard: number; order: number }[] {
  return dimensions
    .map(({ key, label }, order) => {
      const score = scoreOf(scores, key);
      return {
        key,
        label: score?.label || label,
        standard: clampStandard(score?.standard ?? 0),
        order,
      };
    })
    .sort((a, b) => b.standard - a.standard || a.order - b.order);
}

export function buildBigFiveBars(
  scores: readonly DimensionScore[],
  dimensions: readonly { key: string; label: string }[]
): BigFiveBar[] {
  return rankBigFive(scores, dimensions).map((row, index) => ({
    key: row.key,
    label: row.label,
    standard: row.standard,
    percent: row.standard,
    isPrimary: index < PRIMARY_TRAIT_COUNT,
  }));
}

/**
 * 画像标签：排名前两维拼成「高开放性 · 高尽责性」。
 *
 * 前缀与逐维解读同口径：≥50 用「高X」，低于中线用「偏低X」——否则五个维度都低于 50 时，
 * 头部会写「高X」而下方同一维又标「偏低」，同一张卡自相矛盾。
 *
 * 入参放宽到轻量快照（`{ key, standard }`，label 可选）：数据列表只下发维度 + 标准分（#234/#330），
 * 这一层不需要 raw / 作答计数，避免为了算一个画像标签而搬运整份得分结构。
 */
export function buildBigFiveHeadline(
  scores: readonly RiasecScoreSnapshot[],
  dimensions: readonly { key: string; label: string }[]
): string {
  return rankBigFive(scores, dimensions)
    .slice(0, PRIMARY_TRAIT_COUNT)
    .map((row) => (row.standard >= BIG_FIVE_MIDPOINT ? `高${row.label}` : `偏低${row.label}`))
    .join(" · ");
}

/** 逐维高 / 低分解读：按排名顺序输出，前两维与画像标签一致 */
export function buildBigFiveInterpretations(
  scores: readonly DimensionScore[],
  dimensions: readonly { key: string; label: string }[]
): BigFiveInterpretation[] {
  return rankBigFive(scores, dimensions).map((row, index) => {
    const level: "high" | "low" = row.standard >= BIG_FIVE_MIDPOINT ? "high" : "low";
    const texts = BIG_FIVE_INTERPRETATIONS[row.key];
    return {
      key: row.key,
      label: row.label,
      level,
      // 兜底只防「以后加了未登记的大五维度」；已发布量表由种子测试保证文案齐全
      text: texts?.[level] ?? `「${row.label}」这一项${level === "high" ? "比较突出" : "相对安静"}，是一种自然的个人风格。`,
      isPrimary: index < PRIMARY_TRAIT_COUNT,
    };
  });
}

/** 六型逐条解读：按条状排名顺序输出，便于学生「看到哪条分数、就读哪条说明」 */
export function buildRiasecInterpretations(
  scores: readonly DimensionScore[],
  typeCode: string | null | undefined
): RiasecInterpretation[] {
  return buildRiasecBars(scores, typeCode).map((bar) => ({
    key: bar.key,
    label: bar.label,
    text: RIASEC_INTERPRETATIONS[bar.key],
    isTop: bar.isTop,
  }));
}

/** 推荐职业接口返回的一行（字段口径见 `src/lib/assessment-match.ts` 的 `CareerMatch`） */
export interface CareerApiItem {
  code?: unknown;
  name?: unknown;
  nameZh?: unknown;
  educationLevel?: unknown;
  cluster?: unknown;
}

/**
 * 推荐职业 → 卡片数据（#322）：缺 code/name 的脏行直接丢弃（整块渲染的前提是有内容）。
 *
 * 命名兜底：有中文译名 → 中文名为主、`职业群 · 学历` 作 meta；
 * 缺中文译名 → `职业群 · 学历` 作主标题、英文原名只作小字，避免「Athletes and Sports Competitors」
 * 这类长英文名挤占卡片宽度；两样都缺才退回「职业方向」。
 */
export function buildCareerCards(careers: readonly CareerApiItem[] | null | undefined): CareerCardView[] {
  if (!Array.isArray(careers)) return [];
  const cards: CareerCardView[] = [];
  for (const item of careers) {
    if (!item || typeof item.code !== "string" || typeof item.name !== "string") continue;
    const code = item.code.trim();
    const english = item.name.trim();
    if (!code || !english) continue;
    const nameZh = typeof item.nameZh === "string" ? item.nameZh.trim() : "";
    const cluster = typeof item.cluster === "string" ? item.cluster.trim() : "";
    const education = typeof item.educationLevel === "string" ? item.educationLevel.trim() : "";
    const meta = [cluster, education].filter(Boolean).join(" · ");
    cards.push({
      code,
      // 未译名时主标题只用中文信息；英文原名仍由 englishName 以 11px 小字展示
      displayName: nameZh || meta || "职业方向",
      englishName: english,
      hasChineseName: Boolean(nameZh),
      meta: nameZh ? meta : "",
    });
  }
  return cards;
}

/** 页尾授权卡的量表声明入参（与 `AssessmentListItem` 的结构兼容，#322） */
export interface AttributionScaleInput {
  code: string;
  name?: string;
  attribution?: string | null;
  licenseText?: string | null;
  disclaimer?: string | null;
}

/** 一套量表在授权卡里的一组声明 */
export interface AttributionGroupView {
  code: string;
  name: string;
  attribution: string;
  licenseText: string;
  /** 仅 legacy 占位（测评中心旧入参）且没有 attribution 时给 O*NET 兜底文案 */
  onetFallback: boolean;
}

/** 去重后的一条免责声明；`scaleNames` 标出它适用于哪些量表 */
export interface DisclaimerGroupView {
  text: string;
  /** 空数组表示 legacy 单卡（没有量表名） */
  scaleNames: string[];
}

export interface AttributionCardModel {
  groups: AttributionGroupView[];
  disclaimers: DisclaimerGroupView[];
  careersAttribution: string;
}

/**
 * 页尾授权卡的分组模型（#322）：把「按量表分组 / 免责去重 / O*NET 兜底」三段决策
 * 从组件里搬到纯函数层（与 `buildCareerCards` 同一做法），组件只负责画。
 *
 * 合规口径：
 * - 同一段免责声明出现在多套量表上时只保留一条，并记下适用量表名；
 * - 不同声明各自成组并带量表归属，不把不同法定义务糊成一段；
 * - O*NET 兜底文案只给 legacy 单量表占位（测评中心接口失败时），
 *   真正启用的量表（如 IPIP）缺 attribution 时绝不套 O*NET 文案。
 */
export function buildAttributionGroups(input: {
  scales?: readonly AttributionScaleInput[] | null;
  /** 测评中心单量表兼容入参 */
  attribution?: string | null;
  licenseText?: string | null;
  disclaimer?: string | null;
  careersAttribution?: string | null;
}): AttributionCardModel {
  const source: AttributionScaleInput[] =
    input.scales && input.scales.length > 0
      ? [...input.scales]
      : [
          {
            code: "legacy",
            name: "",
            attribution: input.attribution ?? null,
            licenseText: input.licenseText ?? null,
            disclaimer: input.disclaimer ?? null,
          },
        ];

  const groups: AttributionGroupView[] = source.map((scale) => {
    const attribution = (scale.attribution ?? "").trim();
    return {
      code: scale.code,
      name: (scale.name ?? "").trim(),
      attribution,
      licenseText: (scale.licenseText ?? "").trim(),
      onetFallback: scale.code === "legacy" && attribution === "",
    };
  });

  const disclaimers: DisclaimerGroupView[] = [];
  for (const scale of source) {
    const text = (scale.disclaimer ?? "").trim();
    if (!text) continue;
    const name = (scale.name ?? "").trim();
    const existing = disclaimers.find((entry) => entry.text === text);
    if (existing) {
      if (name && !existing.scaleNames.includes(name)) existing.scaleNames.push(name);
    } else {
      disclaimers.push({ text, scaleNames: name ? [name] : [] });
    }
  }

  return {
    groups,
    disclaimers,
    careersAttribution: (input.careersAttribution ?? "").trim(),
  };
}
