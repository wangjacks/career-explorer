/**
 * 教师端测评统计的展示口径（#229）：纯函数，把两适配器数出来的**原始计数**算成接口响应。
 *
 * 为什么不放适配器里：完成率公式、排序破平、Top-N 截断、中文标签这些是**业务口径**，
 * 两个适配器各写一遍必然慢慢分叉。适配器只做 SQL 计数，口径统一在这里实现并被单测锁住。
 *
 * 数据边界：这一层只处理聚合数字（班级名/完成度/类型计数/三字码），**不接触姓名学号**；
 * 个人明细走 `/api/manage/assessment/roster`（单独记审计）。
 */

import type { AssessmentStatsRaw } from "./db";

/** 三字码排行默认取前 N 名（数值可在接口层调整，`codes` 原始计数不受限） */
export const ASSESSMENT_CODES_TOP_N = 10;

/** 班级完成度：`{ classId, name, enrolled, assessed, rate }`（rate 为百分比，最多 1 位小数） */
export interface AssessmentClassCompletion {
  classId: number;
  name: string;
  /** 在册学生数（未测评也计入分母） */
  enrolled: number;
  /** 已完成当前有效测评的学生数 */
  assessed: number;
  /** 完成率（0–100，一位小数；分母为 0 记 0） */
  rate: number;
}

/** 六型计数：按量表声明的维度顺序输出，**六型齐全**（计数为 0 也保留，前端画图不用自己补） */
export interface AssessmentTypeCount {
  key: string;
  label: string;
  count: number;
}

/** 三字码排行的一项：`lead` 是首位类型标记（= 该生归型依据） */
export interface AssessmentCodeCount {
  code: string;
  count: number;
  lead: string;
  leadLabel: string;
}

/** 总数小结；`lastSubmittedAt` 取最近一次完成时间（无结果时为 null） */
export interface AssessmentTotalSummary {
  enrolled: number;
  assessed: number;
  rate: number;
  lastSubmittedAt: string | null;
}

export interface AssessmentStats {
  classes: AssessmentClassCompletion[];
  types: AssessmentTypeCount[];
  codes: AssessmentCodeCount[];
  total: AssessmentTotalSummary;
}

/** 完成率：0–100 的一位小数；分母为 0 记 0，**钳到 100 以内**（脏数据里 assessed > enrolled 也不出怪值） */
export function completionRate(assessed: number, enrolled: number): number {
  if (!Number.isFinite(assessed) || !Number.isFinite(enrolled) || enrolled <= 0) return 0;
  const ratio = Math.min(1, Math.max(0, assessed / enrolled));
  return Math.round(ratio * 1000) / 10;
}

/** 空文本/空白的时间视为「没有时间」（库里 TEXT 列历史上有空串脏数据） */
function normalizeTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 原始计数 → 接口响应。
 *
 * - 班级按名称升序、同名学生按 `classId` 升序（**不依赖库排序规则**，SQLite/MySQL 输出顺序一致）；
 * - 六型按 `dimensions` 的声明顺序（RIASEC）输出，缺失补 0，标签取量表定义；
 * - 三字码按 `count` 降序、同数按 `code` 升序，取前 `topN`，并带首位类型标记（含中文标签）。
 */
export function finalizeAssessmentStats(
  raw: AssessmentStatsRaw,
  dimensions: readonly { key: string; label: string }[],
  options: { topN?: number } = {}
): AssessmentStats {
  const topN = options.topN ?? ASSESSMENT_CODES_TOP_N;
  const labelOf = new Map(dimensions.map((dim) => [dim.key, dim.label]));

  const classes: AssessmentClassCompletion[] = raw.classes
    .map((row) => {
      // 脏数据（assessed > enrolled）按 enrolled 钳住，完成度不出 >100% 的怪值
      const assessed = Math.min(Math.max(0, row.enrolled), Math.max(0, row.assessed));
      return {
        classId: row.class_id,
        name: row.name,
        enrolled: row.enrolled,
        assessed,
        rate: completionRate(assessed, row.enrolled),
      };
    })
    .sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : a.classId - b.classId));

  const typeCounts = new Map(raw.types.map((row) => [row.key, row.count]));
  const types: AssessmentTypeCount[] = dimensions.map((dim) => ({
    key: dim.key,
    label: dim.label,
    count: Math.max(0, typeCounts.get(dim.key) ?? 0),
  }));

  const codes: AssessmentCodeCount[] = raw.codes
    .filter((row) => typeof row.code === "string" && row.code.trim() !== "")
    .map((row) => {
      const code = row.code.trim().toUpperCase();
      const lead = code.slice(0, 1);
      return { code, count: Math.max(0, row.count), lead, leadLabel: labelOf.get(lead) ?? lead };
    })
    .sort((a, b) => b.count - a.count || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0))
    .slice(0, Math.max(0, topN));

  const enrolled = Math.max(0, raw.total.enrolled);
  const assessed = Math.min(enrolled, Math.max(0, raw.total.assessed));
  return {
    classes,
    types,
    codes,
    total: {
      enrolled,
      assessed,
      rate: completionRate(assessed, enrolled),
      lastSubmittedAt: normalizeTime(raw.total.last_completed_at),
    },
  };
}
