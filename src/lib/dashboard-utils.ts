import { formatRateText } from "@/lib/stats-utils";

export interface TrendItem {
  date: string;
  count: number;
}

export interface DistributionItem {
  category: string;
  count: number;
}

export interface CompareItem {
  key: string;
  total: number;
  submitted: number;
}

/** 与 /api/manage/stats/class-trends 的响应对齐（时间 × 班级交叉维度） */
export interface ClassTrendSeries {
  keys: string[];
  points: { date: string; counts: Record<string, number> }[];
}

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

/** 分班多序列：recharts 要求每个分组是数据项的顶层数值字段，故把 counts 摊平。
    班级名是用户输入，counts 里若真有名为 date 的键会覆盖 X 轴的日期字段，故 date 写在最后 */
export function buildClassSeries(points: ClassTrendSeries["points"]) {
  return points.map((p) => ({ ...p.counts, date: p.date }));
}
