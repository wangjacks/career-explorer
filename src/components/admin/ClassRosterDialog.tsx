"use client";

import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Loader2, Search, TriangleAlert, X } from "lucide-react";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  filterRosterStudents,
  maskStudentCode,
  type RosterStudent,
} from "@/lib/dashboard-utils";
import { formatRateText } from "@/lib/stats-utils";
import { formatSubmittedAt } from "@/lib/student-status";

type RosterFilter = "all" | "submitted" | "pending";

const FILTER_OPTIONS: { value: RosterFilter; label: string }[] = [
  { value: "all", label: "全部" },
  { value: "submitted", label: "已提交" },
  { value: "pending", label: "未提交" },
];

interface ClassRosterDialogProps {
  open: boolean;
  /** 统计分组键：班名或未分班哨兵 `__unassigned__`，服务端据此解析 class_id */
  classKey: string;
  /** 展示名（教师侧已把未分班哨兵换成「还没分班」） */
  displayName: string;
  onClose: () => void;
}

/**
 * 班级名册弹窗（#217）：dialog 语义 + Escape 关闭 + Tab 焦点捕获/关闭后还原。
 * 桌面居中 70vh，窄屏退化为全屏抽屉；表头固定、列表内滚动。
 */
export default function ClassRosterDialog({ open, classKey, displayName, onClose }: ClassRosterDialogProps) {
  const titleId = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  const [students, setStudents] = useState<RosterStudent[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [failed, setFailed] = useState(false);
  const [filter, setFilter] = useState<RosterFilter>("all");
  const [query, setQuery] = useState("");
  const [reloadKey, setReloadKey] = useState(0);

  /* eslint-disable react-hooks/set-state-in-effect -- 打开/重试时重置并拉取名册 */
  useEffect(() => {
    if (!open || !classKey) return;
    const controller = new AbortController();
    setStudents(null);
    setLoading(true);
    setFailed(false);
    setFilter("all");
    setQuery("");

    fetch(`/api/manage/stats/class-roster?class=${encodeURIComponent(classKey)}`, {
      signal: controller.signal,
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: { students?: RosterStudent[] }) => {
        if (!controller.signal.aborted) setStudents(data.students ?? []);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Class roster load error:", err);
        setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [open, classKey, reloadKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 焦点捕获、背景滚动锁与关闭后的焦点还原；与 ConfirmDialog 的弹窗范式一致。
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

  const counts = useMemo(() => {
    const list = students ?? [];
    const submitted = list.filter((student) => student.submitted).length;
    return { all: list.length, submitted, pending: list.length - submitted };
  }, [students]);

  const filtered = useMemo(
    () => filterRosterStudents(students ?? [], filter, query),
    [students, filter, query]
  );

  if (!open) return null;

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
        className="flex h-full w-full flex-col overflow-hidden bg-card shadow-xl outline-none sm:h-auto sm:max-h-[70vh] sm:max-w-2xl sm:rounded-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="shrink-0 border-b border-border-soft px-5 py-4">
          <div className="flex items-start gap-3">
            <div className="min-w-0 flex-1">
              <h2 id={titleId} className="truncate text-base font-semibold text-foreground">
                {displayName || "班级名册"}
              </h2>
              <p className="mt-0.5 text-xs text-muted">
                {loading
                  ? "正在加载名册…"
                  : failed
                    ? "名册加载失败"
                    : counts.all === 0
                      ? "该班还没有在册学生"
                      : `已提交 ${counts.submitted} / ${counts.all}（${formatRateText(counts.submitted, counts.all, 0)}）`}
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭名册"
              className="rounded-lg p-1.5 text-muted transition-colors hover:bg-gray-100 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring dark:hover:bg-gray-800"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <div role="group" aria-label="名册提交状态筛选" className="inline-flex items-center gap-0.5 self-start rounded-lg bg-gray-100 p-0.5 dark:bg-gray-800">
              {FILTER_OPTIONS.map((option) => {
                const active = option.value === filter;
                const count = counts[option.value];
                return (
                  <button
                    key={option.value}
                    type="button"
                    aria-pressed={active}
                    onClick={() => setFilter(option.value)}
                    className={`rounded-md px-2.5 py-1 text-xs font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring ${
                      active
                        ? "bg-primary text-white shadow-sm"
                        : "text-gray-600 hover:text-foreground dark:text-gray-300"
                    }`}
                  >
                    {option.label}
                    <span className="ml-1 font-mono tabular-nums opacity-70">{count}</span>
                  </button>
                );
              })}
            </div>

            <label className="relative block w-full sm:w-56">
              <span className="sr-only">按姓名或学号搜索</span>
              <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted/60" />
              <input
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索姓名或学号"
                className="w-full rounded-lg border border-border-soft bg-background py-1.5 pl-8 pr-3 text-xs text-foreground placeholder:text-muted/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              />
            </label>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-auto" aria-busy={loading}>
          {loading ? (
            <div role="status" className="flex flex-col items-center justify-center gap-2 py-16 text-center">
              <Loader2 className="h-5 w-5 animate-spin text-muted/60" />
              <p className="text-xs text-muted/70">正在加载名册…</p>
            </div>
          ) : failed ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <TriangleAlert className="h-6 w-6 text-danger/70" strokeWidth={1.5} />
              <p className="text-sm text-muted">名册加载失败</p>
              <p className="max-w-xs text-xs text-muted/70">请检查网络后重试，或先关闭弹窗继续查看其他班级。</p>
              <button
                type="button"
                onClick={() => setReloadKey((key) => key + 1)}
                className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                重试
              </button>
            </div>
          ) : filtered.length === 0 ? (
            <div className="flex flex-col items-center justify-center gap-2 px-6 py-16 text-center">
              <p className="text-sm text-muted">
                {students && students.length > 0 ? "没有匹配的学生" : "该班还没有在册学生"}
              </p>
              <p className="max-w-xs text-xs text-muted/70">
                {students && students.length > 0
                  ? "换个关键字，或清除筛选后再看。"
                  : "先在「学生管理」中导入名单，名册会自动出现。"}
              </p>
              {students && students.length > 0 && (
                <button
                  type="button"
                  onClick={() => {
                    setFilter("all");
                    setQuery("");
                  }}
                  className="mt-1 text-xs font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  清除筛选
                </button>
              )}
            </div>
          ) : (
            <table className="w-full text-left text-xs">
              <thead className="sticky top-0 z-10 bg-card text-muted">
                <tr className="border-b border-border-soft">
                  <th scope="col" className="px-5 py-2 font-medium">姓名</th>
                  <th scope="col" className="px-3 py-2 font-medium">学号</th>
                  <th scope="col" className="px-3 py-2 font-medium">状态</th>
                  <th scope="col" className="px-3 py-2 font-medium">提交时间</th>
                  <th scope="col" className="hidden px-5 py-2 text-right font-medium sm:table-cell">标签数</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((student) => (
                  <tr
                    key={student.userCode}
                    className={`border-b border-border-soft/60 last:border-0 ${
                      student.submitted ? "" : "bg-gray-50/70 text-muted dark:bg-gray-900/30"
                    }`}
                  >
                    <td className="px-5 py-2.5 font-medium text-foreground">{student.name}</td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums" title="学号已脱敏">
                      {maskStudentCode(student.userCode)}
                    </td>
                    <td className="px-3 py-2.5">
                      {student.submitted ? (
                        <span className="inline-flex items-center rounded-full bg-emerald-50 px-2 py-0.5 text-[11px] font-medium text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300">
                          已提交
                        </span>
                      ) : (
                        <span className="inline-flex items-center rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-medium text-red-600 dark:bg-red-900/30 dark:text-red-300">
                          未提交
                        </span>
                      )}
                    </td>
                    <td className="whitespace-nowrap px-3 py-2.5 font-mono tabular-nums text-muted">
                      {formatSubmittedAt(student.submittedAt) || "—"}
                    </td>
                    <td className="hidden px-5 py-2.5 text-right font-mono tabular-nums text-muted sm:table-cell">
                      {student.tagCount}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <footer className="shrink-0 border-t border-border-soft px-5 py-2.5 text-[11px] text-muted">
          投屏展示时请勿打开个人名单；学号已脱敏。
        </footer>
      </div>
    </div>
  );
}
