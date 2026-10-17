"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { computeDashboardTotals, computeRosterBits } from "@/lib/dashboard-utils";
import {
  CompareCard,
  DistributionCard,
  SubmissionHero,
  TrendCard,
} from "@/components/admin/DashboardKit";

export default function AdminDashboardTab() {
  const {
    trends,
    distribution,
    compare,
    trendDays,
    trendGroup,
    setTrendDays,
    setTrendGroup,
    classTrend,
    firstLoading,
    trendPending,
    errors,
    loadError,
    reload,
  } = useDashboardData();

  const totals = useMemo(() => computeDashboardTotals(compare), [compare]);
  const { groups: rosterGroups, tickStep } = computeRosterBits(totals.enrolled, totals.submitted);

  if (firstLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>加载中...</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">部分数据加载失败，图表可能不完整</p>
          <button
            onClick={reload}
            className="rounded-lg bg-danger px-3 py-1 text-sm text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            重试
          </button>
        </div>
      )}

      <SubmissionHero
        totals={totals}
        rosterGroups={rosterGroups}
        tickStep={tickStep}
        caption="全校提交进度"
        compareFailed={errors.compare}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <TrendCard
          trends={trends}
          trendDays={trendDays}
          trendGroup={trendGroup}
          setTrendDays={setTrendDays}
          setTrendGroup={setTrendGroup}
          classTrend={classTrend}
          trendPending={trendPending}
          trendsFailed={errors.trends}
        />

        <DistributionCard
          distribution={distribution}
          distributionFailed={errors.distribution}
        />

        <CompareCard
          compare={compare}
          compareFailed={errors.compare}
        />
      </div>
    </div>
  );
}
