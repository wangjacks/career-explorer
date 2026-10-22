/**
 * 六型固定配色（#232 约定 / #234 共用口径）。
 *
 * 为什么单独一个模块：三字码徽章、数据大屏测评栏、导出列、详情弹窗条形都用同一套颜色，
 * 色值一旦散落在各组件里必然慢慢分叉。这里只放「颜色 + 取色」，不放布局与业务。
 *
 * 色值来自 #232 指定的六型固定配色；`chipFg` 是色块上的文字色，按 WCAG 对比度选的安全值
 * （单测锁每对 `chipFg`/`bar` 对比度 ≥ 4.5:1，深浅色主题下都可辨识）。
 */

import type { RiasecKey } from "./assessment-match";

/** 一个类型的配色：`bar` 是色块 / 条形底色，`chipFg` 是色块上的文字色 */
export interface AssessmentTypeColor {
  bar: string;
  chipFg: string;
}

/** 六型配色表（键与 RIASEC 一致） */
export const ASSESSMENT_TYPE_COLORS: Readonly<Record<RiasecKey, AssessmentTypeColor>> = {
  R: { bar: "#dc2626", chipFg: "#ffffff" },
  I: { bar: "#2563eb", chipFg: "#ffffff" },
  A: { bar: "#7c3aed", chipFg: "#ffffff" },
  S: { bar: "#059669", chipFg: "#111827" },
  E: { bar: "#f59e0b", chipFg: "#111827" },
  // C 的底色偏亮：白字只有 3.68:1，不达 WCAG AA，因此与 S/E 一样用深色文字（4.79:1）
  C: { bar: "#0891b2", chipFg: "#111827" },
};

/** 未知类型（脏数据 / 将来新增维度）的兜底配色 */
export const ASSESSMENT_TYPE_FALLBACK_COLOR: AssessmentTypeColor = { bar: "#6b7280", chipFg: "#ffffff" };

/**
 * 「未测」灰胶囊配色（浅色 / 深色两套）。
 *
 * 组件里的 Tailwind 类与之对应：浅色 `bg-gray-100 text-gray-600`、深色 `dark:bg-gray-800 dark:text-gray-400`。
 * 单独列出来是为了让单测能锁对比度——`text-gray-500` 配 `bg-gray-100` 只有 4.39:1，不够 WCAG AA。
 */
export const NOT_ASSESSED_PILL_COLORS = {
  light: { bg: "#f3f4f6", fg: "#4b5563" },
  dark: { bg: "#1f2937", fg: "#9ca3af" },
} as const;

/**
 * 三字码 / 单字母 → 配色。
 * 取首位字母（三字码的归型依据）；空值、非 RIASEC 字母都走兜底配色，不抛错。
 */
export function typeColorOf(key: string | null | undefined): AssessmentTypeColor {
  if (typeof key !== "string") return ASSESSMENT_TYPE_FALLBACK_COLOR;
  const lead = key.trim().slice(0, 1).toUpperCase();
  if (lead === "") return ASSESSMENT_TYPE_FALLBACK_COLOR;
  return ASSESSMENT_TYPE_COLORS[lead as RiasecKey] ?? ASSESSMENT_TYPE_FALLBACK_COLOR;
}

/**
 * 大五人格三档的**单一靛蓝族**（#315）：低 / 中 / 高只用一个色相的深浅表达强弱，
 * 不引入第二套分类色。浅色主题用「越强越深」、深色主题用「越强越亮」，两档都按 WCAG
 * 非文本对比度 ≥ 3:1 对齐卡片底色（单测锁；文本另用语义 token）。
 */
export type BigFiveBand = "low" | "medium" | "high";

export const BIG_FIVE_BAND_COLORS = {
  light: { low: "#6366f1", medium: "#4338ca", high: "#312e81" },
  dark: { low: "#6366f1", medium: "#818cf8", high: "#a5b4fc" },
} as const;

/**
 * 堆叠条各档的 Tailwind 类（与上面的色值一一对应；单测会断言类名里含同一 hex，
 * 避免有人只改颜色常量、界面却还画旧色）。
 */
export const BIG_FIVE_BAND_CLASSES: Readonly<Record<BigFiveBand, string>> = {
  low: "bg-[#6366f1] dark:bg-[#6366f1]",
  medium: "bg-[#4338ca] dark:bg-[#818cf8]",
  high: "bg-[#312e81] dark:bg-[#a5b4fc]",
};