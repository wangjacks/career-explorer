/**
 * 教师端数据大屏「职业兴趣测评」栏的展示口径（#232）：纯函数，组件不自己算数、不自己配色。
 *
 * 与 `assessment-stats.ts` 的分工：那边把**原始计数**算成接口响应（完成率、排序、Top-N），
 * 这边把接口响应算成**三视图要画的东西**（条形宽度、胶囊配色、下钻查询、空态判定）。
 * 两边都是纯函数，界面逻辑先落纯函数再测（仓库没有 DOM 测试环境）。
 */

import type {
  AssessmentClassCompletion,
  AssessmentCodeCount,
  AssessmentStats,
  AssessmentTypeCount,
} from "./assessment-stats";
import { bandOf, type ScoreBand } from "./assessment-scoring";
import { parseScores } from "./assessment-flow";

/**
 * 六型配色（issue #232 指定的六色）：每型四档用途色。
 *
 * - `barLight` / `barDark`：类型条在浅色 / 深色主题下的填充。同色相各取一档，保证与轨道背景
 *   （浅色 `gray-100` / 深色 `gray-800`）的对比度都 ≥ 3:1（WCAG 1.4.11 图形对象口径，单测锁定）。
 *   对 issue 原色只动了两处：E 在浅色下用深一档的琥珀（原 `#f59e0b` 对白/灰底只有 2.15:1），
 *   深色下统一改用同色相的亮一档；其余 `barLight` 与 issue 原色一致。
 * - `chipBg` / `chipFg`：三字码胶囊的底色与文字色，两者对比度 ≥ 4.5:1（WCAG 1.4.3 小字口径，单测锁定）。
 */
export interface AssessmentTypeColor {
  barLight: string;
  barDark: string;
  chipBg: string;
  chipFg: string;
}

/** 六型配色表：顺序即 RIASEC；四档色的取值理由见类型注释（单测校验对比度） */
export const ASSESSMENT_TYPE_COLORS: Record<string, AssessmentTypeColor> = {
  R: { barLight: "#dc2626", barDark: "#f87171", chipBg: "#dc2626", chipFg: "#ffffff" },
  I: { barLight: "#2563eb", barDark: "#60a5fa", chipBg: "#2563eb", chipFg: "#ffffff" },
  A: { barLight: "#7c3aed", barDark: "#a78bfa", chipBg: "#7c3aed", chipFg: "#ffffff" },
  S: { barLight: "#059669", barDark: "#34d399", chipBg: "#047857", chipFg: "#ffffff" },
  E: { barLight: "#b45309", barDark: "#fbbf24", chipBg: "#b45309", chipFg: "#ffffff" },
  C: { barLight: "#0891b2", barDark: "#22d3ee", chipBg: "#0e7490", chipFg: "#ffffff" },
};

/** 未知类型（脏数据 / 将来新增维度）的兜底配色 */
export const ASSESSMENT_TYPE_FALLBACK_COLOR: AssessmentTypeColor = {
  barLight: "#6b7280",
  barDark: "#9ca3af",
  chipBg: "#4b5563",
  chipFg: "#ffffff",
};

/** 类型条所在的轨道底色（浅色 / 深色），对比度校验按它算，避免「对着卡片背景量」失真 */
export const ASSESSMENT_BAR_TRACK_LIGHT = "#f3f4f6";
export const ASSESSMENT_BAR_TRACK_DARK = "#1f2937";

/** sRGB 相对亮度（WCAG 2.x 定义）；非法颜色返回 null */
export function relativeLuminance(hex: string): number | null {
  if (typeof hex !== "string") return null;
  const match = /^#?([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!match) return null;
  const value = match[1];
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) => (channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** 两色对比度（WCAG，1–21）；任一颜色非法返回 null */
export function contrastRatio(foreground: string, background: string): number | null {
  const left = relativeLuminance(foreground);
  const right = relativeLuminance(background);
  if (left === null || right === null) return null;
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

/** 三字码 / 类型 key → 配色；未知或空值走兜底 */
export function typeColorOf(key: string | null | undefined): AssessmentTypeColor {
  if (typeof key !== "string" || key === "") return ASSESSMENT_TYPE_FALLBACK_COLOR;
  return ASSESSMENT_TYPE_COLORS[key.slice(0, 1).toUpperCase()] ?? ASSESSMENT_TYPE_FALLBACK_COLOR;
}

export interface AssessmentTypeBar extends AssessmentTypeCount {
  /** 相对最大值的宽度百分比（0–100，保留 1 位小数） */
  percent: number;
  barLight: string;
  barDark: string;
}

/**
 * 类型分布条：六型都保留（计数 0 也画一条空条，避免「这一型没人」被误读成缺数据），
 * 宽度按最大值归一；最大值为 0 时全部为 0。
 */
export function buildTypeBars(types: readonly AssessmentTypeCount[]): AssessmentTypeBar[] {
  const list = types.filter((item) => item && typeof item.key === "string");
  const max = list.reduce((best, item) => Math.max(best, Math.max(0, item.count)), 0);
  return list.map((item) => {
    const count = Math.max(0, item.count);
    const percent = max > 0 ? Math.round((count / max) * 1000) / 10 : 0;
    const color = typeColorOf(item.key);
    return { ...item, count, percent, barLight: color.barLight, barDark: color.barDark };
  });
}

/** 班级行是否「还没分班」：`classId` 为空或聚合侧沿用「未分班」这个名字 */
export function isUnassignedClass(row: { classId: number | null; name: string }): boolean {
  return row.classId === null || row.classId === undefined || row.name === "未分班";
}

export interface AssessmentClassProgressRow extends AssessmentClassCompletion {
  isUnassigned: boolean;
}

/**
 * 完成进度排序（#232）：**交齐比例从低到高**——最该催的班排最前；
 * 同比例按班名（中文）稳定排序；「还没分班」恒置末（它不是一个可催的班）。
 */
export function sortClassesByNeed(classes: readonly AssessmentClassCompletion[]): AssessmentClassProgressRow[] {
  return [...classes]
    .map((row) => ({ ...row, isUnassigned: isUnassignedClass({ classId: row.classId, name: row.name }) }))
    .sort((a, b) => {
      if (a.isUnassigned !== b.isUnassigned) return a.isUnassigned ? 1 : -1;
      const diff = a.rate - b.rate;
      if (diff !== 0) return diff;
      const byName = a.name.localeCompare(b.name, "zh-CN");
      return byName !== 0 ? byName : a.classId - b.classId;
    });
}

export interface AssessmentCodeChip extends AssessmentCodeCount {
  chipBg: string;
  chipFg: string;
}

/** 热门三字码胶囊：底色取首位类型色，文字色保证高对比（深底白字） */
export function buildCodeChips(codes: readonly AssessmentCodeCount[]): AssessmentCodeChip[] {
  return codes
    .filter((item) => item && typeof item.code === "string" && item.code !== "")
    .map((item) => {
      const color = typeColorOf(item.lead || item.code);
      return { ...item, chipBg: color.chipBg, chipFg: color.chipFg };
    });
}

/** 下钻目标：班级行 / 类型条 / 三字码胶囊，三类共用一个弹窗 */
export type AssessmentDrilldownTarget =
  | { kind: "class"; classId: number; name: string }
  | { kind: "lead"; lead: string; label: string }
  | { kind: "code"; code: string; lead: string };

/** 目标 → 名册接口的过滤参数（`scope` 由调用方补） */
export function drilldownQuery(target: AssessmentDrilldownTarget): { classId?: number; lead?: string; code?: string } {
  if (target.kind === "class") return { classId: target.classId };
  if (target.kind === "lead") return { lead: target.lead };
  return { code: target.code };
}

/**
 * 弹窗里的「只看某一型」二级筛选**只在按班级下钻时出现**。
 *
 * 类型条 / 三字码胶囊下钻时，类型已经由目标锁死（弹窗标题也写明了），再给一个类型筛选会出现
 * 「标题说社会型、列表却可以切成研究型」的自相矛盾；而且它会覆盖目标自带的 `lead` 参数。
 */
export function showsTypeFilter(target: AssessmentDrilldownTarget | null): boolean {
  return target?.kind === "class";
}

/**
 * 弹窗顶部「已测 N / M」的数字：
 * - 班级：该班已交 / 该班在册；
 * - 类型 / 三字码：该型（码）人数 / 全校已测总人数（分母是「已测的人里有多少属于它」）。
 */
export function drilldownCounts(
  target: AssessmentDrilldownTarget,
  stats: Pick<AssessmentStats, "classes" | "types" | "codes" | "total">
): { assessed: number; total: number } {
  if (target.kind === "class") {
    const row = stats.classes.find((item) => item.classId === target.classId);
    return { assessed: row?.assessed ?? 0, total: row?.enrolled ?? 0 };
  }
  if (target.kind === "lead") {
    const row = stats.types.find((item) => item.key === target.lead);
    return { assessed: Math.max(0, row?.count ?? 0), total: Math.max(0, stats.total.assessed) };
  }
  const row = stats.codes.find((item) => item.code === target.code);
  return { assessed: Math.max(0, row?.count ?? 0), total: Math.max(0, stats.total.assessed) };
}

/** 名册档位行（#313，dimensional 量表用）：只有维度名与高/中/低档，**不含 raw / standard** */
export interface AssessmentRosterBand {
  key: string;
  label: string;
  band: ScoreBand;
}

/**
 * 结果快照 → 名册档位（#313）：教师看的是「这一维偏高还是偏低」，不是分数。
 *
 * 快照里的 `band` 由计分引擎写入；旧快照缺 `band` 时按 `standard` 用 `bandOf` 兜底
 * （与学生端解读同一口径）。解析失败/非数组一律返回空数组：脏数据只让这一行没有档位，不阻断整张名册。
 */
export function rosterBands(scoresJson: string | null | undefined): AssessmentRosterBand[] {
  return parseScores(scoresJson).map((score) => ({
    key: score.key,
    label: score.label,
    band: score.band ?? bandOf(score.standard),
  }));
}

/**
 * 名册行（与 `/api/manage/assessment/roster` 的白名单字段一致）。
 *
 * #313 起一份名册可能是三种形态之一：
 * - `riasec` + `status=done`：`code`（三字码）+ `assessedAt`；
 * - dimensional 量表（如 `ipip-neo-ffi`）+ `status=done`：`bands`（档位）+ `assessedAt`，**没有 `code`**；
 * - `status=missing`：只有定位信息（用 `AssessmentMissingRosterItem`），没有任何测评字段。
 */
export interface AssessmentRosterItem {
  classId: number | null;
  className: string | null;
  name: string;
  userCode: string;
  /** 三字码；dimensional 量表与未完成名单都没有 */
  code?: string;
  /** dimensional 量表的逐维档位；riasec 与未完成名单都没有 */
  bands?: AssessmentRosterBand[];
  /** 完成时间；未完成名单没有 */
  assessedAt?: string;
}

/** 未完成名单行（#313）：在册但还没有该量表当前有效结果的学生，只给定位信息 */
export interface AssessmentMissingRosterItem {
  classId: number | null;
  className: string | null;
  name: string;
  userCode: string;
}

/**
 * 弹窗内的即时筛选：姓名/学号关键字（不区分大小写）+ 只看某一型（服务端也已过滤，这里兜切换瞬间）。
 * 对没有 `code` 的行（dimensional 量表 / 未完成名单），带 `lead` 时一律不命中——接口层也已拒绝这种组合。
 */
export function filterRosterItems<T extends { name: string; userCode: string; code?: string }>(
  items: readonly T[],
  filters: { query?: string; lead?: string | null } = {}
): T[] {
  const query = (filters.query ?? "").trim().toLowerCase();
  const lead = filters.lead ?? null;
  return items.filter((item) => {
    if (lead && (item.code ?? "").slice(0, 1).toUpperCase() !== lead) return false;
    if (query === "") return true;
    return item.name.toLowerCase().includes(query) || item.userCode.toLowerCase().includes(query);
  });
}

/** 测评栏的五种界面状态：先加载、再失败、再看是否开放、再看有没有数据 */
export type AssessmentSectionState = "loading" | "failed" | "disabled" | "empty" | "ready";

export function resolveSectionState(input: {
  loading: boolean;
  failed: boolean;
  /** 量表是否开放；未知（还没取到）按开放处理，避免一进来就闪「未开放」 */
  enabled: boolean;
  /** 已完成人数 */
  assessed: number;
}): AssessmentSectionState {
  if (input.loading) return "loading";
  if (input.failed) return "failed";
  if (!input.enabled) return "disabled";
  if (input.assessed <= 0) return "empty";
  return "ready";
}
