import Link from "next/link";
import { ListChecks, Play, Timer } from "lucide-react";
import SectionCard from "./SectionCard";
import type { AssessmentListRow } from "@/lib/assessment-center";

const QUIZ_HREF = "/dashboard/student/assessment/quiz";

const STATUS_META = {
  "not-started": { text: "未开始", className: "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300" },
  "in-progress": {
    text: "进行中",
    className: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
  },
  completed: { text: "已完成", className: "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400" },
} as const;

/**
 * 测验列表卡（#225）：一行一套量表，给出题量、预计耗时与本人在此量表上的状态。
 *
 * 当前只有 RIASEC 一套（列表 1 行），结构按多量表设计——将来接口返回多套时，
 * 这里只是多渲染几行，不需要改组件（列表数据由 `buildAssessmentList` 归一）。
 */
export default function AssessmentListCard({ rows }: { rows: AssessmentListRow[] }) {
  return (
    <SectionCard title="测评清单" icon={ListChecks} subtitle="完成任一测评后，结果都会出现在「我的档案」的测评区。">
      <ul className="space-y-2">
        {rows.map((row) => {
          const status = STATUS_META[row.status];
          return (
            <li
              key={row.code}
              className="flex flex-col gap-2 rounded-lg border border-border-soft bg-background px-3 py-3 sm:flex-row sm:items-center"
            >
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-sm font-medium text-foreground">{row.name}</p>
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${status.className}`}>{status.text}</span>
                  {!row.enabled && (
                    <span className="px-2 py-0.5 rounded-full text-xs bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                      当前未开放
                    </span>
                  )}
                </div>
                <p className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted">
                  <span className="inline-flex items-center gap-1">
                    <ListChecks size={13} aria-hidden />
                    {row.questionCount > 0 ? `${row.questionCount} 题` : "题库准备中"}
                  </span>
                  {row.estimatedMinutes > 0 && (
                    <span className="inline-flex items-center gap-1">
                      <Timer size={13} aria-hidden />
                      约 {row.estimatedMinutes} 分钟
                    </span>
                  )}
                </p>
              </div>
              {row.canStart && row.isPrimary ? (
                <Link
                  href={QUIZ_HREF}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors sm:flex-shrink-0"
                >
                  <Play size={14} aria-hidden />
                  {row.status === "completed" ? "再测一次" : "去作答"}
                </Link>
              ) : (
                <span className="text-xs text-muted sm:flex-shrink-0">即将开放</span>
              )}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-muted/80 leading-relaxed">更多测评量表正在准备中。</p>
    </SectionCard>
  );
}
