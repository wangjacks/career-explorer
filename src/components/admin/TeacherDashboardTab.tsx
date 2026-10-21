"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { BookOpen, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useDashboardData } from "@/hooks/useDashboardData";
import { DistributionCard, Segmented } from "@/components/admin/DashboardKit";
import { TEACHER_BOARD_COPY, TEACHER_DASHBOARD_COPY } from "@/lib/dashboard-copy";
import TeacherBoardHero from "@/components/admin/TeacherBoardHero";
import CompletionMatrix from "@/components/admin/CompletionMatrix";
import ActionStrip from "@/components/admin/ActionStrip";
import AssessmentRosterDialog from "@/components/admin/AssessmentRosterDialog";
import InterestStructureCard from "@/components/admin/InterestStructureCard";
import BigFiveStructureCard from "@/components/admin/BigFiveStructureCard";
import BoardHelpDrawer, { type BoardHelpTab } from "@/components/admin/BoardHelpDrawer";
import {
  assessmentCodeOfColumn,
  buildStructureClassOptions,
  interestColumn,
  normalizeBigFiveStats,
  normalizeCompletionStats,
  normalizeInterestStats,
  pickActionTarget,
  scaleColumns,
  scaleLabelOf,
  type BigFiveStatsView,
  type CompletionScope,
  type CompletionStatsView,
  type InterestStatsView,
  type RosterRequest,
  type RosterScaleOption,
  type SectionState,
} from "@/lib/teacher-board";

const SCOPES: readonly { value: CompletionScope; labelKey: "scopeMineLabel" | "scopeAllLabel" }[] = [
  { value: "mine", labelKey: "scopeMineLabel" },
  { value: "all", labelKey: "scopeAllLabel" },
];

/**
 * 教师端「测评看板」（#314 + #315）：页头 + 唯一深绿 hero + 班级完成矩阵 + 两张结构卡 + 行动条。
 *
 * - 数据两段式：先取 `/api/manage/stats/completion`（hero / 矩阵 / 行动条只依赖它），
 *   返回后取兴趣聚合（矩阵构成列 + 兴趣结构卡共用）；人格分布单独按 `classId` 取（#315）；
 * - 结构卡共用页面级「看的班级」选择：兴趣卡在前端按 `byClass` 过滤（不重发请求），
 *   人格卡按 `classId` 重请求（接口没有逐班合计）；
 * - 三块各自独立 loading / failed / empty / ready，失败只坏自己并给「重试」；
 * - 范围是页面级单一 state（默认「我带的班」），切「所有班级」时后端把 `canDrilldown` 置 false，
 *   个人下钻按钮随之禁用（服务端仍独立判 403）；
 * - 说明抽屉是纯展示层：打开 / 关闭不改变数据范围，也不发请求。
 */
export default function TeacherDashboardTab() {
  const copy = TEACHER_BOARD_COPY;
  const scopeOptions = useMemo(
    () => SCOPES.map((item) => ({ value: item.value, label: copy[item.labelKey] })),
    [copy]
  );
  const [scope, setScope] = useState<CompletionScope>("mine");
  const [completion, setCompletion] = useState<CompletionStatsView | null>(null);
  const [completionState, setCompletionState] = useState<SectionState>("loading");
  const [interestStats, setInterestStats] = useState<InterestStatsView | null>(null);
  const [interestState, setInterestState] = useState<SectionState>("loading");
  const [bigFiveStats, setBigFiveStats] = useState<BigFiveStatsView | null>(null);
  const [bigFiveState, setBigFiveState] = useState<SectionState>("loading");
  /** 结构卡共用的「看的班级」：null = 全部班级（页面范围内） */
  const [selectedClassId, setSelectedClassId] = useState<number | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const [rosterRequest, setRosterRequest] = useState<RosterRequest | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [helpTab, setHelpTab] = useState<BoardHelpTab>("how");
  const requestSeq = useRef(0);

  // 词云分布卡保持现状（#314 不搬动归属）；新看板不再用 compare，跳过它的取数
  const { distribution, errors, fetchDistribution } = useDashboardData({
    includeTrends: false,
    includeCompare: false,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- 切范围 / 刷新时把完成度与兴趣结构打回加载态 */
  useEffect(() => {
    const seq = ++requestSeq.current;
    const controller = new AbortController();
    setCompletionState("loading");
    setInterestState("loading");

    (async () => {
      try {
        const res = await fetch(`/api/manage/stats/completion?scope=${scope}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const parsed = normalizeCompletionStats(await res.json());
        if (!parsed) throw new Error("completion payload malformed");
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        setCompletion(parsed);
        const hasRows = parsed.rows.length > 0 || parsed.unassigned !== null;
        setCompletionState(hasRows ? "ready" : "empty");

        // 兴趣聚合：矩阵的「兴趣构成」列与兴趣结构卡共用同一份响应
        const column = interestColumn(parsed.columns);
        const code = column ? assessmentCodeOfColumn(column.key) : null;
        if (!code) {
          setInterestStats(null);
          setInterestState("disabled");
          return;
        }
        try {
          const statsRes = await fetch(
            `/api/manage/stats/assessment?scope=${scope}&code=${encodeURIComponent(code)}`,
            { signal: controller.signal, cache: "no-store" }
          );
          if (!statsRes.ok) throw new Error(`HTTP ${statsRes.status}`);
          const data = await statsRes.json();
          if (controller.signal.aborted || seq !== requestSeq.current) return;
          const normalized = normalizeInterestStats(data);
          if (!normalized) throw new Error("interest payload malformed");
          setInterestStats(normalized);
          setInterestState(normalized.enabled ? "ready" : "disabled");
        } catch (err) {
          if (controller.signal.aborted || seq !== requestSeq.current) return;
          console.error("Interest structure load error:", err);
          setInterestStats(null);
          setInterestState("failed");
        }
      } catch (err) {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        console.error("Completion stats load error:", err);
        setCompletionState("failed");
        setInterestStats(null);
        setInterestState("failed");
      }
    })();

    return () => controller.abort();
  }, [scope, reloadKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 人格分布：接口没有逐班合计，选具体班时按 classId 重取（#315）
  /* eslint-disable react-hooks/set-state-in-effect -- 切范围 / 换班级 / 刷新时重新取数 */
  useEffect(() => {
    const controller = new AbortController();
    setBigFiveState("loading");
    const params = new URLSearchParams({ scope });
    if (selectedClassId !== null) params.set("classId", String(selectedClassId));

    fetch(`/api/manage/stats/big-five?${params.toString()}`, {
      signal: controller.signal,
      cache: "no-store",
    })
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return res.json();
      })
      .then((data: unknown) => {
        const normalized = normalizeBigFiveStats(data);
        if (!normalized) throw new Error("big five payload malformed");
        if (controller.signal.aborted) return;
        setBigFiveStats(normalized);
        setBigFiveState(normalized.enabled ? "ready" : "disabled");
      })
      .catch((err: unknown) => {
        if (controller.signal.aborted) return;
        console.error("Big five structure load error:", err);
        setBigFiveStats(null);
        setBigFiveState("failed");
      });

    return () => controller.abort();
  }, [scope, selectedClassId, reloadKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 范围变化后班表可能变：已选班级不在新范围里就回到「全部班级」
  /* eslint-disable react-hooks/set-state-in-effect -- 班级列表变化时的兜底重置 */
  useEffect(() => {
    if (selectedClassId === null) return;
    const exists = (completion?.rows ?? []).some((row) => row.classId === selectedClassId);
    if (!exists) setSelectedClassId(null);
  }, [completion, selectedClassId]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const classOptions = useMemo(() => buildStructureClassOptions(completion?.rows ?? []), [completion]);
  const selectedClassName = useMemo(
    () => classOptions.find((option) => option.classId === selectedClassId)?.name ?? "",
    [classOptions, selectedClassId]
  );
  const bigFiveCanDrilldown = useMemo(() => {
    const rows = completion?.rows ?? [];
    if (selectedClassId === null) return rows.some((row) => row.canDrilldown);
    return rows.find((row) => row.classId === selectedClassId)?.canDrilldown ?? false;
  }, [completion, selectedClassId]);

  const actionTarget = useMemo(
    () =>
      completion && completionState === "ready"
        ? pickActionTarget(completion.rows, completion.columns)
        : null,
    [completion, completionState]
  );

  const rosterScales: RosterScaleOption[] = useMemo(() => {
    if (!completion) return [];
    return scaleColumns(completion.columns).map((column) => {
      const code = assessmentCodeOfColumn(column.key) ?? "";
      return { code, label: scaleLabelOf(code, column.label, copy.scaleLabels) };
    });
  }, [completion, copy.scaleLabels]);

  const interestCardState: SectionState = useMemo(() => {
    if (interestState !== "ready") return interestState;
    return (interestStats?.total.assessed ?? 0) === 0 ? "empty" : "ready";
  }, [interestState, interestStats]);

  const handleRefresh = useCallback(() => {
    setReloadKey((key) => key + 1);
    void fetchDistribution();
  }, [fetchDistribution]);

  const openHelp = useCallback((tab: BoardHelpTab) => {
    setHelpTab(tab);
    setHelpOpen(true);
  }, []);

  const handleCopyReminder = useCallback(
    async (text: string) => {
      if (text === "") return;
      try {
        await navigator.clipboard.writeText(text);
        toast.success(copy.actionCopySuccess);
      } catch (err) {
        console.error("Copy reminder text failed:", err);
        toast.error(copy.actionCopyFailed);
      }
    },
    [copy]
  );

  const handleSeeMissing = useCallback((target: NonNullable<typeof actionTarget>) => {
    const code = target.scaleCode;
    if (!code) return;
    setRosterRequest({
      classId: null,
      className: "",
      scale: code,
      scaleLabel: target.scaleLabel,
      status: "missing",
    });
  }, []);

  const failedBanner = completionState === "failed" || errors.distribution;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-[11px] font-medium uppercase tracking-[0.2em] text-muted">{copy.eyebrow}</p>
          <h1 className="mt-1 text-xl font-bold text-foreground sm:text-2xl">{copy.title}</h1>
          <p className="mt-1 text-sm text-muted">{copy.subtitle}</p>
        </div>
        <div className="flex items-center gap-2">
          <Segmented
            options={scopeOptions}
            value={scope}
            onChange={(next) => {
              setScope(next);
              setSelectedClassId(null);
            }}
            label={copy.scopeAriaLabel}
          />
          <button
            type="button"
            onClick={() => openHelp("how")}
            className="inline-flex items-center gap-1 rounded-lg border border-border-soft bg-card px-2.5 py-1.5 text-xs font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <BookOpen className="h-3.5 w-3.5" aria-hidden />
            {copy.structureHelpButton}
          </button>
          <button
            type="button"
            onClick={handleRefresh}
            aria-label={copy.refreshLabel}
            title={copy.refreshLabel}
            className="rounded-lg border border-border-soft bg-card p-1.5 text-muted transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            <RefreshCw className="h-4 w-4" aria-hidden />
          </button>
        </div>
      </header>

      {failedBanner && (
        <div className="flex items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-2.5 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">{copy.bannerPartialFailure}</p>
          <button
            type="button"
            onClick={handleRefresh}
            className="rounded-lg bg-danger px-3 py-1 text-sm text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {copy.retryButton}
          </button>
        </div>
      )}

      <TeacherBoardHero completion={completion} state={completionState} onRetry={handleRefresh} />

      <CompletionMatrix
        completion={completion}
        state={completionState}
        interestByClass={interestStats?.byClass ?? []}
        interestState={interestState}
        onRetry={handleRefresh}
        onOpenRoster={setRosterRequest}
      />

      <section aria-label={copy.structureClassLabel} className="space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-border-soft bg-card px-4 py-2.5">
          <div className="flex items-center gap-2">
            <label htmlFor="teacher-board-structure-class" className="text-xs font-medium text-foreground">
              {copy.structureClassLabel}
            </label>
            <select
              id="teacher-board-structure-class"
              value={selectedClassId === null ? "" : String(selectedClassId)}
              onChange={(event) =>
                setSelectedClassId(event.target.value === "" ? null : Number(event.target.value))
              }
              className="rounded-lg border border-border-soft bg-background px-2 py-1 text-xs text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <option value="">{copy.structureAllClassesLabel}</option>
              {classOptions
                .filter((option) => option.classId !== null)
                .map((option) => (
                  <option key={option.classId ?? 0} value={String(option.classId)}>
                    {option.name}
                  </option>
                ))}
            </select>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
          <div className="min-w-0 lg:col-span-7">
            <InterestStructureCard
              stats={interestStats}
              state={interestCardState}
              selectedClassId={selectedClassId}
              selectedClassName={selectedClassName}
              onOpenRoster={setRosterRequest}
              onOpenHelp={() => openHelp("riasec")}
              onRetry={handleRefresh}
            />
          </div>
          <div className="min-w-0 lg:col-span-5">
            <BigFiveStructureCard
              stats={bigFiveStats}
              state={bigFiveState}
              selectedClassId={selectedClassId}
              selectedClassName={selectedClassName}
              canDrilldown={bigFiveCanDrilldown}
              onOpenRoster={setRosterRequest}
              onOpenHelp={() => openHelp("bigFive")}
              onRetry={handleRefresh}
            />
          </div>
        </div>
      </section>

      <ActionStrip target={actionTarget} onSeeMissing={handleSeeMissing} onCopyReminder={handleCopyReminder} />

      <DistributionCard
        distribution={distribution}
        distributionFailed={errors.distribution}
        copy={TEACHER_DASHBOARD_COPY}
      />

      <AssessmentRosterDialog
        open={rosterRequest !== null}
        request={rosterRequest}
        scales={rosterScales}
        onClose={() => setRosterRequest(null)}
      />

      <BoardHelpDrawer open={helpOpen} initialTab={helpTab} onClose={() => setHelpOpen(false)} />
    </div>
  );
}
