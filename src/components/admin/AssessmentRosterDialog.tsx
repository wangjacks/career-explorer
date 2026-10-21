"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, Search, TriangleAlert, X } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { ASSESSMENT_DASHBOARD_COPY, TEACHER_BOARD_COPY } from "@/lib/dashboard-copy";
import { typeColorOf } from "@/lib/assessment-colors";
import { maskStudentCode } from "@/lib/dashboard-utils";
import { describeTypeCode } from "@/lib/assessment-view";
import { formatSubmittedAt } from "@/lib/student-status";
import type { RosterRequest, RosterScaleOption } from "@/lib/teacher-board";

/** 名册行（服务端 `/api/manage/assessment/roster` 已按 scale × status 分流） */
interface RosterRow {
  name: string;
  userCode: string;
  /** 按「所有班级」取名册时用来显示班级列 */
  className?: string;
  /** 兴趣型量表：三字码（脏数据缺码给空串） */
  code?: string;
  /** 人格型量表：五项档位（不出分数） */
  bands?: { key: string; label: string; band: string }[];
  assessedAt?: string;
}

interface RosterPayload {
  data?: unknown;
}

/** 防御式解析：缺字段的行直接丢弃，界面不出现 undefined / NaN */
function normalizeRows(payload: unknown): RosterRow[] {
  if (payload === null || typeof payload !== "object") return [];
  const raw = (payload as RosterPayload).data;
  if (!Array.isArray(raw)) return [];
  const rows: RosterRow[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const name = typeof record.name === "string" ? record.name : "";
    const userCode = typeof record.userCode === "string" ? record.userCode : "";
    if (name === "" || userCode === "") continue;
    const row: RosterRow = { name, userCode };
    if (typeof record.className === "string") row.className = record.className;
    if (typeof record.code === "string") row.code = record.code;
    if (typeof record.assessedAt === "string") row.assessedAt = record.assessedAt;
    if (Array.isArray(record.bands)) {
      row.bands = record.bands
        .map((band) =>
          band !== null && typeof band === "object" ? (band as Record<string, unknown>) : null
        )
        .filter((band): band is Record<string, unknown> => band !== null)
        .map((band) => ({
          key: typeof band.key === "string" ? band.key : "",
          label: typeof band.label === "string" ? band.label : "",
          band: typeof band.band === "string" ? band.band : "",
        }))
        .filter((band) => band.key !== "");
    }
    rows.push(row);
  }
  return rows;
}

/**
 * 测评名册弹窗（#229 / #313 / #314）：班级完成矩阵与行动条的唯一**个人明细**入口。
 *
 * - 按「一套量表 × 完成状态」取数：`status=done` 是已完成名册、`status=missing` 是没交名单；
 *   服务端每次读取都记审计，教师恒收窄到本人归属班级。
 * - 多套量表用 Tab 切换；人格型量表只显示五项档位，不出现分数。
 * - 学号在这里再脱敏一次：列上永远只显示首 4 末 4。
 * - 投屏提醒常驻标题下与页脚，不随加载态消失。
 */
export default function AssessmentRosterDialog({
  open,
  request,
  scales,
  onClose,
}: {
  open: boolean;
  request: RosterRequest | null;
  scales: readonly RosterScaleOption[];
  onClose: () => void;
}) {
  const copy = ASSESSMENT_DASHBOARD_COPY;
  const board = TEACHER_BOARD_COPY;
  const titleId = useId();
  const hintId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [rows, setRows] = useState<RosterRow[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [query, setQuery] = useState("");
  const [activeScale, setActiveScale] = useState<string>("");
  const [reloadKey, setReloadKey] = useState(0);

  // 打开 / 换目标时把量表 Tab 重置到目标那套（避免带着上一次的量表看下一批人）
  /* eslint-disable react-hooks/set-state-in-effect -- 目标变化即重置量表 Tab 与搜索词 */
  useEffect(() => {
    if (!open || !request) return;
    setActiveScale(request.scale);
    setQuery("");
  }, [open, request]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect -- 打开 / 切量表 / 重试时重新取数 */
  useEffect(() => {
    if (!open || !request) return;
    const scale = activeScale === "" ? request.scale : activeScale;
    const controller = new AbortController();
    const params = new URLSearchParams({ scale, status: request.status });
    if (request.classId !== null) params.set("classId", String(request.classId));
    // 三字码过滤（#315）：兴趣结构的 Top-6 胶囊下钻，与 lead 一样只对「兴趣型 + 已完成」成立
    if (typeof request.code === "string" && request.code !== "") params.set("code", request.code);

    setRows(null);
    setLoading(true);
    setFailed(false);

    fetch(`/api/manage/assessment/roster?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: RosterPayload) => {
        if (!controller.signal.aborted) setRows(normalizeRows(data));
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
  }, [open, request, activeScale, reloadKey]);
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

  const filtered = useMemo(() => {
    const list = rows ?? [];
    const keyword = query.trim().toLowerCase();
    if (keyword === "") return list;
    return list.filter(
      (row) =>
        row.name.toLowerCase().includes(keyword) || row.userCode.toLowerCase().includes(keyword)
    );
  }, [rows, query]);

  if (!open || !request) return null;

  const activeLabel = scales.find((option) => option.code === activeScale)?.label ?? request.scaleLabel;
  const status = request.status;
  const allClasses = request.classId === null;
  const codeLabels = typeof request.code === "string" ? describeTypeCode(request.code) : "";
  const title =
    typeof request.code === "string" && request.code !== ""
      ? request.className !== ""
        ? board.rosterTitleCodeClass(request.className, request.code, codeLabels)
        : board.rosterTitleCode(request.code, codeLabels)
      : allClasses
        ? status === "missing"
          ? board.rosterTitleAllMissing(activeLabel)
          : board.rosterTitleAllDone(activeLabel)
        : status === "missing"
          ? board.rosterTitleMissing(request.className, activeLabel)
          : board.rosterTitleDone(request.className, activeLabel);

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
        aria-describedby={hintId}
        tabIndex={-1}
        className="flex h-full w-full flex-col overflow-hidden bg-card shadow-xl outline-none sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="shrink-0 border-b border-border-soft px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base font-semibold text-foreground">
                {title}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {loading
                  ? copy.drilldownLoading
                  : failed
                    ? copy.drilldownFailedTitle
                    : status === "missing"
                      ? board.rosterMissingHint
                      : board.rosterCountLabel(rows?.length ?? 0)}
              </p>
              {/* 投屏提醒常驻（不随加载态消失） */}
              <p id={hintId} className="mt-1 text-[11px] text-muted/70">
                {copy.drilldownHint}
              </p>
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
            {scales.length > 1 ? (
              <div
                role="group"
                aria-label={board.rosterScaleTabsAria}
                className="inline-flex flex-wrap items-center gap-0.5 self-start rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800"
              >
                {scales.map((option) => {
                  const active = option.code === activeScale;
                  return (
                    <button
                      key={option.code}
                      type="button"
                      aria-pressed={active}
                      onClick={() => setActiveScale(option.code)}
                      className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                        active
                          ? "bg-primary text-white shadow-sm"
                          : "text-gray-600 hover:text-foreground dark:text-gray-300"
                      }`}
                    >
                      {option.label}
                    </button>
                  );
                })}
              </div>
            ) : (
              <span className="inline-flex items-center self-start rounded-full bg-gray-100 px-2.5 py-1 text-[11px] font-medium text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                {activeLabel}
              </span>
            )}

            <label className="flex w-full items-center gap-2 rounded-lg border border-border-soft bg-background py-1.5 pl-2.5 pr-3 text-xs focus-within:ring-2 focus-within:ring-focus-ring sm:w-56">
              <Search aria-hidden="true" className="h-3.5 w-3.5 shrink-0 text-muted/60" />
              <input
                type="search"
                aria-label={copy.drilldownSearchPlaceholder}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={copy.drilldownSearchPlaceholder}
                className="min-w-0 flex-1 bg-transparent p-0 text-xs text-foreground outline-none placeholder:text-muted/60"
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
                  onClick={() => setQuery("")}
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
                  <th scope="col" className="px-5 py-2 font-medium">
                    {copy.drilldownColumnName}
                  </th>
                  {allClasses && (
                    <th scope="col" className="px-3 py-2 font-medium">
                      {board.rosterColumnClass}
                    </th>
                  )}
                  <th scope="col" className="px-3 py-2 font-medium">
                    {copy.drilldownColumnUserCode}
                  </th>
                  {status === "done" && (
                    <th scope="col" className="px-3 py-2 font-medium">
                      {hasBands(rows ?? []) ? board.rosterColumnBands : copy.drilldownColumnCode}
                    </th>
                  )}
                  {status === "done" && (
                    <th scope="col" className="px-3 py-2 font-medium">
                      {copy.drilldownColumnTime}
                    </th>
                  )}
                </tr>
              </thead>
              <tbody>
                {filtered.map((row) => (
                  <tr
                    key={`${row.userCode}-${row.className ?? ""}`}
                    className="border-b border-border-soft/60 last:border-0"
                  >
                    <td className="px-5 py-2.5 font-medium text-foreground">{row.name}</td>
                    {allClasses && (
                      <td className="px-3 py-2.5 text-muted">{row.className ?? "—"}</td>
                    )}
                    <td
                      className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums"
                      title={copy.userCodeMaskedTooltip}
                    >
                      {maskStudentCode(row.userCode)}
                    </td>
                    {status === "done" && (
                      <td className="px-3 py-2.5">
                        <BandOrCode row={row} />
                      </td>
                    )}
                    {status === "done" && (
                      <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-muted">
                        {formatSubmittedAt(row.assessedAt ?? "") || "—"}
                      </td>
                    )}
                  </tr>
                ))}
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

function hasBands(rows: readonly RosterRow[]): boolean {
  return rows.some((row) => Array.isArray(row.bands) && row.bands.length > 0);
}

/** 兴趣型量表显示三字码胶囊，人格型量表显示五项档位；两者都不出现分数。 */
function BandOrCode({ row }: { row: RosterRow }) {
  const board = TEACHER_BOARD_COPY;
  if (row.bands && row.bands.length > 0) {
    return (
      <span className="flex flex-wrap gap-1">
        {row.bands.map((band) => (
          <span
            key={band.key}
            className="inline-flex items-center gap-1 whitespace-nowrap rounded-full bg-gray-100 px-2 py-0.5 text-[11px] text-gray-700 dark:bg-gray-800 dark:text-gray-200"
          >
            {band.label} {board.rosterBandLabel(band.band)}
          </span>
        ))}
      </span>
    );
  }
  if (!row.code) return <span className="text-muted">—</span>;
  const color = typeColorOf(row.code);
  return (
    <span
      className="inline-flex items-center rounded-full px-2 py-0.5 font-mono text-[11px] font-semibold tracking-wide"
      style={{ backgroundColor: color.bar, color: color.chipFg }}
    >
      {row.code}
    </span>
  );
}
