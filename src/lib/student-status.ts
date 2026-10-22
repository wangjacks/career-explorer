/**
 * 学生提交状态（#170）：面板展示与筛选共用同一判定口径。
 *
 * 说明：`users.submitted_at` 由档案提交时写入（NULL = 未提交）；
 * 库内为 TEXT，格式 `YYYY-MM-DD HH:mm:ss`（见 docs/architecture.md）。
 */

export type SubmissionFilter = "all" | "submitted" | "pending";

export interface SubmissionCounts {
  total: number;
  submitted: number;
  pending: number;
}

/** 是否已提交（空串/空白视为未提交，避免脏数据被误判为已提交） */
export function isSubmitted(submittedAt: string | null | undefined): boolean {
  return typeof submittedAt === "string" && submittedAt.trim().length > 0;
}

/** 提交状态筛选：all 全通过；submitted 仅已提交；pending 仅未提交 */
export function matchesSubmissionFilter(
  submittedAt: string | null | undefined,
  filter: SubmissionFilter
): boolean {
  if (filter === "all") return true;
  return filter === "submitted" ? isSubmitted(submittedAt) : !isSubmitted(submittedAt);
}

/** 统计（用于筛选条上的计数展示，便于催交时看到「未提交 N 名」） */
export function countSubmissions(students: { submitted_at: string | null }[]): SubmissionCounts {
  let submitted = 0;
  for (const student of students) {
    if (isSubmitted(student.submitted_at)) submitted += 1;
  }
  return { total: students.length, submitted, pending: students.length - submitted };
}

/** 提交时间展示：统一压成 `YYYY-MM-DD HH:mm`；未提交返回空串 */
export function formatSubmittedAt(value: string | null | undefined): string {
  if (!isSubmitted(value)) return "";
  return String(value).trim().replace("T", " ").slice(0, 16);
}
