"use client";

import { useEffect, useMemo, useState, type CSSProperties } from "react";
import { Compass, Loader2, TriangleAlert } from "lucide-react";
import { Segmented } from "@/components/admin/DashboardKit";
import AssessmentRosterDialog from "@/components/admin/AssessmentRosterDialog";
import { ASSESSMENT_DASHBOARD_COPY } from "@/lib/dashboard-copy";
import {
  buildCodeChips,
  buildTypeBars,
  resolveSectionState,
  sortClassesByNeed,
  type AssessmentDrilldownTarget,
} from "@/lib/assessment-dashboard";
import type { AssessmentStats } from "@/lib/assessment-stats";
import { formatRateText } from "@/lib/stats-utils";

type Scope = "all" | "mine";
type View = "progress" | "types" | "codes";

/** `/api/manage/stats/assessment` 的响应（`assessment.enabled` 是 #232 新增的增量字段） */
interface AssessmentStatsPayload extends AssessmentStats {
  scope: Scope;
  assessment?: { code?: string; name?: string; scaleVersion?: string; enabled?: boolean };
}

const SCOPE_OPTIONS: readonly { value: Scope; label: string }[] = [
  { value: "all", label: ASSESSMENT_DASHBOARD_COPY.scopeAllLabel },
  { value: "mine", label: ASSESSMENT_DASHBOARD_COPY.scopeMineLabel },
];

/**
 * 数据大屏「职业兴趣测评」栏（#232）：一栏三视图 + 点击下钻。
 *
 * - **概览与明细分两个端点**：概览用聚合接口（响应无个人标识、可投屏），点任意元素才去取名册（含姓名学号，
 *   服务端每次读取都记审计）；本组件自己不拼 SQL、不算口径，排序/配色/下钻参数都在
 *   `assessment-dashboard.ts` 纯函数里（有单测）。
 * - **三视图共用一份数据**：聚合接口一次返回班级完成度 / 六型计数 / 三字码排行，切换视图不再请求，
 *   所以「切换不影响其他栏」是天然的；切换「全校 / 只看我的班」才重取。
 * - **失败只坏这一栏**：本节自管 loading / failed / 空态，不把错误抛给同屏的其他图表。
 */
export default function TeacherAssessmentCard() {
  const copy = ASSESSMENT_DASHBOARD_COPY;
  const [scope, setScope] = useState<Scope>("all");
  const [view, setView] = useState<View>("progress");
  const [stats, setStats] = useState<AssessmentStats | null>(null);
  const [enabled, setEnabled] = useState(true);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  /** 类型分布：悬停 / 聚焦的那一型（读数固定显示在栏中心，不给每段挂 tooltip） */
  const [activeType, setActiveType] = useState<string | null>(null);
  const [target, setTarget] = useState<AssessmentDrilldownTarget | null>(null);

  /* eslint-disable react-hooks/set-state-in-effect -- 首屏与范围切换重取聚合数据 */
  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setFailed(false);
    setActiveType(null);

    fetch(`/api/manage/stats/assessment?scope=${scope}`, { signal: controller.signal })
      .then(async (res) => {
        // 量表未配置 → 按「还没开放」处理（邀请式空态），而不是失败态
        if (res.status === 404) return { unavailable: true } as const;
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as AssessmentStatsPayload;
        return { unavailable: false, data } as const;
      })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (result.unavailable) {
          setStats(null);
          setEnabled(false);
          return;
        }
        setStats({
          classes: result.data.classes ?? [],
          types: result.data.types ?? [],
          codes: result.data.codes ?? [],
          total: result.data.total ?? { enrolled: 0, assessed: 0, rate: 0, lastSubmittedAt: null },
        });
        setEnabled(result.data.assessment?.enabled !== false);
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Assessment stats load error:", err);
        setFailed(true);
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [scope, reloadKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sectionState = resolveSectionState({
    loading,
    failed,
    enabled,
    assessed: stats?.total.assessed ?? 0,
  });

  const classRows = useMemo(() => sortClassesByNeed(stats?.classes ?? []), [stats]);
  const typeBars = useMemo(() => buildTypeBars(stats?.types ?? []), [stats]);
  const codeChips = useMemo(() => buildCodeChips(stats?.codes ?? []), [stats]);

  const assessedTotal = stats?.total.assessed ?? 0;
  const activeBar = typeBars.find((bar) => bar.key === activeType) ?? null;

  const VIEW_OPTIONS: readonly { value: View; label: string }[] = [
    { value: "progress", label: copy.viewProgressLabel },
    { value: "types", label: copy.viewTypesLabel },
    { value: "codes", label: copy.viewCodesLabel },
  ];

  const retry = () => setReloadKey((key) => key + 1);

  return (
    <div className="rounded-xl border border-border-soft bg-card p-5 lg:col-span-12">
      <div className="mb-4 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-[11px] font-medium tracking-[0.2em] text-muted">{copy.eyebrow}</p>
          <h3 className="mt-1 text-sm font-semibold text-foreground">{copy.title}</h3>
          <p className="mt-0.5 text-[11px] text-muted/70">{copy.subtitle}</p>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <Segmented options={SCOPE_OPTIONS} value={scope} onChange={setScope} label={copy.scopeAriaLabel} />
        </div>
      </div>

      <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <Segmented options={VIEW_OPTIONS} value={view} onChange={setView} label={copy.viewAriaLabel} />
        {stats && sectionState === "ready" && (
          <span className="text-[11px] text-muted/70">
            {copy.classCounts(assessedTotal, stats.total.enrolled)} · {formatRateText(assessedTotal, stats.total.enrolled, 0)}
          </span>
        )}
      </div>

      {sectionState === "loading" ? (
        <div
          role="status"
          className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-soft bg-gray-50/50 py-16 text-center dark:bg-gray-900/20"
        >
          <Loader2 className="h-5 w-5 animate-spin text-muted/60" />
          <p className="text-xs text-muted/70">{copy.loadingLabel}</p>
        </div>
      ) : sectionState === "failed" ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-soft bg-gray-50/50 py-14 text-center dark:bg-gray-900/20">
          <TriangleAlert className="h-6 w-6 text-danger/70" strokeWidth={1.5} />
          <p className="text-sm text-muted">{copy.failedTitle}</p>
          <p className="max-w-xs text-xs text-muted/70">{copy.failedHint}</p>
          <button
            type="button"
            onClick={retry}
            className="mt-1 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-white transition-colors hover:bg-primary-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {copy.retryLabel}
          </button>
        </div>
      ) : sectionState === "disabled" ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-soft bg-gray-50/50 py-14 text-center dark:bg-gray-900/20">
          <Compass className="h-7 w-7 text-muted/40" strokeWidth={1.5} />
          <p className="text-sm font-medium text-foreground">{copy.disabledTitle}</p>
          <p className="max-w-md text-xs text-muted">{copy.disabledHint}</p>
        </div>
      ) : sectionState === "empty" ? (
        <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-border-soft bg-gray-50/50 py-14 text-center dark:bg-gray-900/20">
          <Compass className="h-7 w-7 text-muted/40" strokeWidth={1.5} />
          <p className="text-sm font-medium text-foreground">{copy.emptyTitle}</p>
          <p className="max-w-md text-xs text-muted">{copy.emptyHint}</p>
        </div>
      ) : view === "progress" ? (
        <>
          <p className="mb-2 text-[11px] text-muted/70">{copy.progressNote}</p>
          <ul className="max-h-[320px] space-y-1 overflow-y-auto pr-1">
            {classRows.map((row) => {
              // 「未分班」是接口数据值，教师侧展示时换口语（比较与排序仍认原值）
              const label = row.isUnassigned ? copy.unassignedLabel : row.name;
              const content = (
                <>
                  <div className="flex items-baseline gap-2">
                    <span className="truncate text-sm font-medium text-foreground" title={label}>
                      {label}
                    </span>
                    <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted">
                      {copy.classCounts(row.assessed, row.enrolled)}
                    </span>
                    <span className="w-10 shrink-0 text-right font-mono text-xs font-medium tabular-nums text-foreground">
                      {formatRateText(row.assessed, row.enrolled, 0)}
                    </span>
                  </div>
                  <div
                    role="img"
                    aria-label={copy.classAriaLabel(label, row.assessed, row.enrolled)}
                    className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800"
                  >
                    <div className="h-full rounded-full bg-primary" style={{ width: `${row.rate}%` }} />
                  </div>
                </>
              );
              return (
                <li key={`${row.classId}-${row.name}`} className="rounded-lg">
                  {row.isUnassigned ? (
                    <div className="px-2 py-2 opacity-70" title={copy.unassignedHint}>
                      <div className="flex items-baseline gap-2">
                        <span className="truncate text-sm font-medium text-foreground">{label}</span>
                        <span className="ml-auto shrink-0 font-mono text-xs tabular-nums text-muted">
                          {copy.classCounts(row.assessed, row.enrolled)}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setTarget({ kind: "class", classId: row.classId, name: row.name })}
                      className="w-full rounded-lg px-2 py-2 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring dark:hover:bg-gray-800/50"
                    >
                      {content}
                    </button>
                  )}
                </li>
              );
            })}
          </ul>
        </>
      ) : view === "types" ? (
        <div onMouseLeave={() => setActiveType(null)}>
          <p className="mb-2 text-[11px] text-muted/70">{copy.typesNote}</p>
          {/* 读数固定在栏中心：不给每段挂 tooltip，鼠标在哪条就显示哪条的人数 */}
          <div className="mb-3 flex h-12 flex-col items-center justify-center text-center">
            <span className="font-mono text-2xl font-bold leading-none tabular-nums text-foreground">
              {activeBar ? activeBar.count : assessedTotal}
            </span>
            <span className="mt-1 text-[11px] text-muted">
              {activeBar ? activeBar.label : copy.typesCenterLabel}
            </span>
          </div>
          <ul className="space-y-2">
            {typeBars.map((bar) => (
              <li key={bar.key}>
                <button
                  type="button"
                  onClick={() => setTarget({ kind: "lead", lead: bar.key, label: bar.label })}
                  onMouseEnter={() => setActiveType(bar.key)}
                  onFocus={() => setActiveType(bar.key)}
                  onBlur={() => setActiveType(null)}
                  aria-label={copy.typeAriaLabel(bar.label, bar.count)}
                  className="flex w-full items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-gray-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring dark:hover:bg-gray-800/50"
                >
                  <span className="w-14 shrink-0 truncate text-xs font-medium text-foreground" title={bar.label}>
                    {bar.label}
                  </span>
                  <span className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                    {/* 深浅色各一档同色相填充（对比度见 assessment-dashboard.ts 的配色表与单测） */}
                    <span
                      className="block h-full rounded-full bg-[var(--assessment-bar)] transition-[width] duration-300 dark:bg-[var(--assessment-bar-dark)]"
                      style={
                        {
                          width: `${bar.percent}%`,
                          "--assessment-bar": bar.barLight,
                          "--assessment-bar-dark": bar.barDark,
                        } as CSSProperties
                      }
                    />
                  </span>
                  <span className="w-10 shrink-0 text-right font-mono text-xs tabular-nums text-muted">{bar.count}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <>
          <p className="mb-3 text-[11px] text-muted/70">{copy.codesNote}</p>
          <div className="flex flex-wrap gap-2">
            {codeChips.map((chip) => (
              <button
                key={chip.code}
                type="button"
                onClick={() => setTarget({ kind: "code", code: chip.code, lead: chip.lead })}
                aria-label={copy.codeAriaLabel(chip.code, chip.count)}
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-transform hover:scale-[1.03] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                style={{ backgroundColor: chip.chipBg, color: chip.chipFg }}
              >
                <span className="font-mono font-semibold tracking-wide">{chip.code}</span>
                <span className="opacity-80">{copy.codeCountLabel(chip.count)}</span>
              </button>
            ))}
          </div>
        </>
      )}

      <p className="mt-3 border-t border-border-soft pt-3 text-[11px] text-muted/70">{copy.footerNote}</p>

      <AssessmentRosterDialog
        open={target !== null}
        scope={scope}
        target={target}
        stats={stats}
        onClose={() => setTarget(null)}
      />
    </div>
  );
}
