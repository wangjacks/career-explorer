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
