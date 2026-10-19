"use client";

import { useMemo } from "react";
import { Loader2 } from "lucide-react";
import { useDashboardData } from "@/hooks/useDashboardData";
import { computeDashboardTotals, computeRosterBits } from "@/lib/dashboard-utils";
import { TEACHER_DASHBOARD_COPY } from "@/lib/dashboard-copy";
import { DistributionCard, SubmissionHero } from "@/components/admin/DashboardKit";
import { ClassSubmissionCard } from "@/components/admin/TeacherDashboardCards";
import TeacherAssessmentCard from "@/components/admin/TeacherAssessmentCard";

export default function TeacherDashboardTab() {
  const { distribution, compare, firstLoading, errors, loadError, reload } =
    useDashboardData({ includeTrends: false });

  const totals = useMemo(() => computeDashboardTotals(compare), [compare]);
  const { groups: rosterGroups, tickStep } = computeRosterBits(totals.enrolled, totals.submitted);

  if (firstLoading) {
    return (
      <div className="flex items-center justify-center gap-2 py-16 text-muted">
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{TEACHER_DASHBOARD_COPY.pageLoading}</span>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {loadError && (
        <div className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-3 dark:border-red-800 dark:bg-red-900/20">
          <p className="text-sm text-red-600 dark:text-red-400">{TEACHER_DASHBOARD_COPY.bannerPartialFailure}</p>
          <button
            onClick={reload}
            className="rounded-lg bg-danger px-3 py-1 text-sm text-white transition-colors hover:bg-red-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
          >
            {TEACHER_DASHBOARD_COPY.retryButton}
          </button>
        </div>
      )}

      <SubmissionHero
        totals={totals}
        rosterGroups={rosterGroups}
        tickStep={tickStep}
        caption="提交进度"
        compareFailed={errors.compare}
        copy={TEACHER_DASHBOARD_COPY}
      />

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">
        <ClassSubmissionCard compare={compare} compareFailed={errors.compare} />

        <DistributionCard
          distribution={distribution}
          distributionFailed={errors.distribution}
          copy={TEACHER_DASHBOARD_COPY}
        />

        <TeacherAssessmentCard />
      </div>
    </div>
  );
}
