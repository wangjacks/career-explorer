import { formatRateText, type ClassTrendSeries, type CompareStat } from "@/lib/stats-utils";
import { type ClassGroup } from "@/lib/class-identity";

export type { ClassTrendSeries };

export interface TrendItem {
  date: string;
  count: number;
}

export interface DistributionItem {
  category: string;
  count: number;
}

export type CompareItem = CompareStat;

/** 点名册条超过此人数退化为按比例轨，避免上千个 DOM 节点 */
export const ROSTER_MARK_CAP = 200;

/** 在册 / 已提交 / 未提交 / 提交率：由已拉取的 compare 求和，口径与「数据概览」的总提交数同源 */
export function computeDashboardTotals(compare: CompareItem[]) {
  const enrolled = compare.reduce((sum, c) => sum + c.total, 0);
  const submitted = compare.reduce((sum, c) => sum + c.submitted, 0);
  return {
    enrolled,
    submitted,
    unsubmitted: Math.max(0, enrolled - submitted),
    rateText: formatRateText(submitted, enrolled, 1),
  };
}

/** 学号脱敏：12 位保留首 4 末 4；其它长度也至少遮住中间，避免原样泄露 */
export function maskStudentCode(code: string): string {
  const value = String(code ?? "");
  if (value.length <= 4) return "****";
  if (value.length <= 8) return `${value.slice(0, 1)}****${value.slice(-1)}`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 点名册条：每人一格，每 10 格断一栏（花名册分栏）；超上限退化为比例轨（见 ROSTER_MARK_CAP） */
export function computeRosterBits(enrolled: number, submitted: number) {
  const groups: boolean[][] = [];
  if (enrolled <= ROSTER_MARK_CAP) {
    for (let start = 0; start < enrolled; start += 10) {
      const size = Math.min(10, enrolled - start);
      groups.push(Array.from({ length: size }, (_, k) => start + k < submitted));
    }
  }
  const tickStep = Math.min(6, Math.round(400 / Math.max(1, enrolled)));
  return { groups, tickStep };
}

/**
 * 分班多序列：recharts 要求每个分组是数据项的顶层数值字段，故按 series 顺序生成
 * `s0...` 位置别名。班名是用户输入，不能直接当图表字段（`date` / `__proto__` / `s0`
 * 都会撞车），`counts` 只按 key 取值，不展开到图表行。
 */
export function buildClassSeries(
  series: readonly ClassGroup[],
  points: ClassTrendSeries["points"]
): Record<string, string | number>[] {
  return points.map((point) => {
    const row: Record<string, string | number> = { date: point.date };
    series.forEach((group, index) => {
      row[`s${index}`] = point.counts[group.key] ?? 0;
    });
    return row;
  });
}

/** 面板主页按时段问候（入参为本地小时 0–23；跨时段停留时调用方每分钟重算） */
export function getTimeGreeting(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/** 侧边栏分组的最小形状：主页卡片与侧边栏共用同一份导航数据 */
export interface NavGroupLike<T> {
  /** 组头；无组头的单项分组省略 */
  label?: string;
  items: T[];
}

/**
 * 主页快捷入口：从侧边栏的分组数据里去掉「当前页自身」与空分组。
 * 导航只维护一份（`src/lib/panel-nav.ts`，#361 起同时承载路由），新增栏目时主页卡片
 * 自动跟着出现，不会出现「侧边栏加了、主页忘了加」的两处维护。
 */
export function buildQuickNavGroups<T extends { key: string }>(
  groups: readonly NavGroupLike<T>[],
  currentKey: string
): NavGroupLike<T>[] {
  return groups
    .map((group) => ({ ...group, items: group.items.filter((item) => item.key !== currentKey) }))
    .filter((group) => group.items.length > 0);
}
