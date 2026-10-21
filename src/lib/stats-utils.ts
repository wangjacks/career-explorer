/**
 * 统计口径公共工具。日期一律用 `YYYY-MM-DD` 字符串表示。
 * Asia/Shanghai 无夏令时，以 UTC 午夜为锚做日历天加减不会漂移，故不引入日期库。
 */

import {
  isUnassignedClassKey,
  toClassGroup,
  type ClassGroup,
} from "./class-identity";

const DAY_MS = 86400000;

export const DEFAULT_TREND_DAYS = 30;
/** 上限同时兜住「?days=1e9」：补零后的点数等于 days，不钳制会直接撑爆内存 */
export const MAX_TREND_DAYS = 366;

export function shiftDate(date: string, deltaDays: number): string {
  return new Date(new Date(`${date}T00:00:00Z`).getTime() + deltaDays * DAY_MS)
    .toISOString()
    .slice(0, 10);
}

export function normalizeTrendDays(days: unknown): number {
  if (days === null || days === undefined || (typeof days === "string" && days.trim() === "")) {
    return DEFAULT_TREND_DAYS;
  }
  const n = Number(days);
  if (!Number.isFinite(n)) return DEFAULT_TREND_DAYS;
  return Math.min(MAX_TREND_DAYS, Math.max(1, Math.floor(n)));
}

/** 连续日期序列 `[start .. start + days - 1]` */
export function buildDateRange(startDate: string, days: number): string[] {
  const dates: string[] = [];
  for (let i = 0; i < days; i++) dates.push(shiftDate(startDate, i));
  return dates;
}

/**
 * 稀疏 SQL 结果 → 连续序列：窗口内缺失日期补 0、轴外数据丢弃、同日期累加。
 * 「近 N 天」在图上就是 N 个点，否则无提交的整日会从分类轴上消失、看起来连续。
 */
export function fillTrendSeries(
  rows: readonly { date: string; count: number }[],
  startDate: string,
  days: number
): { date: string; count: number }[] {
  const byDate = new Map<string, number>();
  for (const row of rows) {
    byDate.set(row.date, (byDate.get(row.date) || 0) + row.count);
  }
  return buildDateRange(startDate, days).map((date) => ({ date, count: byDate.get(date) || 0 }));
}

/** 分母为 0 返回 "-"，与「班级概览」表格的零保护口径一致 */
export function formatRateText(submitted: number, total: number, digits = 2): string {
  if (total <= 0) return "-";
  return `${((submitted / total) * 100).toFixed(digits)}%`;
}

/** 分组对比项（#165/#260）：key 是身份，label 只用于展示 */
export interface CompareStat extends ClassGroup {
  total: number;
  submitted: number;
}

export interface ClassTrendPoint {
  date: string;
  counts: Record<string, number>;
}

/** 按班级分层的提交趋势（#165/#260）：series 有序，未分班固定最后 */
export interface ClassTrendSeries {
  series: ClassGroup[];
  points: ClassTrendPoint[];
}

/** 适配器原始行：SQL 只负责按 classes.id 分组，身份与展示映射统一在下方完成 */
export interface RawClassTrendRow {
  d: string | Date;
  class_id: number | string | null;
  class_name: string | null;
  cnt: number | string;
}

export interface RawCompareRow {
  class_id: number | string | null;
  class_name: string | null;
  total: number | string;
  submitted: number | string | null;
}

/**
 * 稀疏的「日期 × 分组」结果 → 连续多序列：与 fillTrendSeries 同口径补齐，
 * 保证多序列折线每条都有等长的 N 个点（缺日期的序列会整段断开）。
 *
 * 前置约定：rows 已按窗口过滤（适配器的 WHERE 负责）。series 取自全部入参行，
 * 只在窗口外出现的分组会留下一条全 0 线——生产路径不满足该前提时须自行先筛。
 */
export function fillGroupedTrend(
  rows: readonly { date: string; key: string; label: string; count: number }[],
  startDate: string,
  days: number
): ClassTrendSeries {
  const groups = new Map<string, ClassGroup>();
  for (const row of rows) {
    if (!groups.has(row.key)) groups.set(row.key, { key: row.key, label: row.label });
  }
  // 未分班哨兵排末尾（与班级对比、班级概览的行序一致）；其余保持传入顺序（SQL 已按名称升序）
  const all = Array.from(groups.values());
  const ordered = [
    ...all.filter((group) => !isUnassignedClassKey(group.key)),
    ...all.filter((group) => isUnassignedClassKey(group.key)),
  ];

  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const bucket = byDate.get(row.date) ?? new Map<string, number>();
    bucket.set(row.key, (bucket.get(row.key) ?? 0) + row.count);
    byDate.set(row.date, bucket);
  }

  const points = buildDateRange(startDate, days).map((date) => {
    const bucket = byDate.get(date);
    // 班名是用户输入：用 fromEntries 建立自有属性，避免 "__proto__" 触发原型 setter
    const counts = Object.fromEntries(
      ordered.map((group) => [group.key, bucket?.get(group.key) ?? 0])
    ) as Record<string, number>;
    return { date, counts };
  });

  return { series: ordered, points };
}

function normalizeSqlDate(value: string | Date): string {
  if (value instanceof Date) {
    const year = value.getFullYear();
    const month = String(value.getMonth() + 1).padStart(2, "0");
    const day = String(value.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }
  return String(value).slice(0, 10);
}

/** 两适配器共用的趋势映射入口：MySQL 的字符串计数与 SQLite 的数字计数在这里归一 */
export function fillClassTrend(
  rows: readonly RawClassTrendRow[],
  startDate: string,
  days: number
): ClassTrendSeries {
  return fillGroupedTrend(
    rows.map((row) => {
      const group = toClassGroup(row.class_id, row.class_name);
      return {
        date: normalizeSqlDate(row.d),
        key: group.key,
        label: group.label,
        count: Number(row.cnt ?? 0),
      };
    }),
    startDate,
    days
  );
}

/** 两适配器共用的对比映射入口：同名班（脏数据/并发建班）按 key 聚合，避免重复序列 */
export function mapCompareRows(rows: readonly RawCompareRow[]): CompareStat[] {
  const byKey = new Map<string, CompareStat>();
  for (const row of rows) {
    const group = toClassGroup(row.class_id, row.class_name);
    const total = Number(row.total ?? 0);
    const submitted = Number(row.submitted ?? 0);
    const existing = byKey.get(group.key);
    if (existing) {
      existing.total += total;
      existing.submitted += submitted;
    } else {
      byKey.set(group.key, { ...group, total, submitted });
    }
  }
  const all = Array.from(byKey.values());
  return [
    ...all.filter((item) => !isUnassignedClassKey(item.key)),
    ...all.filter((item) => isUnassignedClassKey(item.key)),
  ];
}
