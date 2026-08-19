"use client";

import { useState, useEffect, useCallback } from "react";
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
            className="mt-2 px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg transition-colors">重试</button>
        </div>
      )}
      {!stats && !loadError && installed !== false && (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      )}
      {stats && (
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
          <StatCard
            label="总提交数"
            value={stats.total}
            color="emerald"
            sub={`今日 +${stats.today}`}
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19.5 14.25v-2.625a3.375 3.375 0 00-3.375-3.375h-1.5A1.125 1.125 0 0113.5 7.125v-1.5a3.375 3.375 0 00-3.375-3.375H8.25m0 12.75h7.5m-7.5 3H12M10.5 2.25H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 00-9-9z" />
              </svg>
            }
          />
          <StatCard
            label="标签种类"
            value={stats.uniqueTags}
            color="blue"
            icon={
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" />
              </svg>
            }
          />
          <div className="bg-white rounded-xl border border-gray-100 overflow-hidden hover:-translate-y-1 hover:shadow-lg transition-all duration-200 shadow-sm">
            <div className="h-1 bg-gradient-to-r from-amber-500 to-amber-400" />
            <div className="p-5">
              <div className="flex items-center justify-between mb-3">
                <p className="text-sm font-medium text-gray-500">热门标签</p>
                <div className="w-10 h-10 rounded-xl bg-amber-100 text-amber-600 flex items-center justify-center">
                  <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.362 5.214A8.252 8.252 0 0112 21 8.252 8.252 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
                  </svg>
                </div>
              </div>
              <div className="space-y-2">
                {stats.topTags.slice(0, 5).map((t) => (
                  <div key={t.tag} className="flex items-center justify-between text-sm">
                    <span className="text-gray-700 truncate">{t.tag}</span>
                    <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{t.count}</span>
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
