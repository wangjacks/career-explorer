/**
 * 统计口径公共工具。日期一律用 `YYYY-MM-DD` 字符串表示。
 * Asia/Shanghai 无夏令时，以 UTC 午夜为锚做日历天加减不会漂移，故不引入日期库。
 */

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

export interface GroupedTrend {
  /** 分组名；调用方按名称升序传入，「未分班」固定排末尾 */
  keys: string[];
  /** 窗口内每天一个点，每个分组都已补齐为 0 */
  points: { date: string; counts: Record<string, number> }[];
}

/**
 * 稀疏的「日期 × 分组」结果 → 连续多序列：与 fillTrendSeries 同口径补齐，
 * 保证多序列折线每条都有等长的 N 个点（缺日期的序列会整段断开）。
 */
export function fillGroupedTrend(
  rows: readonly { date: string; key: string; count: number }[],
  startDate: string,
  days: number
): GroupedTrend {
  const keys: string[] = [];
  for (const row of rows) {
    if (!keys.includes(row.key)) keys.push(row.key);
  }
  // 「未分班」排末尾（与班级对比、班级概览的行序一致）；其余保持传入顺序（SQL 已按名称升序）
  const ordered = [...keys.filter((k) => k !== "未分班"), ...keys.filter((k) => k === "未分班")];

  const byDate = new Map<string, Map<string, number>>();
  for (const row of rows) {
    const bucket = byDate.get(row.date) ?? new Map<string, number>();
    bucket.set(row.key, (bucket.get(row.key) ?? 0) + row.count);
    byDate.set(row.date, bucket);
  }

  const points = buildDateRange(startDate, days).map((date) => {
    const bucket = byDate.get(date);
    const counts: Record<string, number> = {};
    for (const key of ordered) counts[key] = bucket?.get(key) ?? 0;
    return { date, counts };
  });

  return { keys: ordered, points };
}
