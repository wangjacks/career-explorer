"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Student } from "@/hooks/useAdminAuth";

interface Props {
  students: Student[];
}

/** 班级概览统计表：各班/未分班/合计的学生总数、已提交、未提交与提交率 */
export default function ClassOverviewTable({ students }: Props) {
  const [classList, setClassList] = useState<{ id: number; name: string }[]>([]);
  const [loadError, setLoadError] = useState(false);

  const loadClasses = useCallback(async () => {
    setLoadError(false);
    try {
      const res = await fetch("/api/manage/classes");
      if (!res.ok) {
        setLoadError(true);
        return;
      }
      const data = await res.json();
      setClassList(data.data || []);
    } catch (err) {
      console.error("Failed to load classes:", err);
      setLoadError(true);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- data fetch on mount */
  useEffect(() => {
    loadClasses();
  }, [loadClasses]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const classOverview = useMemo(() => {
    const rows = classList.map((c) => {
      const members = students.filter((s) => s.class_id === c.id);
      const submitted = members.filter((s) => s.submitted_at != null).length;
      return { name: c.name, total: members.length, submitted, unsubmitted: members.length - submitted };
    });
    const unassigned = students.filter((s) => s.class_id == null);
    const unassignedSubmitted = unassigned.filter((s) => s.submitted_at != null).length;
    const totalSubmitted = students.filter((s) => s.submitted_at != null).length;
    return {
      rows,
      unassigned: {
        total: unassigned.length,
        submitted: unassignedSubmitted,
        unsubmitted: unassigned.length - unassignedSubmitted,
      },
      total: students.length,
      totalSubmitted,
      totalUnsubmitted: students.length - totalSubmitted,
    };
  }, [students, classList]);

  if (students.length === 0) return null;

  if (loadError) {
    return (
      <div className="bg-card rounded-xl border border-border-soft p-6 text-center space-y-3">
        <p className="text-sm text-red-500">班级数据加载失败</p>
        <button onClick={loadClasses}
          className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors">重试</button>
      </div>
    );
  }

  return (
    <div className="bg-card rounded-xl border border-border-soft overflow-hidden">
      <div className="px-5 py-4 border-b border-border-soft">
        <h2 className="font-semibold text-foreground">班级概览</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 dark:bg-gray-800 text-left text-muted">
              <th className="px-5 py-3 font-medium">班级</th>
              <th className="px-5 py-3 font-medium">学生总数</th>
              <th className="px-5 py-3 font-medium">已提交</th>
              <th className="px-5 py-3 font-medium">未提交</th>
              <th className="px-5 py-3 font-medium">提交率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {classOverview.rows.map((r) => (
              <tr key={r.name}>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-200">{r.name}</td>
                <td className="px-5 py-3 text-gray-600 dark:text-gray-300">{r.total}</td>
                <td className="px-5 py-3 text-green-600 dark:text-green-400">{r.submitted}</td>
                <td className="px-5 py-3 text-gray-600 dark:text-gray-300">{r.unsubmitted}</td>
                <td className="px-5 py-3 text-gray-600 dark:text-gray-300">
                  {r.total > 0 ? `${((r.submitted / r.total) * 100).toFixed(2)}%` : "-"}
                </td>
              </tr>
            ))}
            {classOverview.unassigned.total > 0 && (
              <tr>
                <td className="px-5 py-3 text-amber-600 dark:text-amber-400">未分班</td>
                <td className="px-5 py-3 text-gray-600 dark:text-gray-300">{classOverview.unassigned.total}</td>
                <td className="px-5 py-3 text-green-600 dark:text-green-400">{classOverview.unassigned.submitted}</td>
                <td className="px-5 py-3 text-gray-600 dark:text-gray-300">{classOverview.unassigned.unsubmitted}</td>
                <td className="px-5 py-3 text-gray-600 dark:text-gray-300">
                  {((classOverview.unassigned.submitted / classOverview.unassigned.total) * 100).toFixed(2)}%
                </td>
              </tr>
            )}
            <tr className="bg-gray-50 dark:bg-gray-800 font-medium">
              <td className="px-5 py-3 text-foreground">合计</td>
              <td className="px-5 py-3 text-foreground">{classOverview.total}</td>
              <td className="px-5 py-3 text-green-700 dark:text-green-400">{classOverview.totalSubmitted}</td>
              <td className="px-5 py-3 text-foreground">{classOverview.totalUnsubmitted}</td>
              <td className="px-5 py-3 text-foreground">
                {classOverview.total > 0 ? `${((classOverview.totalSubmitted / classOverview.total) * 100).toFixed(2)}%` : "-"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
