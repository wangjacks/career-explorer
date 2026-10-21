"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { useDashboardData } from "@/hooks/useDashboardData";
import { DistributionCard, Segmented } from "@/components/admin/DashboardKit";
import { TEACHER_BOARD_COPY, TEACHER_DASHBOARD_COPY } from "@/lib/dashboard-copy";
import TeacherBoardHero from "@/components/admin/TeacherBoardHero";
import CompletionMatrix from "@/components/admin/CompletionMatrix";
import ActionStrip from "@/components/admin/ActionStrip";
import AssessmentRosterDialog from "@/components/admin/AssessmentRosterDialog";
import {
  assessmentCodeOfColumn,
  interestColumn,
  normalizeCompletionStats,
  normalizeInterestByClass,
  pickActionTarget,
  scaleColumns,
  scaleLabelOf,
  type CompletionScope,
  type CompletionStatsView,
  type RosterRequest,
  type RosterScaleOption,
  type SectionState,
} from "@/lib/teacher-board";
import type { AssessmentClassTypeComposition } from "@/lib/assessment-stats";

const SCOPES: readonly { value: CompletionScope; labelKey: "scopeMineLabel" | "scopeAllLabel" }[] = [
  { value: "mine", labelKey: "scopeMineLabel" },
  { value: "all", labelKey: "scopeAllLabel" },
];

/**
 * 教师端「测评看板」（#314）：页头 + 唯一深绿 hero + 班级完成矩阵 + 行动条。
 *
 * - 数据两段式：先取 `/api/manage/stats/completion`（hero / 矩阵 / 行动条只依赖它），
 *   返回后按启用量表取结构数据（本 Issue 只消费 `byClass` 供矩阵的「兴趣构成」列）；
 * - 三块各自独立 loading / failed / empty / ready，失败只坏自己并给「重试」；
 * - 范围是页面级单一 state（默认「我带的班」），切「所有班级」时后端把 `canDrilldown` 置 false，
 *   个人下钻按钮随之禁用（服务端仍独立判 403）；
 * - 旧的重复展示（提交进度 hero / 班级提交列表 / 测评卡）已删除，词云分布卡保持现状。
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
  const [interestByClass, setInterestByClass] = useState<AssessmentClassTypeComposition[]>([]);
  const [interestState, setInterestState] = useState<SectionState>("loading");
  const [reloadKey, setReloadKey] = useState(0);
  const [rosterRequest, setRosterRequest] = useState<RosterRequest | null>(null);
  const requestSeq = useRef(0);

  // 词云分布卡保持现状（#314 不搬动归属）；新看板不再用 compare，跳过它的取数
  const { distribution, errors, fetchDistribution } = useDashboardData({
    includeTrends: false,
    includeCompare: false,
  });

  /* eslint-disable react-hooks/set-state-in-effect -- 切范围 / 刷新时把三块同步打回加载态 */
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

        // 结构数据：只有兴趣型量表才需要（矩阵的「兴趣构成」列）
        const column = interestColumn(parsed.columns);
        const code = column ? assessmentCodeOfColumn(column.key) : null;
        if (!code) {
          setInterestByClass([]);
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
          setInterestByClass(normalizeInterestByClass(data));
          setInterestState("ready");
        } catch (err) {
          if (controller.signal.aborted || seq !== requestSeq.current) return;
          console.error("Interest composition load error:", err);
          setInterestState("failed");
        }
      } catch (err) {
        if (controller.signal.aborted || seq !== requestSeq.current) return;
        console.error("Completion stats load error:", err);
        setCompletionState("failed");
        setInterestState("failed");
      }
    })();

    return () => controller.abort();
  }, [scope, reloadKey]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

  const handleRefresh = useCallback(() => {
    setReloadKey((key) => key + 1);
    void fetchDistribution();
  }, [fetchDistribution]);

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

  const handleSeeMissing = useCallback(
    (target: NonNullable<typeof actionTarget>) => {
      const code = target.scaleCode;
      if (!code) return;
      setRosterRequest({
        classId: null,
        className: "",
        scale: code,
        scaleLabel: target.scaleLabel,
        status: "missing",
      });
    },
    []
  );

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
          <Segmented options={scopeOptions} value={scope} onChange={setScope} label={copy.scopeAriaLabel} />
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
        interestByClass={interestByClass}
        interestState={interestState}
        onRetry={handleRefresh}
        onOpenRoster={setRosterRequest}
      />

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
    </div>
  );
}
