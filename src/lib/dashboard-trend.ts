import type { ClassTrendSeries, TrendItem } from "@/lib/dashboard-utils";

/**
 * 趋势卡的取数视图模型（#262）。
 *
 * 「近 N 天」与「合计 / 按班级」是两个**取数维度**，屏上却只有一份图与一个合计：
 * 只要渲染的数据不是当前这一组选择取回来的，就会出现「近 7 天」配 30 天曲线、
 * 或在「按班级」下改过天数后切回「合计」时沿用旧窗口这类错配。故缓存按
 * `(group, days)` 分槽，视图只认与当前选择**完全匹配**的那一项，匹配不到就是加载态
 * （「还没到」不等于「确实没有数据」，两者必须分屏）。
 *
 * 键空间有界：天数只有 `DAY_OPTIONS` 四个取值 × 两个分组 = 8 项，故不做淘汰——
 * 淘汰只会凭空多出一条「曾经有过又没了」的陈旧路径。
 */

export type TrendGroup = "total" | "class";

export interface TrendSelection {
  days: number;
  group: TrendGroup;
}

/** 取回来的一份数据自带它的选择：键由数据本身派生，结构上写不出「把 7 天的结果放进 30 天的槽」 */
export type TrendEntry =
  | { days: number; group: "total"; trends: TrendItem[] }
  | { days: number; group: "class"; classTrend: ClassTrendSeries };

export type TrendCache = Readonly<Record<string, TrendEntry>>;

export type TrendView = { status: "ready"; entry: TrendEntry } | { status: "loading" };

export function trendEntryKey(selection: TrendSelection): string {
  return `${selection.group}:${selection.days}`;
}

/** 不可变写入：同一选择重复取数即覆盖自己那一槽，不动其它槽 */
export function mergeTrendEntry(cache: TrendCache, entry: TrendEntry): TrendCache {
  return { ...cache, [trendEntryKey(entry)]: entry };
}

export function selectTrendView(cache: TrendCache, selection: TrendSelection): TrendView {
  const entry: TrendEntry | undefined = cache[trendEntryKey(selection)];
  return entry === undefined ? { status: "loading" } : { status: "ready", entry };
}

/** 卡底合计：合计模式即逐日求和；按班级模式把每个点的各班会话数加总（班名只当字典键，不参与计算） */
export function computeTrendTotal(entry: TrendEntry): number {
  if (entry.group === "total") {
    return entry.trends.reduce((sum, item) => sum + item.count, 0);
  }
  return entry.classTrend.points.reduce(
    (sum, point) => sum + Object.values(point.counts).reduce((partial, count) => partial + count, 0),
    0
  );
}
