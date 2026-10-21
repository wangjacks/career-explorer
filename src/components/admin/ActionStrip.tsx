"use client";

import { useMemo } from "react";
import { ClipboardCopy, ListChecks } from "lucide-react";
import { TEACHER_BOARD_COPY } from "@/lib/dashboard-copy";
import { buildReminderText, type ActionTarget } from "@/lib/teacher-board";

/**
 * 行动条（#314）：只针对允许下钻的班级，优先级是完成率最低的那套量表。
 *
 * 文案分两半：哪些班「还没开始」+「还有 N 人没交」；全部完成时给正向文案。
 * 「复制提醒话术」的字符串由 `buildReminderText` 生成，**不含任何学生姓名**；
 * 剪贴板失败由页面用 toast 兜底（组件只负责触发）。
 */
export default function ActionStrip({
  target,
  onSeeMissing,
  onCopyReminder,
}: {
  target: ActionTarget | null;
  onSeeMissing: (target: ActionTarget) => void;
  onCopyReminder: (text: string) => void;
}) {
  const copy = TEACHER_BOARD_COPY;
  const reminder = useMemo(
    () =>
      target
        ? buildReminderText(
            target.missingClasses.slice(0, 3).map((item) => item.name),
            target.scaleLabel,
            target.missingCount
          )
        : "",
    [target]
  );

  if (!target) return null;

  const allDone = target.missingCount === 0;
  return (
    <section
      aria-labelledby="teacher-board-action-title"
      className="flex flex-wrap items-center gap-x-4 gap-y-3 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 dark:border-amber-800/60 dark:bg-amber-900/20"
    >
      <div className="flex min-w-0 flex-1 items-start gap-2.5">
        <span className="mt-0.5 flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-amber-100 text-amber-700 dark:bg-amber-900/40 dark:text-amber-300">
          <ListChecks className="h-3.5 w-3.5" aria-hidden />
        </span>
        <div className="min-w-0">
          <h2 id="teacher-board-action-title" className="text-xs font-semibold text-amber-800 dark:text-amber-200">
            {copy.actionTitle}
          </h2>
          {allDone ? (
            <p className="mt-0.5 text-sm text-amber-800 dark:text-amber-200">{copy.actionAllDone}</p>
          ) : (
            <p className="mt-0.5 text-sm text-amber-900/90 dark:text-amber-100/90">
              {[
                target.notStarted.length > 0 ? copy.actionNotStarted(target.notStarted.join("、")) : "",
                copy.actionMissing(target.scaleLabel, target.missingCount),
                copy.actionHint,
              ]
                .filter(Boolean)
                .join("；")}
            </p>
          )}
        </div>
      </div>

      {!allDone && (
        <div className="flex flex-shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => onSeeMissing(target)}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {copy.actionSeeMissing}
          </button>
          <button
            type="button"
            onClick={() => onCopyReminder(reminder)}
            className="inline-flex items-center gap-1 rounded-lg border border-amber-300 bg-white px-3 py-1.5 text-xs font-medium text-amber-800 transition-colors hover:bg-amber-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring dark:border-amber-700 dark:bg-transparent dark:text-amber-200 dark:hover:bg-amber-900/30"
          >
            <ClipboardCopy className="h-3.5 w-3.5" aria-hidden />
            {copy.actionCopyReminder}
          </button>
        </div>
      )}
    </section>
  );
}
