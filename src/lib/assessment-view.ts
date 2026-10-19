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

/** 雷达图的一个顶点（顺序固定，缺的维度补 0，保证多边形闭合） */
export interface RadarPoint {
  key: RiasecKey;
  label: string;
  standard: number;
}

/** 每一项解读（条状排名的顺序，便于和排名对照阅读） */
export interface RiasecInterpretation {
  key: RiasecKey;
  label: string;
  text: string;
  isTop: boolean;
}

/** 推荐职业卡的渲染数据（只保留渲染需要的字段） */
export interface CareerCardView {
  code: string;
  /** 中文名优先，没有译名时回退英文名 */
  displayName: string;
  /** 英文原名（有中文译名时作副标题；未译名时不重复展示） */
  englishName: string;
  /** 是否有中文译名 */
  hasChineseName: boolean;
  /** 职业群 · 常见学历，如「计算机与数学 · 本科」 */
  meta: string;
}

/** 服务端结果快照里的 `scores` 可能带任意历史键：只认 RIASEC 六型，其余忽略 */
function scoreOf(scores: readonly DimensionScore[], key: RiasecKey): DimensionScore | undefined {
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
  scores: readonly DimensionScore[],
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

/** 雷达图顶点：**固定 RIASEC 顺序**（多边形按类型环排列，不随得分排序） */
export function buildRadarPoints(scores: readonly DimensionScore[]): RadarPoint[] {
  return RIASEC_KEYS.map((key) => {
    const score = scoreOf(scores, key);
    return {
      key,
      label: score?.label || RIASEC_LABELS[key],
      standard: clampStandard(score?.standard ?? 0),
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
 * 推荐职业 → 卡片数据：缺 code/name 的脏行直接丢弃（整块渲染的前提是有内容），
 * 中文名优先、英文原名作副标题；meta 只拼有值的部分，避免出现「undefined · 本科」。
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
    cards.push({
      code,
      displayName: nameZh || english,
      englishName: english,
      hasChineseName: Boolean(nameZh),
      meta: [cluster, education].filter(Boolean).join(" · "),
    });
  }
  return cards;
}
