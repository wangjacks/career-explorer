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

/** 班级提交列表行（#217）：在 compare 上补提交率与未提交数 */
export interface ClassSubmissionRow extends CompareItem {
  unsubmitted: number;
  rate: number;
  rateText: string;
}

/** 班级名册学生（#217）：服务端返回的只读明细 */
export interface RosterStudent {
  name: string;
  userCode: string;
  submitted: boolean;
  submittedAt: string | null;
  tagCount: number;
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

/**
 * 班级提交列表（#217）：按提交率升序——交得最少的班排最前；
 * 「未分班」固定置末；同率按班名稳定排序。
 */
export function buildClassSubmissionRows(compare: CompareItem[]): ClassSubmissionRow[] {
  const rateOf = (item: CompareItem) => (item.total > 0 ? item.submitted / item.total : 0);
  return [...compare]
    .sort((a, b) => {
      const aUnassigned = a.key === "未分班";
      const bUnassigned = b.key === "未分班";
      if (aUnassigned !== bUnassigned) return aUnassigned ? 1 : -1;
      const diff = rateOf(a) - rateOf(b);
      return diff !== 0 ? diff : a.key.localeCompare(b.key, "zh-CN");
    })
    .map((item) => ({
      ...item,
      unsubmitted: Math.max(0, item.total - item.submitted),
      rate: rateOf(item),
      rateText: formatRateText(item.submitted, item.total, 1),
    }));
}

/** 学号脱敏：12 位保留首 4 末 4；其它长度也至少遮住中间，避免原样泄露 */
export function maskStudentCode(code: string): string {
  const value = String(code ?? "");
  if (value.length <= 4) return "****";
  if (value.length <= 8) return `${value.slice(0, 1)}****${value.slice(-1)}`;
  return `${value.slice(0, 4)}****${value.slice(-4)}`;
}

/** 名册筛选：状态 + 姓名/完整学号关键字（展示层再脱敏） */
export function filterRosterStudents(
  students: RosterStudent[],
  filter: "all" | "submitted" | "pending",
  query: string
): RosterStudent[] {
  const q = query.trim().toLowerCase();
  return students.filter((student) => {
    if (filter === "submitted" && !student.submitted) return false;
    if (filter === "pending" && student.submitted) return false;
    if (!q) return true;
    return (
      student.name.toLowerCase().includes(q) ||
      student.userCode.toLowerCase().includes(q)
    );
  });
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
