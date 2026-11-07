/**
 * 班级完成矩阵的展示口径（#310）：纯函数，把适配器数出来的**原始计数**组装成接口响应。
 *
 * 为什么不放适配器里：完成率、列顺序、行排序、空班剔除、未分班汇总与总计都是业务口径，
 * 两个适配器各写一遍必然慢慢分叉。适配器只按 `class_id` 分组数数（`null` = 未分班），
 * 口径统一在这里实现并被单测锁住。
 *
 * 数据边界：这一层只处理聚合数字（班名/完成人数/完成率），**不接触姓名学号**；
 * 个人明细走 `/api/manage/assessment/roster`（单独记审计）。
 */

import type { CompletionStatsRaw } from "./db";
import { completionRate } from "./assessment-stats";
import { UNASSIGNED_CLASS_LABEL } from "./class-identity";

/** 档案提交列恒为第一列，key 固定为 `profile`（#310） */
export const COMPLETION_PROFILE_KEY = "profile";

/** 完成矩阵列由启用量表驱动；纯函数只认这几个字段，不依赖整行 `AssessmentRow` */
export interface CompletionScale {
  id: number;
  code: string;
  name: string;
  scoringMode: "typological" | "dimensional";
}

export interface CompletionColumn {
  key: string;
  label: string;
  /** 量表正式名；档案列没有 */
  scaleName?: string;
  scoringMode?: "typological" | "dimensional";
}

export interface CompletionCell {
  /** 已完成人数；脏数据下钳到 enrolled 以内 */
  done: number;
  /** 完成率（0–100，一位小数；分母为 0 记 0） */
  rate: number;
}

export interface CompletionRow {
  classId: number;
  name: string;
  /** 在册学生数（未完成也计入分母） */
  enrolled: number;
  /** 是否允许打开个人明细；教师看「所有班级」时恒 false（#314 看板口径） */
  canDrilldown: boolean;
  cells: Record<string, CompletionCell>;
}

export interface CompletionUnassigned {
  name: string;
  enrolled: number;
  cells: Record<string, CompletionCell>;
}

export interface CompletionTotal {
  enrolled: number;
  cells: Record<string, CompletionCell>;
}

export interface CompletionStatsResult {
  columns: CompletionColumn[];
  rows: CompletionRow[];
  /** 没有未分班学生（或范围被收窄到具体班级）时为 null */
  unassigned: CompletionUnassigned | null;
  total: CompletionTotal;
}

export interface FinalizeCompletionOptions {
  /** 教师「只看我的班」的班级集合；null/undefined = 全校（含未分班） */
  classIds?: number[] | null;
  /** 行是否允许下钻；教师看「所有班级」时为 false */
  canDrilldown?: boolean;
}

/** 非负整数计数；NaN/Infinity/负数一律按 0，避免界面出现怪值 */
function count(value: number): number {
  return Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** 完成格子：done 钳到 enrolled，rate 复用 #229 的完成率口径（一位小数、钳到 100%） */
function cellOf(done: number, enrolled: number): CompletionCell {
  const total = count(enrolled);
  const safeDone = Math.min(total, count(done));
  return { done: safeDone, rate: completionRate(safeDone, total) };
}

/** 量表的展示短名：列由启用量表动态驱动，不硬编码具体 code；前端仍可按 code 覆盖 */
function scaleLabel(scale: CompletionScale): string {
  return scale.scoringMode === "typological" ? "兴趣测评" : "人格测评";
}

function assessmentKey(scale: CompletionScale): string {
  return `assessment:${scale.code}`;
}

function displayClassName(name: string | null, classId: number): string {
  const trimmed = typeof name === "string" ? name.trim() : "";
  return trimmed || `班级 ${classId}`;
}

/**
 * 原始计数 → 接口响应。
 *
 * - `columns[0]` 恒为档案提交，其后按启用量表顺序追加；
 * - 行按档案提交率升序（最该催的在前），同率按班名 `zh-CN`、再按 `classId` 破平；
 * - `enrolled = 0` 的空班不出行；未分班学生单独进 `unassigned` 与 `total`，
 *   `classIds` 收窄时（教师只看本人班）未分班学生不在范围内；
 * - 所有完成率钳到 100%，零学生分母不出 `NaN`。
 */
export function finalizeCompletionStats(
  raw: CompletionStatsRaw,
  assessments: readonly CompletionScale[],
  options: FinalizeCompletionOptions = {}
): CompletionStatsResult {
  const scopedClassIds = options.classIds ?? null;
  const allowed = scopedClassIds === null ? null : new Set(scopedClassIds);
  const canDrilldown = options.canDrilldown ?? true;

  // 先剔除非法量表，再按 code 去重：否则前面的非法重复项会让后面的合法量表被 findIndex 误判掉
  const seenCodes = new Set<string>();
  const scales = assessments.filter((scale) => {
    if (!Number.isInteger(scale.id) || scale.id <= 0) return false;
    if (typeof scale.code !== "string" || scale.code.trim() === "") return false;
    if (seenCodes.has(scale.code)) return false;
    seenCodes.add(scale.code);
    return true;
  });

  const columns: CompletionColumn[] = [
    { key: COMPLETION_PROFILE_KEY, label: "档案提交" },
    ...scales.map((scale) => ({
      key: assessmentKey(scale),
      label: scaleLabel(scale),
      scaleName: scale.name,
      scoringMode: scale.scoringMode,
    })),
  ];

  // 先按 class_id 聚合档案段；同名班/改名都不会串数据（name 只用于展示）
  const profileByClass = new Map<
    number | null,
    { name: string | null; enrolled: number; submitted: number }
  >();
  for (const row of raw.profile) {
    const classId = row.class_id === null ? null : Number(row.class_id);
    if (allowed !== null && (classId === null || !allowed.has(classId))) continue;
    const existing = profileByClass.get(classId);
    const enrolled = count(row.enrolled);
    const submitted = count(row.submitted);
    if (existing) {
      existing.enrolled += enrolled;
      existing.submitted += submitted;
      if (!existing.name && row.name) existing.name = row.name;
    } else {
      profileByClass.set(classId, { name: row.name ?? null, enrolled, submitted });
    }
  }

  // 量表段按 `${assessmentId}:${classId}` 聚合；缺失的班在组装 cells 时补 0
  const assessedByClass = new Map<string, number>();
  for (const row of raw.assessments) {
    const classId = row.class_id === null ? null : Number(row.class_id);
    if (allowed !== null && (classId === null || !allowed.has(classId))) continue;
    const key = `${Number(row.assessment_id)}:${classId === null ? "null" : classId}`;
    assessedByClass.set(key, (assessedByClass.get(key) ?? 0) + count(row.assessed));
  }

  const buildCells = (classId: number | null, enrolled: number, submitted: number) => {
    const cells: Record<string, CompletionCell> = {
      [COMPLETION_PROFILE_KEY]: cellOf(submitted, enrolled),
    };
    for (const scale of scales) {
      const assessed = assessedByClass.get(`${scale.id}:${classId === null ? "null" : classId}`) ?? 0;
      cells[assessmentKey(scale)] = cellOf(assessed, enrolled);
    }
    return cells;
  };

  const totalDone = new Map<string, number>();
  totalDone.set(COMPLETION_PROFILE_KEY, 0);
  for (const scale of scales) totalDone.set(assessmentKey(scale), 0);
  let totalEnrolled = 0;
  const rows: CompletionRow[] = [];
  let unassigned: CompletionUnassigned | null = null;

  for (const [classId, profile] of profileByClass) {
    const enrolled = count(profile.enrolled);
    if (enrolled <= 0) continue;
    const cells = buildCells(classId, enrolled, profile.submitted);
    if (classId === null) {
      unassigned = { name: UNASSIGNED_CLASS_LABEL, enrolled, cells };
    } else {
      rows.push({
        classId,
        name: displayClassName(profile.name, classId),
        enrolled,
        canDrilldown,
        cells,
      });
    }
    totalEnrolled += enrolled;
    for (const [key, cell] of Object.entries(cells)) {
      totalDone.set(key, (totalDone.get(key) ?? 0) + cell.done);
    }
  }

  rows.sort((a, b) => {
    const rateA = a.cells[COMPLETION_PROFILE_KEY]?.rate ?? 0;
    const rateB = b.cells[COMPLETION_PROFILE_KEY]?.rate ?? 0;
    if (rateA !== rateB) return rateA - rateB;
    return a.name.localeCompare(b.name, "zh-CN") || a.classId - b.classId;
  });

  const totalCells: Record<string, CompletionCell> = {};
  for (const column of columns) {
    totalCells[column.key] = cellOf(totalDone.get(column.key) ?? 0, totalEnrolled);
  }

  return {
    columns,
    rows,
    unassigned,
    total: { enrolled: totalEnrolled, cells: totalCells },
  };
}
