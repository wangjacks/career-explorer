"use client";

import { useState, useEffect, useCallback } from "react";
import { BarChart3, ClipboardList, ClipboardCheck, Tag, Flame } from "lucide-react";
import { StatCard } from "./AdminUI";
import ClassOverviewTable from "./ClassOverviewTable";
import ProfilesTab from "./ProfilesTab";
import type { ProfileListQuery } from "@/lib/profile-query";
import {
  assessmentCompletionCard,
  normalizeAssessmentOverview,
  type AssessmentOverviewStats,
} from "@/lib/assessment-overview";
import type { Stats, PagedData, Student } from "@/hooks/useAdminAuth";

interface Props {
  installed: boolean | null;
  loadStats: () => Promise<Stats | null>;
  loadProfiles: (p: number, query?: ProfileListQuery) => Promise<PagedData | null>;
  students: Student[];
  /** 是否展示数据列表（admin 数据概览内嵌；教师端数据概览传 false，数据列表独立成页） */
  showProfiles?: boolean;
  /** 面板归属：教师端才出现「去数据大屏」引导（#230，管理员端数据概览不受影响） */
  mode?: "admin" | "teacher";
  /** 切换面板 Tab（教师端用于跳「数据大屏」；不传则引导按钮不渲染） */
  onNavigate?: (key: string) => void;
}

/**
 * 数据概览（教师/管理员共用）：四张统计卡 + 班级概览表 +（管理员）数据列表。
 *
 * #230 起多一张「测评完成」卡，并把完成度口径延伸到班级概览的两列；**图表一律留在数据大屏**
 * （教师端在表下给一条引导），避免概览与大屏互相重复。
 * 测评统计接口不可用（未启用/无数据/请求失败）时卡片显示 0 与友好空态、表格两列显示 `-`，不报错。
 */
export default function OverviewTab({
  installed,
  loadStats,
  loadProfiles,
  students,
  showProfiles = true,
  mode = "admin",
  onNavigate,
}: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [assessment, setAssessment] = useState<AssessmentOverviewStats | null>(null);
  const [assessmentLoading, setAssessmentLoading] = useState(true);

  const refreshStats = useCallback(async () => {
    const s = await loadStats();
    if (s) {
      setStats(s);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
  }, [loadStats]);

  // 测评完成度（#230）：失败/未启用都按「没有测评数据」处理，概览页不出现红色失败态
  const loadAssessment = useCallback(async () => {
    setAssessmentLoading(true);
    try {
      const res = await fetch("/api/manage/stats/assessment");
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setAssessment(normalizeAssessmentOverview(await res.json()));
    } catch (err) {
      console.error("Failed to load assessment stats:", err);
      setAssessment(null);
    } finally {
      setAssessmentLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- initial data load */
  useEffect(() => {
    refreshStats();
    loadAssessment();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const assessmentCard = assessmentCompletionCard(assessment);
  const showDashboardGuide = mode === "teacher" && typeof onNavigate === "function";

  return (
    <>
      {loadError && !stats && (
        <div className="text-center py-12 text-red-500">
          <p>数据加载失败</p>
          <button onClick={() => refreshStats()}
            className="mt-2 px-4 py-1.5 bg-danger hover:bg-red-600 text-white text-sm rounded-lg transition-colors">重试</button>
        </div>
      )}
      {!stats && !loadError && installed !== false && (
        <div className="text-center py-12 text-muted">加载中...</div>
      )}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard
            label="总提交数"
            value={stats.total}
            color="emerald"
            sub={`今日 +${stats.today}`}
            icon={
              <ClipboardList className="w-5 h-5" strokeWidth={1.5} />
            }
          />
          <StatCard
            label="标签种类"
            value={stats.uniqueTags}
            color="blue"
            icon={
              <Tag className="w-5 h-5" strokeWidth={1.5} />
            }
          />
          <StatCard
            label="测评完成"
            value={assessmentCard.value}
            color="purple"
            sub={assessmentLoading ? "加载中..." : assessmentCard.sub}
            icon={
              <ClipboardCheck className="w-5 h-5" strokeWidth={1.5} />
            }
          />
          <div className="bg-card rounded-xl border border-border-soft overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-all duration-200 shadow-sm">
            <div className="h-1 bg-gradient-to-r from-amber-500 to-amber-400" />
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-muted">热门标签</p>
                <div className="w-10 h-10 rounded-xl bg-amber-100 dark:bg-amber-900/30 text-amber-600 dark:text-amber-400 flex items-center justify-center">
                  <Flame className="w-5 h-5" strokeWidth={1.5} />
                </div>
              </div>
              <div className="space-y-2">
                {stats.topTags.slice(0, 5).map((t) => (
                  <div key={t.tag} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 dark:text-gray-200 truncate">{t.tag}</span>
                    <span className="text-xs text-muted ml-2 flex-shrink-0">{t.count}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* 班级概览统计（#230 追加「测评完成 / 交齐比例」两列） */}
      <ClassOverviewTable students={students} assessment={assessment} />

      {/* 分布类需求指向数据大屏（#230，仅教师端）：概览只回答「有没有做」 */}
      {showDashboardGuide && stats && (
        <div className="bg-card rounded-xl border border-border-soft p-5 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-muted">
            想了解班级的六型兴趣结构？数据大屏按班级展示测评分布与提交趋势。
          </p>
          <button
            onClick={() => onNavigate?.("dashboard")}
            className="inline-flex items-center justify-center gap-1.5 px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors flex-shrink-0 self-start sm:self-auto"
          >
            <BarChart3 className="w-4 h-4" strokeWidth={1.5} aria-hidden />
            去数据大屏看兴趣类型分布
          </button>
        </div>
      )}

      {/* 数据列表（教师端数据概览不展示，独立成页） */}
      {showProfiles && <ProfilesTab loadProfiles={loadProfiles} loadStats={loadStats} />}
    </>
  );
}
