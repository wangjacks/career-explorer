"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardList, Tag, Flame } from "lucide-react";
import { StatCard } from "./AdminUI";
import ClassOverviewTable from "./ClassOverviewTable";
import type { Stats, Student } from "@/hooks/useAdminAuth";

interface Props {
  teacherName: string;
  students: Student[];
}

/** 按时段返回问候语 */
function getGreeting(hour: number): string {
  if (hour < 5) return "夜深了";
  if (hour < 11) return "早上好";
  if (hour < 13) return "中午好";
  if (hour < 18) return "下午好";
  return "晚上好";
}

/** 教师面板主页：时段问候 + 数据概览摘要（统计卡 + 班级概览） */
export default function TeacherHomeTab({ teacherName, students }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [now, setNow] = useState(() => new Date());

  const loadStats = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/manage/stats");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      setStats(await res.json());
    } catch (err) {
      console.error("Failed to load stats:", err);
      setLoadError(true);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on mount */
  useEffect(() => {
    loadStats();
  }, [loadStats]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 跨时段停留时问候语跟随本地时间更新
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  return (
    <>
      {/* 问候卡 */}
      <div className="bg-card rounded-xl border border-border-soft p-6">
        <h2 className="text-xl font-semibold text-foreground">
          {getGreeting(now.getHours())}，{teacherName}老师
        </h2>
        <p className="text-sm text-muted mt-1">
          {now.toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric", weekday: "long" })}
          ，欢迎回来看看学生们的探索进展。
        </p>
      </div>

      {/* 统计卡 */}
      {stats ? (
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
      ) : loadError ? (
        <div className="text-center py-8 space-y-3">
          <p className="text-sm text-red-500">统计数据加载失败</p>
          <button
            onClick={loadStats}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
          >
            重试
          </button>
        </div>
      ) : (
        <div className="text-center py-8 text-muted text-sm">统计数据加载中...</div>
      )}

      {/* 班级概览 */}
      <ClassOverviewTable students={students} />
    </>
  );
}
