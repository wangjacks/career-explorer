"use client";

import { useState, useEffect, useCallback } from "react";
import { ClipboardList, Tag, Flame } from "lucide-react";
import { StatCard } from "./AdminUI";
import ClassOverviewTable from "./ClassOverviewTable";
import ProfilesTab from "./ProfilesTab";
import type { Stats, PagedData, Student } from "@/hooks/useAdminAuth";

interface Props {
  installed: boolean | null;
  loadStats: () => Promise<Stats | null>;
  loadProfiles: (p: number) => Promise<PagedData | null>;
  students: Student[];
  /** 是否展示数据列表（admin 数据概览内嵌；教师端数据概览传 false，数据列表独立成页） */
  showProfiles?: boolean;
}

export default function OverviewTab({ installed, loadStats, loadProfiles, students, showProfiles = true }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadError, setLoadError] = useState(false);

  const refreshStats = useCallback(async () => {
    const s = await loadStats();
    if (s) {
      setStats(s);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
  }, [loadStats]);

  /* eslint-disable react-hooks/set-state-in-effect -- initial data load */
  useEffect(() => {
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
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

      {/* 班级概览统计 */}
      <ClassOverviewTable students={students} />

      {/* 数据列表（教师端数据概览不展示，独立成页） */}
      {showProfiles && <ProfilesTab loadProfiles={loadProfiles} loadStats={loadStats} />}
    </>
  );
}
