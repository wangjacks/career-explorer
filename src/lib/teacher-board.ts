/**
 * 教师端「测评看板」（#314）的纯函数层。
 *
 * 页面把「做到哪了」收成三块：hero（档案完成进度 + 班级点阵）、班级完成矩阵、行动条。
 * 这三块的口径与降级都先在这里算好，组件只画——仓库没有 DOM 测试环境，
 * 因此点阵分组、行动条优先级、提醒话术、兴趣构成条都必须能直接单测。
 *
 * 数据边界：本模块只处理聚合数字（班名 / 人数 / 完成率 / 六型计数），
 * **不携带任何学生身份**；个人明细走 `/api/manage/assessment/roster`（服务端逐次记审计）。
 * 点阵每格只是一个布尔位，禁止把「第几个学生」写进 `title` / `aria-label`。
 */

import { RIASEC_LABELS, RIASEC_KEYS, type RiasecKey } from "./assessment-match";
import { typeColorOf } from "./assessment-colors";
import type { AssessmentClassTypeComposition } from "./assessment-stats";

/** 档案列固定 key（与 `/api/manage/stats/completion` 的 `COMPLETION_PROFILE_KEY` 一致） */
export const PROFILE_COLUMN_KEY = "profile";
/** 量表列 key 前缀：`assessment:<code>` */
export const ASSESSMENT_COLUMN_PREFIX = "assessment:";

/** 点阵列数下限 / 上限（#314 §3.2：`clamp(12, 60, ceil(total / 2))`） */
export const PROGRESS_GRID_MIN_COLUMNS = 12;
export const PROGRESS_GRID_MAX_COLUMNS = 60;
/** 点阵人数上限：超过后退化为比例轨（与 `ROSTER_MARK_CAP` 同一取舍） */
export const PROGRESS_GRID_CAP = 200;

/**
 * 点阵描边色（#314 §3.2 验收口径：浅色 `rgb(79,119,66)`，深色降到半透明薄荷绿保证可见）。
 * 单测直接对这组常量算对比度，组件里不要再写字面量。
 */
export const TICK_STROKE_LIGHT = "rgb(79, 119, 66)";
export const TICK_STROKE_DARK = "rgba(167, 243, 208, 0.55)";
/** hero 底色（浅 / 深），对比度单测与点阵描边一起算 */
export const HERO_BG_LIGHT = "#065f46";
export const HERO_BG_DARK = "#064e3b";

/** 看板区块的显示状态（#314 §3.3：loading > failed > disabled > empty > ready） */
export type SectionState = "loading" | "failed" | "disabled" | "empty" | "ready";

/** 页面范围：`mine` = 我带的班（默认），`all` = 所有班级（只读聚合） */
export type CompletionScope = "mine" | "all";

/** 一格完成度（已做人数 + 比例，比例服务端已钳到 100 以内） */
export interface CompletionCellView {
  done: number;
  rate: number;
}

/** 完成矩阵的列（#310：`columns` 由启用量表驱动，前端不写死） */
export interface CompletionColumnView {
  key: string;
  label: string;
  /** 量表正式名；档案列没有 */
  scaleName: string;
  scoringMode: "typological" | "dimensional" | null;
}

/** 矩阵的一行：一个班（`classId` 为键，班名只用于展示） */
export interface CompletionRowView {
  classId: number;
  name: string;
  enrolled: number;
  canDrilldown: boolean;
  cells: Record<string, CompletionCellView>;
}

export interface CompletionUnassignedView {
  name: string;
  enrolled: number;
  cells: Record<string, CompletionCellView>;
}

export interface CompletionTotalView {
  enrolled: number;
  cells: Record<string, CompletionCellView>;
}

export interface CompletionStatsView {
  columns: CompletionColumnView[];
  rows: CompletionRowView[];
  unassigned: CompletionUnassignedView | null;
  total: CompletionTotalView;
}

/** 非负整数；NaN / Infinity / 负数一律 0，界面不出现 NaN */
function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? Math.max(0, Math.trunc(value)) : 0;
}

/** 完成率：0–100 一位小数，脏数据钳到 100 之内 */
function toRate(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) return 0;
  return Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
}

/** 防御式解析一格：缺字段按 0，保证界面与 aria-label 都不会出现 NaN */
export function normalizeCell(raw: unknown): CompletionCellView {
  if (raw === null || typeof raw !== "object") return { done: 0, rate: 0 };
  const record = raw as Record<string, unknown>;
  return { done: toCount(record.done), rate: toRate(record.rate) };
}

function readText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 列 key `assessment:riasec` → `riasec`；档案列或脏 key 返回 null */
export function assessmentCodeOfColumn(columnKey: string): string | null {
  if (!columnKey.startsWith(ASSESSMENT_COLUMN_PREFIX)) return null;
  const code = columnKey.slice(ASSESSMENT_COLUMN_PREFIX.length).trim();
  return code === "" ? null : code;
}

/** 防御式解析 `/api/manage/stats/completion` 响应；形状不对返回 null（页面走失败态） */
export function normalizeCompletionStats(payload: unknown): CompletionStatsView | null {
  if (payload === null || typeof payload !== "object") return null;
  const raw = payload as Record<string, unknown>;
  if (!Array.isArray(raw.columns) || !Array.isArray(raw.rows)) return null;

  const columns: CompletionColumnView[] = [];
  const seen = new Set<string>();
  for (const entry of raw.columns) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const key = readText(record.key);
    if (key === "" || seen.has(key)) continue;
    seen.add(key);
    const scoringMode = record.scoringMode === "dimensional" ? "dimensional" : record.scoringMode === "typological" ? "typological" : null;
    columns.push({ key, label: readText(record.label) || readText(record.scaleName) || key, scaleName: readText(record.scaleName), scoringMode });
  }
  // 档案列恒为第一列：后端已保证，客户端再兜一次（缺了也能按班级名与量表列画）
  if (!seen.has(PROFILE_COLUMN_KEY)) {
    columns.unshift({ key: PROFILE_COLUMN_KEY, label: "", scaleName: "", scoringMode: null });
  }

  const parseCells = (value: unknown): Record<string, CompletionCellView> => {
    const cells: Record<string, CompletionCellView> = {};
    if (value === null || typeof value !== "object") return cells;
    for (const [key, cell] of Object.entries(value as Record<string, unknown>)) {
      if (!columns.some((column) => column.key === key)) continue;
      cells[key] = normalizeCell(cell);
    }
    return cells;
  };

  const rows: CompletionRowView[] = [];
  for (const entry of raw.rows) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const classId = Number(record.classId);
    if (!Number.isInteger(classId) || classId <= 0) continue;
    const enrolled = toCount(record.enrolled);
    if (enrolled <= 0) continue; // 空班不出行（#314 §2.3）
    rows.push({
      classId,
      name: readText(record.name) || `#${classId}`,
      enrolled,
      canDrilldown: record.canDrilldown === true,
      cells: parseCells(record.cells),
    });
  }

  const rawUnassigned = raw.unassigned;
  let unassigned: CompletionUnassignedView | null = null;
  if (rawUnassigned !== null && typeof rawUnassigned === "object") {
    const record = rawUnassigned as Record<string, unknown>;
    const enrolled = toCount(record.enrolled);
    if (enrolled > 0) {
      unassigned = { name: readText(record.name) || "", enrolled, cells: parseCells(record.cells) };
    }
  }

  const rawTotal = raw.total !== null && typeof raw.total === "object" ? (raw.total as Record<string, unknown>) : {};
  const total: CompletionTotalView = {
    enrolled: toCount(rawTotal.enrolled),
    cells: parseCells(rawTotal.cells),
  };
  if (total.enrolled === 0) {
    total.enrolled = rows.reduce((sum, row) => sum + row.enrolled, 0) + (unassigned?.enrolled ?? 0);
  }

  return { columns, rows, unassigned, total };
}

/** 取一行的某列；缺列按 0（不抛错，矩阵照常画） */
export function cellOf(row: Pick<CompletionRowView, "cells"> | Pick<CompletionUnassignedView, "cells">, columnKey: string): CompletionCellView {
  return row.cells[columnKey] ?? { done: 0, rate: 0 };
}

/** 量表列（不含档案列） */
export function scaleColumns(columns: readonly CompletionColumnView[]): CompletionColumnView[] {
  return columns.filter((column) => assessmentCodeOfColumn(column.key) !== null);
}

/** 兴趣构成列取第一个兴趣型量表；没有则返回 null（矩阵不画构成列） */
export function interestColumn(columns: readonly CompletionColumnView[]): CompletionColumnView | null {
  return (
    columns.find(
      (column) => assessmentCodeOfColumn(column.key) !== null && column.scoringMode === "typological"
    ) ?? null
  );
}

/** 完成率文本：整数百分比仍保留一位小数（60.0%），空分母显示 `-` */
export function formatRate(rate: number): string {
  if (!Number.isFinite(rate)) return "-";
  return `${(Math.min(100, Math.max(0, rate))).toFixed(1)}%`;
}

/** 一组点阵（一个班）；`ticks` 只含布尔位，没有任何学生身份 */
export interface ProgressGridGroup {
  classId: number | null;
  name: string;
  total: number;
  assessed: number;
  ticks: boolean[];
}

export interface ProgressGrid {
  /** `ticks` = 逐格点阵；`ratio` = 人数超过上限后的比例轨 */
  mode: "ticks" | "ratio";
  /** 点阵列数（ratio 模式下为 0） */
  columns: number;
  groups: ProgressGridGroup[];
  total: number;
  assessed: number;
  /** 0–100，一位小数 */
  rate: number;
  cap: number;
}

/** 班名排序：`zh-CN` 优先，同名用 classId 破平，未分班（classId=null）最后 */
function compareGroups(a: { classId: number | null; name: string }, b: { classId: number | null; name: string }): number {
  if (a.classId === null && b.classId !== null) return 1;
  if (a.classId !== null && b.classId === null) return -1;
  const byName = a.name.localeCompare(b.name, "zh-CN");
  if (byName !== 0) return byName;
  return (a.classId ?? 0) - (b.classId ?? 0);
}

/**
 * 班级点阵进度格（#314 §3.2，规格已评审，不得改）：
 *
 * - 每格 1 人，按班级分组；组内填充**该班前 `assessed` 格**（班级内谁已交不可知，这是纯聚合示意）；
 * - 分组顺序：班名 `localeCompare("zh-CN")`，同名用 `classId` 破平，未分班置末；
 * - 列数 `clamp(12, 60, ceil(total / 2))`——保证整体落在两行以内；
 * - `total > cap` 时整体退化为比例轨（`mode: "ratio"`）。
 */
export function buildProgressGrid(
  rows: readonly CompletionRowView[],
  unassigned: CompletionUnassignedView | null = null,
  cap: number = PROGRESS_GRID_CAP
): ProgressGrid {
  const safeCap = Number.isFinite(cap) && cap > 0 ? Math.trunc(cap) : PROGRESS_GRID_CAP;
  const groupSources: ProgressGridGroup[] = [];
  const ordered = [...rows].sort(compareGroups);
  for (const row of ordered) {
    if (row.enrolled <= 0) continue;
    const assessed = Math.min(row.enrolled, cellOf(row, PROFILE_COLUMN_KEY).done);
    groupSources.push({ classId: row.classId, name: row.name, total: row.enrolled, assessed, ticks: [] });
  }
  if (unassigned && unassigned.enrolled > 0) {
    const assessed = Math.min(unassigned.enrolled, cellOf(unassigned, PROFILE_COLUMN_KEY).done);
    groupSources.push({
      classId: null,
      name: unassigned.name,
      total: unassigned.enrolled,
      assessed,
      ticks: [],
    });
  }

  const total = groupSources.reduce((sum, group) => sum + group.total, 0);
  const assessed = groupSources.reduce((sum, group) => sum + group.assessed, 0);
  const rate = total > 0 ? Math.round((assessed / total) * 1000) / 10 : 0;

  if (total > safeCap) {
    return { mode: "ratio", columns: 0, groups: groupSources, total, assessed, rate, cap: safeCap };
  }

  const columns = Math.min(
    PROGRESS_GRID_MAX_COLUMNS,
    Math.max(PROGRESS_GRID_MIN_COLUMNS, Math.ceil(total / 2))
  );
  const groups = groupSources.map((group) => {
    const ticks: boolean[] = [];
    for (let index = 0; index < group.total; index++) ticks.push(index < group.assessed);
    return { ...group, ticks };
  });
  return { mode: "ticks", columns, groups, total, assessed, rate, cap: safeCap };
}

/** 行动条的目标：当前范围里完成率最低的那套量表 */
export interface ActionTarget {
  columnKey: string;
  scaleCode: string | null;
  scaleLabel: string;
  /** 全部合计：已完成 / 总数 */
  done: number;
  enrolled: number;
  /** 还没交的人数（聚合，不含姓名） */
  missingCount: number;
  /** 一个人都没做的班（升序，按班名） */
  notStarted: string[];
  /** 有缺口的班，按缺口降序（给「看未完成名单」与文案用） */
  missingClasses: { classId: number; name: string; missing: number }[];
}

/**
 * 选行动条要催的那一套量表：只看**允许下钻**的行（切「所有班级」时教师行
 * `canDrilldown=false`，行动条就不出现），取合计完成率最低的启用量表，
 * 同率按列顺序（先出现的优先）。
 */
export function pickActionTarget(
  rows: readonly CompletionRowView[],
  columns: readonly CompletionColumnView[]
): ActionTarget | null {
  const drillable = rows.filter((row) => row.canDrilldown && row.enrolled > 0);
  if (drillable.length === 0) return null;

  const candidates = scaleColumns(columns).map((column) => {
    let done = 0;
    let enrolled = 0;
    for (const row of drillable) {
      done += Math.min(row.enrolled, cellOf(row, column.key).done);
      enrolled += row.enrolled;
    }
    const rate = enrolled > 0 ? done / enrolled : 0;
    return { column, done, enrolled, rate };
  });
  if (candidates.length === 0) return null;

  let best = candidates[0];
  for (const candidate of candidates) {
    if (candidate.rate < best.rate) best = candidate;
  }

  const notStarted: string[] = [];
  const missingClasses: { classId: number; name: string; missing: number }[] = [];
  let missingCount = 0;
  for (const row of drillable) {
    const done = Math.min(row.enrolled, cellOf(row, best.column.key).done);
    const missing = row.enrolled - done;
    if (missing <= 0) continue;
    missingCount += missing;
    if (done === 0) notStarted.push(row.name);
    missingClasses.push({ classId: row.classId, name: row.name, missing });
  }
  missingClasses.sort((a, b) => b.missing - a.missing || a.name.localeCompare(b.name, "zh-CN"));

  return {
    columnKey: best.column.key,
    scaleCode: assessmentCodeOfColumn(best.column.key),
    scaleLabel: best.column.label,
    done: best.done,
    enrolled: best.enrolled,
    missingCount,
    notStarted,
    missingClasses,
  };
}

/**
 * 提醒话术（#314 §2.5）：纯字符串，**不含任何学生姓名**、不说「全校」，
 * 也不用「还差 / 在册 / 提交率」这类口径词。没人缺交时返回空串（调用方据此不渲染按钮）。
 */
export function buildReminderText(classNames: readonly string[], scaleLabel: string, missingCount: number): string {
  const names = classNames.map((name) => name.trim()).filter((name) => name !== "");
  const count = Number.isFinite(missingCount) ? Math.max(0, Math.trunc(missingCount)) : 0;
  if (names.length === 0 || count === 0) return "";
  return `${names.join("、")}还有 ${count} 人没交${scaleLabel}，麻烦提醒学生抽 10 分钟完成，谢谢。`;
}

/** 兴趣构成条的一段（六型之一） */
export interface CompositionSegment {
  key: RiasecKey;
  label: string;
  count: number;
  /** 占该班已测人数的百分比（0–100，一位小数） */
  percent: number;
  color: string;
}

export interface InterestComposition {
  /** 该班已测人数（六型计数之和） */
  assessed: number;
  segments: CompositionSegment[];
}

/**
 * 兴趣构成条（#314 §2.3）：按三字码首位计数，**一人只计一次**。
 * 只输出计数 > 0 的类型（堆叠条上零宽的段没有意义）；全 0 返回空段。
 * 颜色取自 `assessment-colors.ts` 的单一来源。
 */
export function buildInterestCompositionBar(
  byClass: readonly AssessmentClassTypeComposition[] | null | undefined,
  classId: number | null
): InterestComposition {
  const composition = Array.isArray(byClass) ? byClass.find((item) => item.classId === classId) : undefined;
  if (!composition || !Array.isArray(composition.types)) return { assessed: 0, segments: [] };

  const counts = new Map<string, number>();
  for (const entry of composition.types) {
    const key = readText(entry.key).toUpperCase();
    if (!(RIASEC_KEYS as readonly string[]).includes(key)) continue;
    counts.set(key, (counts.get(key) ?? 0) + Math.max(0, Math.trunc(Number(entry.count) || 0)));
  }
  const assessed = Array.from(counts.values()).reduce((sum, value) => sum + value, 0);
  if (assessed <= 0) return { assessed: 0, segments: [] };

  const segments: CompositionSegment[] = [];
  for (const key of RIASEC_KEYS) {
    const count = counts.get(key) ?? 0;
    if (count <= 0) continue;
    segments.push({
      key,
      label: RIASEC_LABELS[key],
      count,
      percent: Math.round((count / assessed) * 1000) / 10,
      color: typeColorOf(key).bar,
    });
  }
  return { assessed, segments };
}

/** 防御式解析 `/api/manage/stats/assessment` 的 `byClass`（兴趣构成列数据源） */
export function normalizeInterestByClass(payload: unknown): AssessmentClassTypeComposition[] {
  if (payload === null || typeof payload !== "object") return [];
  const raw = (payload as Record<string, unknown>).byClass;
  if (!Array.isArray(raw)) return [];
  const out: AssessmentClassTypeComposition[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const classId = Number(record.classId);
    if (!Number.isInteger(classId) || classId <= 0) continue;
    const types = Array.isArray(record.types)
      ? record.types
          .map((item) =>
            item !== null && typeof item === "object" ? (item as Record<string, unknown>) : null
          )
          .filter((item): item is Record<string, unknown> => item !== null)
          .map((item) => ({ key: readText(item.key).toUpperCase(), count: toCount(item.count) }))
          .filter((item) => (RIASEC_KEYS as readonly string[]).includes(item.key))
      : [];
    out.push({ classId, name: readText(record.name), assessed: toCount(record.assessed), types });
  }
  return out;
}

/** hero 每一行（档案 + 各量表）的视图：`columns` 驱动，不写死两行 */
export interface HeroProgressRow {
  key: string;
  label: string;
  scaleCode: string | null;
  done: number;
  enrolled: number;
  rate: number;
  /** 一个人都没做（前端显示「还没有学生开始」而不是 0%） */
  untouched: boolean;
}

/**
 * hero 的完成度行：`total.cells` 与 `columns` 一一对应。
 * `fallbackLabels` 是文案表的量表短名（前端按 code 映射，接口只给 code 与正式名）。
 */
export function buildHeroRows(
  columns: readonly CompletionColumnView[],
  total: CompletionTotalView,
  fallbackLabels: Readonly<Record<string, string>> = {}
): HeroProgressRow[] {
  return columns.map((column) => {
    const cell = cellOf(total, column.key);
    const done = Math.min(total.enrolled, cell.done);
    const code = assessmentCodeOfColumn(column.key);
    const label = code ? fallbackLabels[code] ?? column.label : column.label;
    return {
      key: column.key,
      label,
      scaleCode: code,
      done,
      enrolled: total.enrolled,
      rate: cell.rate,
      untouched: done === 0,
    };
  });
}

/** 一行里完成率最低的启用量表（操作列的「看未完成」按它打开名册） */
export function lowestScaleColumnForRow(
  row: Pick<CompletionRowView, "enrolled" | "cells">,
  columns: readonly CompletionColumnView[]
): CompletionColumnView | null {
  const candidates = scaleColumns(columns);
  if (candidates.length === 0) return null;
  let best = candidates[0];
  for (const column of candidates) {
    if (cellOf(row, column.key).rate < cellOf(row, best.key).rate) best = column;
  }
  return best;
}

/** 名册弹窗的请求：一套量表 × 完成状态；`classId=null` 表示当前范围内所有班（行动条入口） */
export interface RosterRequest {
  classId: number | null;
  className: string;
  scale: string;
  scaleLabel: string;
  status: "done" | "missing";
}

/** 名册弹窗可切换的量表 Tab */
export interface RosterScaleOption {
  code: string;
  label: string;
}

/** 量表口语短名：文案表里有映射就用短名，否则回退接口下发的正式名（#314 §9） */
export function scaleLabelOf(
  code: string | null,
  fallback: string,
  labels: Readonly<Record<string, string>>
): string {
  if (code !== null) {
    const mapped = labels[code];
    if (typeof mapped === "string" && mapped.trim() !== "") return mapped;
  }
  return fallback;
}