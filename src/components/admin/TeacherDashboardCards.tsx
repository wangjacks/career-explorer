"use client";

import { useMemo, useState } from "react";
import { Compass, School } from "lucide-react";
import { ChartEmpty, ChartFailed } from "@/components/admin/DashboardKit";
import ClassRosterDialog from "@/components/admin/ClassRosterDialog";
import { TEACHER_DASHBOARD_COPY } from "@/lib/dashboard-copy";
import {
  buildClassSubmissionRows,
  type CompareItem,
} from "@/lib/dashboard-utils";

/**
 * 各班提交精简列表（#217）：替代教师端的提交趋势图。
 * 数据复用 /api/manage/stats/compare；按提交率升序，未分班置末。
 */
export function ClassSubmissionCard({
  compare,
  compareFailed,
}: {
  compare: CompareItem[];
  compareFailed: boolean;
}) {
  const [openClass, setOpenClass] = useState<string | null>(null);
  const rows = useMemo(() => buildClassSubmissionRows(compare), [compare]);

  return (
    <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-7">
      <div className="mb-4 flex items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium tracking-[0.2em] text-muted">各班提交</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">班级提交情况</h3>
          <p className="mt-0.5 text-[11px] text-muted/70">
            按提交率升序，交得最少的班在前；未分班置末
          </p>
        </div>
        {rows.length > 0 && (
          <span className="shrink-0 font-mono text-[11px] tabular-nums text-muted/70">
            {rows.length} 个班
          </span>
        )}
      </div>

      {/* 与趋势卡不同：这里没有会影响口径的控件，重取失败时保留屏上旧数据仍然成立；
          失败态只兜「从未取到数据」，顶部横幅负责说明失败。 */}
      {rows.length > 0 ? (
        <>
          <ul className="max-h-[280px] space-y-1 overflow-y-auto pr-1">
            {rows.map((row) => {
              // 排序与接口仍认原值；「未分班」只在展示层换成教师口语
              const label = TEACHER_DASHBOARD_COPY.classLabel(row.key);
              return (
                <li
                  key={row.key}
                  className="rounded-lg px-2 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/50"
                >
                  <div className="flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-baseline gap-2">
                        <span
                          className="truncate text-sm font-medium text-foreground"
                          title={label}
                        >
                          {label}
                        </span>
                        <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted">
                          {row.submitted}/{row.total}
                        </span>
                        <span className="w-12 shrink-0 text-right font-mono text-xs font-medium tabular-nums text-foreground">
                          {row.rateText}
                        </span>
                      </div>
                      <div
                        role="img"
                        aria-label={`${label}提交率 ${row.rateText}`}
                        className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                      >
                        <div
                          className="h-full rounded-full bg-primary"
                          style={{ width: `${row.rate * 100}%` }}
                        />
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => setOpenClass(row.key)}
                      aria-label={`查看${label}名册`}
                      className="shrink-0 rounded-lg border border-border-soft px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                    >
                      具体查看
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          <p className="mt-3 border-t border-border-soft pt-3 text-[11px] text-muted/70">
            提交率 = 已提交 / 在册，与上方全校总览同源。
          </p>
        </>
      ) : compareFailed ? (
        <ChartFailed height={240} copy={TEACHER_DASHBOARD_COPY} />
      ) : (
        <ChartEmpty
          height={240}
          icon={<School className="h-6 w-6" strokeWidth={1.5} />}
          title="还没有在册学生"
          hint="先在「学生管理」中导入学生名单，这里会按班列出提交进度。"
        />
      )}

      <ClassRosterDialog
        open={openClass !== null}
        classKey={openClass ?? ""}
        displayName={openClass ? TEACHER_DASHBOARD_COPY.classLabel(openClass) : ""}
        onClose={() => setOpenClass(null)}
      />
    </div>
  );
}

/** 职业兴趣测评占位卡（#217）：全宽腾位，具体看板另立 issue */
export function AssessmentPlaceholderCard() {
  return (
    <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-12">
      <div className="mb-3">
        <p className="text-[11px] font-medium tracking-[0.2em] text-muted">测评看板</p>
        <h3 className="mt-1 text-sm font-semibold text-foreground">职业兴趣测评</h3>
      </div>
      <div className="flex min-h-[180px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-soft bg-gray-50/50 px-6 py-8 text-center dark:bg-gray-900/20">
        <Compass className="h-8 w-8 text-muted/40" strokeWidth={1.5} />
        <p className="text-sm font-medium text-foreground">测评数据即将接入</p>
        <p className="max-w-md text-xs text-muted">
          接入后这里会显示各班完成度与 RIASEC 六型分布，先完成本学期的档案收集即可。
        </p>
      </div>
    </div>
  );
}
