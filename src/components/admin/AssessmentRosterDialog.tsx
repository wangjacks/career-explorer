"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, Search, TriangleAlert, X } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { ASSESSMENT_DASHBOARD_COPY } from "@/lib/dashboard-copy";
import {
  drilldownCounts,
  drilldownQuery,
  filterRosterItems,
  typeColorOf,
  type AssessmentDrilldownTarget,
  type AssessmentRosterItem,
} from "@/lib/assessment-dashboard";
import type { AssessmentStats } from "@/lib/assessment-stats";
import { maskStudentCode } from "@/lib/dashboard-utils";
import { formatSubmittedAt } from "@/lib/student-status";

type Scope = "all" | "mine";

interface AssessmentRosterDialogProps {
  open: boolean;
  scope: Scope;
  target: AssessmentDrilldownTarget | null;
  /** 聚合统计（取「已测 N / M」的分母与人数，与栏内数字同源） */
  stats: AssessmentStats | null;
  onClose: () => void;
}

/** 弹窗标题与二级筛选可用性都由「点的是哪类元素」决定 */
function titleOf(target: AssessmentDrilldownTarget | null): string {
  const copy = ASSESSMENT_DASHBOARD_COPY;
  if (!target) return copy.title;
  if (target.kind === "class") return copy.drilldownTitleClass(target.name);
  if (target.kind === "lead") return copy.drilldownTitleType(target.label);
  return copy.drilldownTitleCode(target.code);
}

/**
 * 测评明细下钻弹窗（#232）：与班级名册弹窗同一套弹窗范式——
 * `dialog` 语义 + Escape 关闭 + Tab 焦点捕获 + 关闭后焦点还原；窄屏全屏抽屉、桌面居中 85vh。
 *
 * 数据走 `/api/manage/assessment/roster`（唯一含姓名学号的端点，服务端每次读取都记审计，教师恒收窄到本人班级）；
 * 学号在这里再脱敏一次：列上永远只显示首 4 末 4。
 */
export default function AssessmentRosterDialog({ open, scope, target, stats, onClose }: AssessmentRosterDialogProps) {
  const copy = ASSESSMENT_DASHBOARD_COPY;
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<AssessmentRosterItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  /** 二级筛选：只看某一型（类型 / 班级下钻可用；三字码下钻已经锁死了型，故隐藏） */
  const [lead, setLead] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);

  const counts = useMemo(
    () => (target && stats ? drilldownCounts(target, stats) : { assessed: 0, total: 0 }),
    [target, stats]
  );
  const typeFilterVisible = target !== null && target.kind !== "code";
  const typeOptions = useMemo(() => {
    if (!stats) return [];
    return stats.types.map((item) => ({ value: item.key, label: item.label }));
  }, [stats]);

  /* eslint-disable react-hooks/set-state-in-effect -- 打开 / 换目标 / 重试时重新取数 */
  useEffect(() => {
    if (!open || !target) return;
    const controller = new AbortController();
    const params = new URLSearchParams({ scope });
    const queryParams = drilldownQuery(target);
    if (queryParams.classId !== undefined) params.set("classId", String(queryParams.classId));
    if (queryParams.lead) params.set("lead", queryParams.lead);
    if (queryParams.code) params.set("code", queryParams.code);
    // 二级筛选（只看某一型）在服务端也过滤一次：明细越小，投屏与传输越安全
    if (typeFilterVisible && lead) params.set("lead", lead);

    setRows(null);
    setLoading(true);
    setFailed(false);

    fetch(`/api/manage/assessment/roster?${params.toString()}`, { signal: controller.signal })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { data?: AssessmentRosterItem[] }) => {
        if (!controller.signal.aborted) setRows(data.data ?? []);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Assessment roster load error:", err);
        setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [open, target, scope, lead, typeFilterVisible, reloadKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 每次打开 / 换目标时重置筛选，避免带着上一轮的关键字看下一批人
  /* eslint-disable react-hooks/set-state-in-effect -- 目标变化即重置筛选条件 */
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setLead(null);
  }, [open, target]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 焦点捕获、背景滚动锁与关闭后的焦点还原（与班级名册弹窗一致）
  useEffect(() => {
    if (!open) return;
    const prevActive = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    panelRef.current?.focus();

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key !== "Tab" || !panelRef.current) return;
      const focusables = panelRef.current.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      );
      if (focusables.length === 0) return;
      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      prevActive?.focus?.();
    };
  }, [open]);

  useEscapeKey(open, onClose);

  const filtered = useMemo(() => filterRosterItems(rows ?? [], { query, lead }), [rows, query, lead]);

  if (!open || !target) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden bg-card shadow-xl outline-none sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-border-soft px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base font-semibold text-foreground">
                {titleOf(target)}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {loading ? copy.drilldownLoading : failed ? copy.drilldownFailedTitle : copy.drilldownSummary(counts.assessed, counts.total)}
              </p>
              {/* 投屏提醒常驻（不随加载态消失） */}
              <p className="mt-1 text-[11px] text-muted/70">{copy.drilldownHint}</p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={copy.drilldownCloseLabel}
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring dark:hover:bg-gray-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            {typeFilterVisible ? (
              <div
                role="group"
                aria-label={copy.drilldownTypeFilterAriaLabel}
                className="inline-flex flex-wrap items-center gap-0.5 self-start rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800"
              >
                <button
                  type="button"
                  aria-pressed={lead === null}
                  onClick={() => setLead(null)}
                  className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                    lead === null ? "bg-primary text-white shadow-sm" : "text-gray-600 hover:text-foreground dark:text-gray-300"
                  }`}
                >
                  {copy.drilldownAllTypesLabel}
                </button>
                {typeOptions.map((option) => {
                  const active = lead === option.value;
                  return (
                    <button
                      key={option.value}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setLead(option.value)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                        active ? "bg-primary text-white shadow-sm" : "text-gray-600 hover:text-foreground dark:text-gray-300"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="text-[11px] text-muted/70">{copy.drilldownColumnCode}</span>
            )}

            <label className="relative block w-full sm:w-56">
              <span className="sr-only">{copy.drilldownSearchPlaceholder}</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted/60" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder={copy.drilldownSearchPlaceholder}
                className="w-full rounded-lg border border-border-soft bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              />
            </label>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
          {loading ? (
            <div role="status" className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted/60" />
              <p className="text-xs text-muted/70">{copy.drilldownLoading}</p>
            </div>
          ) : failed ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <TriangleAlert className="h-6 w-6 text-danger/70" strokeWidth={1.5} />
              <p className="text-sm text-muted">{copy.drilldownFailedTitle}</p>
              <p className="max-w-xs text-xs text-muted/70">{copy.drilldownFailedHint}</p>
              <button
                type="button"
                onClick={() => setReloadKey((key) => key + 1)}
                className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                {copy.retryLabel}
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <p className="text-sm text-muted">{copy.drilldownEmptyTitle}</p>
              <p className="max-w-xs text-xs text-muted/70">{copy.drilldownEmptyHint}</p>
              {rows && rows.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setQuery("");
                    setLead(null);
                  }}
                  className="mt-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  {copy.drilldownFilteredEmptyLabel}
                </button>
              )}
            </div>
          ) : (
            <table className="w-full border-collapse text-left text-xs">
              <thead className="sticky top-0 z-10 bg-card text-muted">
                <tr className="border-b border-border-soft">
                  <th scope="col" className="px-5 py-2 font-medium">{copy.drilldownColumnName}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{copy.drilldownColumnUserCode}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{copy.drilldownColumnCode}</th>
                  <th scope="col" className="px-3 py-2 font-medium">{copy.drilldownColumnTime}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((item) => {
                  const color = typeColorOf(item.code);
                  return (
                    <tr key={`${item.userCode}-${item.code}`} className="border-b border-border-soft/60 last:border-0">
                      <td className="px-5 py-2.5 font-medium text-foreground">{item.name}</td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums" title={copy.userCodeMaskedTooltip}>
                        {maskStudentCode(item.userCode)}
                      </td>
                      <td className="px-3 py-2.5">
                        <span
                          className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide"
                          style={{ backgroundColor: color.chipBg, color: color.chipFg }}
                        >
                          {item.code}
                        </span>
                      </td>
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-muted">
                        {formatSubmittedAt(item.assessedAt) || "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </div>

        <footer className="shrink-0 border-t border-border-soft px-5 py-2.5 text-[11px] text-muted">
          {copy.drilldownHint}
        </footer>
      </div>
    </div>
  );
}
