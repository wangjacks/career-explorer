"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { TEACHER_BOARD_COPY } from "@/lib/dashboard-copy";
import {
  PROFILE_COLUMN_KEY,
  buildHeroRows,
  buildProgressGrid,
  formatRate,
  scaleLabelOf,
  type CompletionStatsView,
  
  type SectionState,
} from "@/lib/teacher-board";

const HERO_BG =
  "bg-[linear-gradient(135deg,#065f46_0%,#064e3b_100%)] dark:bg-[linear-gradient(135deg,#064e3b_0%,#04281f_100%)]";

/**
 * 测评看板 hero（#314）：全页唯一一块深绿面，**内部不放任何控件**（范围切换在页头）。
 *
 * 左侧是档案提交完成度（大数字 + 完成情况 + 没交人数），右侧是班级点阵与每班 n/m；
 * 下方按启用量表逐行给「中文短名 · 已测 n / 共 m 人 · 百分比」。
 * 点阵每格只有一个布尔位，**没有任何逐格学生身份**（`title` / `aria-label` 都不写第几个人）。
 */
export default function TeacherBoardHero({
  completion,
  state,
  onRetry,
}: {
  completion: CompletionStatsView | null;
  state: SectionState;
  onRetry: () => void;
}) {
  const copy = TEACHER_BOARD_COPY;
  const grid = useMemo(
    () => (completion ? buildProgressGrid(completion.rows, completion.unassigned) : null),
    [completion]
  );
  const rows = useMemo(
    () => (completion ? buildHeroRows(completion.columns, completion.total, copy.scaleLabels) : []),
    [completion, copy.scaleLabels]
  );
  const profileRow = rows.find((row) => row.key === PROFILE_COLUMN_KEY) ?? null;
  const scaleRows = rows.filter((row) => row.key !== PROFILE_COLUMN_KEY);

  return (
    <section aria-labelledby="teacher-board-hero-title" className={`rounded-2xl px-5 py-5 shadow-lg sm:px-6 ${HERO_BG}`}>
      <h2 id="teacher-board-hero-title" className="sr-only">
        {copy.heroScaleEyebrow}
      </h2>

      {state === "loading" && (
        <div className="flex items-center gap-2 py-8 text-emerald-50/80" aria-busy="true">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          <span className="text-sm">{copy.pageLoading}</span>
        </div>
      )}

      {state === "failed" && (
        <div className="space-y-3 py-4">
          <p className="text-sm font-semibold text-white">{copy.heroFailedTitle}</p>
          <p className="text-xs text-emerald-50/70">{copy.heroFailedHint}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-white/15 px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-white/25 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {copy.retryButton}
          </button>
        </div>
      )}

      {state !== "loading" && state !== "failed" && completion && (
        <>
          {completion.total.enrolled <= 0 ? (
            <p className="py-8 text-center text-sm text-emerald-50/80">{copy.heroNoStudents}</p>
          ) : (
            <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,300px)_1fr]">
              <div className="min-w-0">
                <p className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-[0.07em] text-emerald-50/80">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-300" aria-hidden />
                  {copy.heroProfileLabel}
                </p>
                {profileRow && (
                  <>
                    <p className="mt-2 flex items-baseline gap-1.5 text-white">
                      <span className="text-5xl font-extrabold leading-none tracking-tight">
                        {profileRow.done}
                      </span>
                      <span className="text-lg font-light text-emerald-50/40">/</span>
                      <span className="text-xl font-semibold text-emerald-50/75">{profileRow.enrolled}</span>
                    </p>
                    <p className="mt-2 flex items-baseline gap-2">
                      <span className="text-[15px] font-bold text-emerald-300">{formatRate(profileRow.rate)}</span>
                      <span className="text-[11px] text-emerald-50/60">{copy.heroRateLabel}</span>
                    </p>
                    <p className="mt-3 flex items-center gap-1.5 text-[11.5px] text-emerald-50/80">
                      <span className="h-1 w-1 rounded-full bg-amber-300" aria-hidden />
                      {profileRow.enrolled - profileRow.done > 0
                        ? copy.heroMissing(profileRow.enrolled - profileRow.done)
                        : copy.heroAllDone}
                    </p>
                  </>
                )}
              </div>

              <div className="min-w-0">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-emerald-50/60">{copy.heroGridCaption}</p>
                  <p className="flex items-center gap-3 text-[11px] text-emerald-50/60">
                    <span className="flex items-center gap-1">
                      <span
                        className="h-2.5 w-2.5 rounded-[2px] bg-[linear-gradient(180deg,#7ceec2_0%,#55d6a3_100%)]"
                        aria-hidden
                      />
                      {copy.heroGridLegendDone}
                    </span>
                    <span className="flex items-center gap-1">
                      <span
                        className="h-2.5 w-2.5 rounded-[2px] border border-[rgb(79,119,66)] dark:border-[rgba(167,243,208,0.55)]"
                        aria-hidden
                      />
                      {copy.heroGridLegendMissing}
                    </span>
                  </p>
                </div>

                {grid && (
                  <div className="mt-3">
                    {grid.mode === "ticks" ? (
                      <div
                        role="img"
                        aria-label={copy.heroGridAria(grid.assessed, grid.total)}
                        className="grid auto-rows-[26px] gap-[5px] max-[1280px]:auto-rows-[22px] max-[1280px]:gap-[4px]"
                        style={{ gridTemplateColumns: `repeat(${grid.columns}, minmax(0, 1fr))` }}
                      >
                        {grid.groups.flatMap((group) =>
                          group.ticks.map((filled, index) => (
                            <span
                              key={`${group.classId ?? "unassigned"}-${index}`}
                              aria-hidden="true"
                              className={`rounded-[2px] border border-[rgb(79,119,66)] dark:border-[rgba(167,243,208,0.55)] ${
                                filled ? "bg-[linear-gradient(180deg,#7ceec2_0%,#55d6a3_100%)]" : "bg-transparent"
                              }`}
                            />
                          ))
                        )}
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <div
                          role="img"
                          aria-label={copy.heroGridAria(grid.assessed, grid.total)}
                          className="h-6 overflow-hidden rounded-full bg-white/15"
                        >
                          <div
                            className="h-full rounded-full bg-[linear-gradient(180deg,#7ceec2_0%,#55d6a3_100%)]"
                            style={{ width: `${Math.min(100, Math.max(0, grid.rate))}%` }}
                          />
                        </div>
                        <p className="text-[11px] text-emerald-50/60">
                          {grid.assessed} / {grid.total} · {copy.heroGridOverflow}
                        </p>
                      </div>
                    )}

                    <ul className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11px] text-emerald-50/70">
                      {grid.groups.map((group) => (
                        <li key={group.classId ?? "unassigned"} className="flex items-center gap-1.5">
                          <span className="h-1 w-1 rounded-full bg-emerald-300/80" aria-hidden />
                          {copy.heroGridGroup(group.name, group.assessed, group.total)}
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>
          )}

          <div className="mt-5 border-t border-white/15 pt-4">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[11.5px] font-semibold uppercase tracking-[0.07em] text-emerald-50/80">
                {copy.heroScaleEyebrow}
              </p>
              <p className="text-[11px] text-emerald-50/50">{copy.heroScaleNote}</p>
            </div>
            {scaleRows.length === 0 ? (
              <p className="mt-2 text-xs text-emerald-50/60">{copy.heroScaleEmpty}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {scaleRows.map((row) => {
                  const color =
                    completion.columns.find((column) => column.key === row.key)?.scoringMode === "dimensional"
                      ? "#a5b4fc"
                      : "#6ee7b7";
                  return (
                    <li key={row.key} className="flex items-center gap-3 text-xs text-emerald-50/85">
                      <span className="w-24 flex-shrink-0 truncate font-medium text-white">
                        {scaleLabelOf(row.scaleCode, row.label, copy.scaleLabels)}
                      </span>
                      <span className="flex-shrink-0 font-mono tabular-nums text-emerald-50/80">
                        {row.done} / {row.enrolled}
                      </span>
                      <span className="flex-shrink-0 font-mono tabular-nums text-emerald-50/60">
                        {row.untouched ? copy.heroScaleEmpty : formatRate(row.rate)}
                      </span>
                      <span className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-white/15">
                        <span
                          className="block h-full rounded-full"
                          style={{ width: `${row.untouched ? 0 : Math.max(2, row.rate)}%`, backgroundColor: color }}
                        />
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  );
}
