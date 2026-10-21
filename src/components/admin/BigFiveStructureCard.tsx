"use client";

import { Fingerprint, ArrowRight } from "lucide-react";
import { BIG_FIVE_BAND_CLASSES } from "@/lib/assessment-colors";
import { TEACHER_BOARD_COPY } from "@/lib/dashboard-copy";
import { bigFiveTeacherLabel } from "@/lib/teacher-board-content";
import {
  BIG_FIVE_SCALE_CODE,
  buildBigFiveTeacherRows,
  type BigFiveStatsView,
  type RosterRequest,
  type SectionState,
} from "@/lib/teacher-board";

const BAND_ORDER = ["low", "medium", "high"] as const;

/**
 * 人格轮廓卡（#315）：N/E/O/A/C 五行，每行低 / 中 / 高三段单一靛蓝族堆叠条 + 三档人数。
 *
 * - 行顺序恒为接口下发的量表定义顺序（**不按分值排序**），避免教师误以为「排第一的是好的」；
 * - 只出三档人数，不出平均分 / 排名 / 逐人分数 / 分档下钻；`invalidCount` 单独说明「不计入分布」；
 * - `N` 面向教师显示「情绪敏感度（神经质 N）」（内容层映射），其余保留量表中文名 + 字母角标；
 * - `enabled: false` 显示「未开放」而不是 0%。
 */
export default function BigFiveStructureCard({
  stats,
  state,
  selectedClassId,
  selectedClassName,
  canDrilldown,
  onOpenRoster,
  onOpenHelp,
  onRetry,
}: {
  stats: BigFiveStatsView | null;
  state: SectionState;
  selectedClassId: number | null;
  selectedClassName: string;
  canDrilldown: boolean;
  onOpenRoster: (request: RosterRequest) => void;
  onOpenHelp: () => void;
  onRetry: () => void;
}) {
  const copy = TEACHER_BOARD_COPY;
  const rows = stats ? buildBigFiveTeacherRows(stats, bigFiveTeacherLabel) : [];
  const scaleLabel = stats?.scaleName || copy.scaleLabels[BIG_FIVE_SCALE_CODE] || BIG_FIVE_SCALE_CODE;
  const hasData = state === "ready" && rows.length > 0 && stats !== null;
  const assessed = stats?.total.assessed ?? 0;
  const invalidCount = stats?.total.invalidCount ?? 0;

  const openRoster = () => {
    onOpenRoster({
      classId: selectedClassId,
      className: selectedClassName,
      scale: stats?.scaleCode ?? BIG_FIVE_SCALE_CODE,
      scaleLabel,
      status: "done",
    });
  };

  return (
    <section
      aria-labelledby="teacher-board-big-five-title"
      className="flex h-full flex-col rounded-xl border border-border-soft bg-card p-5"
    >
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <h2
            id="teacher-board-big-five-title"
            className="flex items-center gap-1.5 text-sm font-semibold text-foreground"
          >
            <Fingerprint className="h-4 w-4 text-primary" aria-hidden />
            {copy.bigFiveTitle}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">{copy.bigFiveNote}</p>
        </div>
        <button
          type="button"
          onClick={onOpenHelp}
          className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
        >
          {copy.bigFiveHelpLabel}
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
          <p className="text-sm text-muted">{copy.bigFiveFailedTitle}</p>
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
          <p className="text-sm font-medium text-foreground">{copy.bigFiveDisabledTitle}</p>
          <p className="max-w-xs text-xs text-muted">{copy.bigFiveDisabledHint}</p>
        </div>
      )}

      {state === "empty" && (
        <div className="flex flex-1 flex-col items-center justify-center gap-1 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{copy.bigFiveEmptyTitle}</p>
          <p className="max-w-xs text-xs text-muted">{copy.bigFiveEmptyHint}</p>
        </div>
      )}

      {hasData && stats && (
        <div className="mt-3 flex min-w-0 flex-1 flex-col gap-3">
          <ul className="flex flex-wrap items-center justify-end gap-3 text-[11px] text-muted">
            {BAND_ORDER.map((band) => (
              <li key={band} className="flex items-center gap-1">
                <span className={`h-2.5 w-2.5 rounded-[3px] ${BIG_FIVE_BAND_CLASSES[band]}`} aria-hidden />
                {band === "low" ? copy.bigFiveLegendLow : band === "medium" ? copy.bigFiveLegendMedium : copy.bigFiveLegendHigh}
              </li>
            ))}
          </ul>

          <ul className="space-y-3">
            {rows.map((row) => (
              <li
                key={row.key}
                className="space-y-1"
                aria-label={copy.bigFiveRowAria(row.teacherLabel, row.low, row.medium, row.high)}
              >
                <div className="flex items-baseline gap-1.5">
                  <span className="truncate text-xs font-medium text-foreground">{row.teacherLabel}</span>
                </div>
                <div className="flex h-2.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800" aria-hidden>
                  {BAND_ORDER.map((band) => {
                    const count = row[band];
                    if (count <= 0) return null;
                    return (
                      <span key={band} className={BIG_FIVE_BAND_CLASSES[band]} style={{ width: `${row.percents[band]}%` }} />
                    );
                  })}
                </div>
                <p className="text-[11px] tabular-nums text-muted">
                  {copy.bigFiveCountLabel(row.low, row.medium, row.high)}
                </p>
              </li>
            ))}
          </ul>

          {invalidCount > 0 && <p className="text-[11px] text-amber-700 dark:text-amber-300">{copy.bigFiveInvalidNote(invalidCount)}</p>}

          <div className="mt-auto flex items-center justify-between gap-2 border-t border-border-soft pt-3">
            {canDrilldown && assessed > 0 && (
              <button
                type="button"
                onClick={openRoster}
                aria-label={copy.bigFiveRosterAria(assessed)}
                className="inline-flex flex-shrink-0 items-center gap-1 rounded-lg px-2 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {copy.bigFiveRosterButton(assessed)}
                <ArrowRight className="h-3 w-3" aria-hidden />
              </button>
            )}
          </div>
        </div>
      )}
    </section>
  );
}
