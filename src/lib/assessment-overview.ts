/**
 * 数据概览的兴趣测评完成度视图模型（#230）：纯函数，供 `OverviewTab` / `ClassOverviewTable` 共用。
 *
 * 数据来自教师端聚合接口 `/api/manage/stats/assessment`（#229）。本文件只做三件事：
 * 1. **防御式解析**接口 JSON（脏数据/字段缺失一律当「没有测评数据」，绝不让页面出现 NaN）；
 * 2. 把「已完成 N 人 / 共 M 人应完成」的卡片口径固定下来；
 * 3. 把班级维度的两个单元格（兴趣测评数、交齐比例）映射成可渲染字符串。
 *
 * 卡片与列的标题在 #316 由「测评完成」统一改为「兴趣测评」，与数据大屏的量表口语名一致；
 * 这里的**口径不变**：只回答「做没做」，接口取的是兴趣量表（riasec）的完成数。
 *
 * 「概览只回答有没有做，图表一律在数据大屏」——这里刻意不提供分布/排行相关函数。
 */

/** 聚合接口里本页用到的字段（其余字段忽略） */
export interface AssessmentOverviewStats {
  classes: { classId: number; name: string; enrolled: number; assessed: number; rate: number }[];
  total: { enrolled: number; assessed: number; rate: number };
}

/** 统计卡内容：主数字 + 角标说明 */
export interface AssessmentCardView {
  value: number;
  sub: string;
}

export const ASSESSMENT_EMPTY_SUB = "学生还没开始测评";

function finiteNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function clampPercent(value: number | null): number {
  if (value === null) return 0;
  return Math.min(100, Math.max(0, value));
}

/** 缺 `rate` 时的兜底：与后端一致的 `assessed / enrolled`，分母为 0 记 0 */
function deriveRate(assessed: number, enrolled: number): number {
  if (enrolled <= 0) return 0;
  return (assessed / enrolled) * 100;
}

/**
 * 解析聚合接口返回：形状不对或关键字段缺失时返回 `null`（= 没有测评数据）。
 * 单个班级行脏（缺 classId / 非数字）只丢这一行，不牵连整份数据——概览页宁可少一行也不能白屏。
 */
export function normalizeAssessmentOverview(payload: unknown): AssessmentOverviewStats | null {
  if (payload === null || typeof payload !== "object") return null;
  const record = payload as { classes?: unknown; total?: unknown };
  const totalRecord = (record.total ?? null) as { enrolled?: unknown; assessed?: unknown; rate?: unknown } | null;
  const enrolled = finiteNumber(totalRecord?.enrolled);
  const assessed = finiteNumber(totalRecord?.assessed);
  if (enrolled === null || assessed === null) return null;

  const classes: AssessmentOverviewStats["classes"] = [];
  if (Array.isArray(record.classes)) {
    for (const raw of record.classes) {
      if (raw === null || typeof raw !== "object") continue;
      const row = raw as { classId?: unknown; name?: unknown; enrolled?: unknown; assessed?: unknown; rate?: unknown };
      const classId = finiteNumber(row.classId);
      const rowEnrolled = finiteNumber(row.enrolled);
      const rowAssessed = finiteNumber(row.assessed);
      if (classId === null || rowEnrolled === null || rowAssessed === null) continue;
      const enrolledCount = Math.max(0, rowEnrolled);
      const assessedCount = Math.min(enrolledCount, Math.max(0, rowAssessed));
      classes.push({
        classId,
        name: typeof row.name === "string" ? row.name : "",
        enrolled: enrolledCount,
        assessed: assessedCount,
        // 接口没给 rate（或给了非数字）时按同样的分母口径自己算，别把缺字段显示成 0%
        rate: clampPercent(finiteNumber(row.rate) ?? deriveRate(assessedCount, enrolledCount)),
      });
    }
  }

  const totalEnrolled = Math.max(0, enrolled);
  const totalAssessed = Math.min(totalEnrolled, Math.max(0, assessed));
  return {
    classes,
    total: {
      enrolled: totalEnrolled,
      assessed: totalAssessed,
      rate: clampPercent(finiteNumber(totalRecord?.rate) ?? deriveRate(totalAssessed, totalEnrolled)),
    },
  };
}

/**
 * 统计卡口径：主数字 = 已完成测评人数，角标 = `共 N 人应完成`。
 * 没有数据 / 还没人开始时显示 `0` + 「学生还没开始测评」（友好空态，不报错）。
 */
export function assessmentCompletionCard(stats: AssessmentOverviewStats | null): AssessmentCardView {
  if (!stats || stats.total.assessed <= 0) {
    return { value: 0, sub: ASSESSMENT_EMPTY_SUB };
  }
  return { value: stats.total.assessed, sub: `共 ${stats.total.enrolled} 人应完成` };
}

/** 百分比展示：取整（教师不需要两位小数）；空值/非数字显示 `-`，不出现 NaN */
export function formatPercent(value: number | null | undefined, digits = 0): string {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.min(100, Math.max(0, value)).toFixed(digits)}%`;
}

/** 单元格占位符：没有数据时表格显示 `-`（而不是 0，避免被误读成「已做但为 0」） */
export const CELL_PLACEHOLDER = "-";

/**
 * 班级行的两个测评单元格。按 `classId` 匹配（班级改名不影响）；未分班行、无数据、
 * 接口不可用一律 `-`——概览页不展示个人明细，也不替缺失数据编数字。
 *
 * 空班（`enrolled = 0`）的「交齐比例」显示 `-` 而不是 `0%`：同一行左侧「提交率」
 * 在零学生时本来就是 `-`，两列口径必须一致（0% 会被读成「有人但都没做」）。
 */
export function classAssessmentCells(
  stats: AssessmentOverviewStats | null,
  classId: number | null
): { assessed: string; rate: string } {
  if (!stats || classId === null) return { assessed: CELL_PLACEHOLDER, rate: CELL_PLACEHOLDER };
  const row = stats.classes.find((item) => item.classId === classId);
  if (!row) return { assessed: CELL_PLACEHOLDER, rate: CELL_PLACEHOLDER };
  return {
    assessed: String(row.assessed),
    rate: row.enrolled > 0 ? formatPercent(row.rate) : CELL_PLACEHOLDER,
  };
}

/** 合计行：用全校小结（含未分班学生），口径与「兴趣测评」卡一致；零学生时比例显示 `-` */
export function totalAssessmentCells(
  stats: AssessmentOverviewStats | null
): { assessed: string; rate: string } {
  if (!stats) return { assessed: CELL_PLACEHOLDER, rate: CELL_PLACEHOLDER };
  return {
    assessed: String(stats.total.assessed),
    rate: stats.total.enrolled > 0 ? formatPercent(stats.total.rate) : CELL_PLACEHOLDER,
  };
}
