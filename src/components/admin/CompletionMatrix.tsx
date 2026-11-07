"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { TEACHER_BOARD_COPY } from "@/lib/dashboard-copy";
import {
  PROFILE_COLUMN_KEY,
  buildInterestCompositionBar,
  cellOf,
  formatRate,
  interestColumn,
  lowestScaleColumnForRow,
  scaleColumns,
  scaleLabelOf,
  type CompletionColumnView,
  type CompletionRowView,
  type CompletionStatsView,
  type RosterRequest,
  type SectionState,
} from "@/lib/teacher-board";
import type { AssessmentClassTypeComposition } from "@/lib/assessment-stats";

/** 矩阵里一行：普通班或「还没分班」汇总行（后者不可下钻） */
interface MatrixRow {
  classId: number;
  name: string;
  enrolled: number;
  canDrilldown: boolean;
  cells: CompletionRowView["cells"];
}

/**
 * 班级完成矩阵（#314）：真 `<table>`，一行一个班、列由启用量表驱动。
 *
 * - 单元格是 button（量表列）：点击打开该班该量表的**已完成名册**；
 * - `操作` 列的「看未完成」按该行完成率最低的量表打开 `status=missing` 名册；
 * - 「兴趣构成」列画六色堆叠条（一人只按三字码首位计一次）；
 * - `enrolled = 0` 的空班不渲染；「还没分班」置末且不可下钻；切「所有班级」时后端 `canDrilldown=false`。
 */
export default function CompletionMatrix({
  completion,
  state,
  interestByClass,
  interestState,
  onRetry,
  onOpenRoster,
}: {
  completion: CompletionStatsView | null;
  state: SectionState;
  interestByClass: readonly AssessmentClassTypeComposition[];
  interestState: SectionState;
  onRetry: () => void;
  onOpenRoster: (request: RosterRequest) => void;
}) {
  const copy = TEACHER_BOARD_COPY;
  const columns = useMemo(() => completion?.columns ?? [], [completion]);
  const scales = useMemo(() => scaleColumns(columns), [columns]);
  const profileColumn = columns.find((column) => column.key === PROFILE_COLUMN_KEY) ?? null;
  const compositionColumn = interestColumn(columns);
  const rows: MatrixRow[] = useMemo(() => {
    if (!completion) return [];
    const list: MatrixRow[] = completion.rows.map((row) => ({ ...row }));
    if (completion.unassigned) {
      list.push({
        classId: 0,
        name: completion.unassigned.name,
        enrolled: completion.unassigned.enrolled,
        canDrilldown: false,
        cells: completion.unassigned.cells,
      });
    }
    return list;
  }, [completion]);

  return (
    <section aria-labelledby="teacher-board-matrix-title" className="rounded-xl border border-border-soft bg-card">
      <div className="flex flex-wrap items-start justify-between gap-2 border-b border-border-soft px-5 py-4">
        <div>
          <h2 id="teacher-board-matrix-title" className="text-sm font-semibold text-foreground">
            {copy.matrixTitle}
          </h2>
          <p className="mt-0.5 text-[11px] text-muted">{copy.matrixNote}</p>
        </div>
        <span className="rounded-full bg-gray-100 px-2.5 py-1 text-[11px] text-muted dark:bg-gray-800">
          {copy.matrixEnrolledNote}
        </span>
      </div>

      {state === "loading" && (
        <div className="flex items-center gap-2 px-5 py-10 text-sm text-muted" aria-busy="true">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden />
          {copy.pageLoading}
        </div>
      )}

      {state === "failed" && (
        <div className="space-y-2 px-5 py-8">
          <p className="text-sm font-medium text-foreground">{copy.matrixFailedTitle}</p>
          <p className="text-xs text-muted">{copy.matrixFailedHint}</p>
          <button
            type="button"
            onClick={onRetry}
            className="rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {copy.retryButton}
          </button>
        </div>
      )}

      {state === "empty" && (
        <div className="space-y-1 px-5 py-10 text-center">
          <p className="text-sm font-medium text-foreground">{copy.matrixEmptyTitle}</p>
          <p className="text-xs text-muted">{copy.matrixEmptyHint}</p>
        </div>
      )}

      {state === "ready" && completion && rows.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="text-left text-[11px] text-muted">
                <th scope="col" className="px-4 py-2 font-medium">
                  {copy.matrixColumnClass}
                </th>
                {profileColumn && (
                  <th scope="col" className="px-3 py-2 font-medium">
                    {copy.matrixColumnProfile}
                  </th>
                )}
                {scales.map((column) => (
                  <th key={column.key} scope="col" className="px-3 py-2 font-medium">
                    {scaleLabelOf(
                      column.key.startsWith("assessment:")
                        ? column.key.slice("assessment:".length)
                        : null,
                      column.label,
                      copy.scaleLabels
                    )}
                  </th>
                ))}
                {compositionColumn && (
                  <th scope="col" className="px-3 py-2 font-medium">
                    {copy.matrixColumnComposition}
                  </th>
                )}
                <th scope="col" className="px-3 py-2 font-medium">
                  {copy.matrixColumnActions}
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.classId === 0 ? "unassigned" : row.classId} className="border-t border-border-soft">
                  <th scope="row" className="px-4 py-3 text-left font-normal">
                    <span className="block truncate text-sm font-medium text-foreground">{row.name}</span>
                    <span className="block text-[11px] text-muted">
                      {copy.matrixEnrolledSub(row.enrolled)}
                    </span>
                  </th>
                  {profileColumn && (
                    <td className="px-3 py-3">
                      <span
                        className="block space-y-1"
                        aria-label={copy.matrixProfileCellLabel(
                          row.name,
                          cellOf(row, profileColumn.key).done,
                          row.enrolled
                        )}
                      >
                        <CellNumbers done={cellOf(row, profileColumn.key).done} enrolled={row.enrolled} rate={cellOf(row, profileColumn.key).rate} />
                      </span>
                    </td>
                  )}
                  {scales.map((column) => (
                    <td key={column.key} className="px-3 py-3">
                      <ScaleCell
                        row={row}
                        column={column}
                        onOpenRoster={onOpenRoster}
                      />
                    </td>
                  ))}
                  {compositionColumn && (
                    <td className="px-3 py-3">
                      <CompositionCell
                        classId={row.classId === 0 ? null : row.classId}
                        byClass={interestByClass}
                        loading={interestState === "loading"}
                        failed={interestState === "failed"}
                      />
                    </td>
                  )}
                  <td className="px-3 py-3">
                    <MissingAction row={row} scales={scales} copyScaleLabels={copy.scaleLabels} onOpenRoster={onOpenRoster} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {rows.some((row) => row.classId !== 0 && !row.canDrilldown) && (
            <p className="border-t border-border-soft px-5 py-2 text-[11px] text-muted">
              {copy.matrixNoDrilldownHint}
            </p>
          )}
        </div>
      )}
    </section>
  );

  /**
   * 一格完成度（档案列与量表列共用）：`n/m · 比例` + 细进度条。
   * 未开始时不显示 0.0%，而是给「还没开始」的行动邀请。
   */
  function CellNumbers({ done, enrolled, rate }: { done: number; enrolled: number; rate: number }) {
    if (done === 0) {
      return <span className="text-xs text-muted">{copy.matrixCellEmpty}</span>;
    }
    return (
      <span className="block">
        <span className="flex items-baseline gap-1.5">
          <span className="font-mono text-sm tabular-nums text-foreground">
            {done}/
            {enrolled}
          </span>
          <span className="font-mono text-[11px] tabular-nums text-muted">
            {copy.matrixCellRate(formatRate(rate))}
          </span>
        </span>
        <span className="mt-1 block h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          <span className="block h-full rounded-full bg-primary" style={{ width: `${Math.max(2, rate)}%` }} />
        </span>
      </span>
    );
  }

  /** 量表单元格：有当前结果的班可点开「已完成名册」，没有权限时禁用（切「所有班级」）。 */
  function ScaleCell({
    row,
    column,
    onOpenRoster,
  }: {
    row: MatrixRow;
    column: CompletionColumnView;
    onOpenRoster: (request: RosterRequest) => void;
  }) {
    const cell = cellOf(row, column.key);
    const code = column.key.slice("assessment:".length);
    const label = scaleLabelOf(code, column.label, copy.scaleLabels);
    const disabled = !row.canDrilldown;
    const content = (
      <CellNumbers done={cell.done} enrolled={row.enrolled} rate={cell.rate} />
    );
    if (disabled) {
      return (
        <span title={copy.matrixNoDrilldownHint} aria-label={copy.matrixNoDrilldownHint}>
          {content}
        </span>
      );
    }
    return (
      <button
        type="button"
        onClick={() =>
          onOpenRoster({
            classId: row.classId,
            className: row.name,
            scale: code,
            scaleLabel: label,
            status: "done",
          })
        }
        aria-label={copy.matrixScaleCellAria(row.name, label, cell.done, row.enrolled)}
        className="w-full rounded-lg px-2 py-1 text-left transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {content}
      </button>
    );
  }

  /** 「看未完成」：按该行完成率最低的启用量表打开没交名单。 */
  function MissingAction({
    row,
    scales,
    copyScaleLabels,
    onOpenRoster,
  }: {
    row: MatrixRow;
    scales: readonly CompletionColumnView[];
    copyScaleLabels: Readonly<Record<string, string>>;
    onOpenRoster: (request: RosterRequest) => void;
  }) {
    const column = lowestScaleColumnForRow(row, scales);
    if (!column || !row.canDrilldown) {
      return <span className="text-xs text-muted">—</span>;
    }
    const code = column.key.slice("assessment:".length);
    const label = scaleLabelOf(code, column.label, copyScaleLabels);
    const missing = Math.max(0, row.enrolled - cellOf(row, column.key).done);
    if (missing === 0) {
      return <span className="text-xs text-muted">—</span>;
    }
    return (
      <button
        type="button"
        onClick={() =>
          onOpenRoster({
            classId: row.classId,
            className: row.name,
            scale: code,
            scaleLabel: label,
            status: "missing",
          })
        }
        aria-label={copy.matrixMissingAria(row.name, label, missing)}
        className="whitespace-nowrap rounded-lg border border-border-soft px-2.5 py-1 text-[11px] font-medium text-primary transition-colors hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
      >
        {copy.matrixMissingAction}
      </button>
    );
  }

  /** 兴趣构成：六色堆叠条 + 文字摘要（不靠颜色单独传达）。 */
  function CompositionCell({
    classId,
    byClass,
    loading,
    failed,
  }: {
    classId: number | null;
    byClass: readonly AssessmentClassTypeComposition[];
    loading: boolean;
    failed: boolean;
  }) {
    if (loading) return <span className="text-xs text-muted">…</span>;
    if (failed) return <span className="text-xs text-muted">—</span>;
    const composition = buildInterestCompositionBar(byClass, classId);
    if (composition.assessed === 0) {
      return <span className="text-xs text-muted">{copy.matrixCompositionEmpty}</span>;
    }
    const detail = composition.segments
      .map((segment) => copy.matrixCompositionSegmentAria(segment.label, segment.count))
      .join(" · ");
    return (
      <span
        className="block space-y-1"
        title={copy.matrixCompositionTooltip}
        aria-label={copy.matrixCompositionSummary(composition.assessed, detail)}
      >
        <span className="flex h-2 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
          {composition.segments.map((segment) => (
            <span
              key={segment.key}
              style={{ width: `${segment.percent}%`, backgroundColor: segment.color }}
              aria-hidden
            />
          ))}
        </span>
        <span className="block truncate text-[11px] text-muted">
          {copy.matrixCompositionSummary(composition.assessed, detail)}
        </span>
      </span>
    );
  }
}
