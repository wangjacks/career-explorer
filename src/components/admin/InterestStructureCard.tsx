"use client";

import { useMemo } from "react";
import { Pie, PieChart, Cell } from "recharts";
import { PieChart as PieChartIcon, ArrowRight } from "lucide-react";
import { TEACHER_BOARD_COPY } from "@/lib/dashboard-copy";
import {
  buildInterestStructure,
  interestCodeLabel,
  type InterestStatsView,
  type RosterRequest,
  type SectionState,
} from "@/lib/teacher-board";

/**
 * 兴趣结构卡（#315）：六型首位计数的环图 + 恒六行图例 + Top-6 三字码组合。
 *
 * - 数据来自 `/api/manage/stats/assessment`（#229/#311）：切「某班」时在前端按 `byClass` 过滤，
 *   **不重发聚合请求**；`全部班级` 用接口合计。
 * - 一人只按三字码首位计一次，不重算分数（与学生端归型一致）。
 * - 字母只作角标，中文名始终并排；三字码胶囊带中文展开（`SIA（社会型 · 研究型 · 艺术型）`）。
 */
export default function InterestStructureCard({
  stats,
  state,
  selectedClassId,
  selectedClassName,
  canDrilldown,
  onOpenRoster,
  onOpenHelp,
  onRetry,
}: {
  stats: InterestStatsView | null;
  state: SectionState;
  selectedClassId: number | null;
  selectedClassName: string;
  /** 「所有班级」下教师只能看合计；三字码胶囊随个人下钻一起禁用 */
  canDrilldown: boolean;
  onOpenRoster: (request: RosterRequest) => void;
  onOpenHelp: () => void;
  onRetry: () => void;
}) {
  const copy = TEACHER_BOARD_COPY;
  const view = useMemo(() => buildInterestStructure(stats, selectedClassId), [stats, selectedClassId]);
  const codeChips = view.codes;
  const hasData = state === "ready" && view.assessed > 0;
  const scaleLabel = stats?.scaleName ?? copy.scaleLabels.riasec;

  const openCodeRoster = (code: string) => {
    onOpenRoster({
      classId: selectedClassId,
      className: selectedClassName,
      scale: stats?.scaleCode ?? "riasec",
      scaleLabel,
      status: "done",
      code,
    });
  };

  return (
    <section
      aria-labelledby="teacher-board-interest-title"
      className="flex h-full flex-col rounded-xl border border-border-soft bg-card p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 id="teacher-board-interest-title" className="flex items-center gap-1.5 text-sm font-semibold text-foreground">
            <PieChartIcon className="h-4 w-4 text-primary" aria-hidden />
            {copy.interestTitle}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">{copy.interestNote}</p>
        </div>
        <button
          type="button"
          onClick={onOpenHelp}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {copy.interestHelpLabel}
          <ArrowRight className="h-3 w-3" aria-hidden />
        </button>
      </header>

      {state === "loading" && (
        <p className="flex flex-1 items-center justify-center py-10 text-sm text-muted" aria-busy="true">
          {copy.pageLoading}
        </p>
      )}

      {state === "failed" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-2 py-10 text-center">
          <p className="text-sm text-muted">{copy.interestFailedTitle}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {copy.retryButton}
          </button>
        </div>
      )}

      {state === "disabled" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{copy.structureDisabledTitle}</p>
          <p className="text-xs text-muted">{copy.structureDisabledHint}</p>
        </div>
      )}

      {state === "empty" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{copy.interestEmptyTitle}</p>
          <p className="max-w-xs text-xs text-muted">{copy.interestEmptyHint}</p>
        </div>
      )}

      {hasData && (
        <div className="mt-3 flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col items-center gap-4 sm:flex-row">
            <div className="relative h-40 w-40 flex-shrink-0">
              {/* 固定 160×160：父容器尺寸恒定，不用 ResponsiveContainer（#322 起弃用） */}
              <PieChart width={160} height={160}>
                <Pie
                  data={view.slices.filter((slice) => slice.count > 0)}
                  dataKey="count"
                  nameKey="label"
                  innerRadius={52}
                  outerRadius={78}
                  strokeWidth={0}
                  isAnimationActive={false}
                >
                  {view.slices
                    .filter((slice) => slice.count > 0)
                    .map((slice) => (
                      <Cell key={slice.key} fill={slice.color} />
                    ))}
                </Pie>
              </PieChart>
              <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center">
                <span className="text-2xl font-extrabold leading-none text-foreground">{view.assessed}</span>
                <span className="mt-1 text-[11px] text-muted">{copy.interestCenterLabel}</span>
              </div>
            </div>

            <ul className="grid min-w-0 flex-1 grid-cols-2 gap-x-3 gap-y-1.5 text-xs" aria-label={copy.interestTitle}>
              {view.slices.map((slice) => (
                <li
                  key={slice.key}
                  className="flex items-center gap-1.5"
                  aria-label={copy.interestLegendAria(slice.label, slice.key, slice.count)}
                >
                  <span className="h-2.5 w-2.5 flex-shrink-0 rounded-[3px]" style={{ backgroundColor: slice.color }} aria-hidden />
                  <span className="min-w-0 truncate text-foreground">{slice.label}</span>
                  <span className="flex-shrink-0 rounded bg-gray-100 px-1 font-mono text-[10px] text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    {slice.key}
                  </span>
                  <span className="ml-auto flex-shrink-0 font-mono tabular-nums text-muted">{slice.count}</span>
                </li>
              ))}
            </ul>
          </div>

          {view.sampleTooSmall && <p className="text-[11px] text-amber-700 dark:text-amber-300">{copy.interestSampleHint}</p>}

          <div className="border-t border-border-soft pt-3">
            <div className="flex items-baseline justify-between gap-2">
              <p className="text-xs font-semibold text-foreground">{copy.interestCodeTitle}</p>
              <p className="text-[11px] text-muted">{copy.interestCodeHint}</p>
            </div>
            {codeChips.length > 0 ? (
              <>
                <ul className="mt-2 flex flex-wrap gap-1.5">
                  {codeChips.map((chip) => {
                    const labels = interestCodeLabel(chip.code);
                    const content = (
                      <>
                        <span className="font-mono font-semibold">{copy.interestCodeLabel(chip.code, labels)}</span>
                        <span className="font-mono tabular-nums text-muted">{chip.count}</span>
                      </>
                    );
                    return (
                      <li key={chip.code}>
                        {canDrilldown ? (
                          <button
                            type="button"
                            onClick={() => openCodeRoster(chip.code)}
                            aria-label={copy.interestCodeAria(chip.code, labels, chip.count)}
                            className="inline-flex items-center gap-1 rounded-full border border-border-soft px-2.5 py-1 text-[11px] text-foreground transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                          >
                            {content}
                          </button>
                        ) : (
                          <span className="inline-flex items-center gap-1 rounded-full border border-border-soft px-2.5 py-1 text-[11px] text-foreground">
                            {content}
                          </span>
                        )}
                      </li>
                    );
                  })}
                </ul>
                {!canDrilldown && <p className="mt-1.5 text-[11px] text-muted">{copy.interestCodeRestrictedHint}</p>}
              </>
            ) : (
              <p className="mt-2 text-[11px] text-muted">{copy.interestCodeAllOnlyHint}</p>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
