"use client";

import { useEffect, useMemo, useState } from "react";
import type { Student } from "@/hooks/useAdminAuth";

interface Props {
  students: Student[];
}

/** 班级概览统计表：各班/未分班/合计的学生总数、已提交、未提交与提交率 */
export default function ClassOverviewTable({ students }: Props) {
  const [classList, setClassList] = useState<{ id: number; name: string }[]>([]);

  useEffect(() => {
    fetch("/api/admin/classes")
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data) setClassList(data.data || []);
      })
      .catch((err) => console.error("Failed to load classes:", err));
  }, []);

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

  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <div className="px-5 py-4 border-b border-gray-100">
        <h2 className="font-semibold text-gray-800">班级概览</h2>
      </div>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 text-left text-gray-500">
              <th className="px-5 py-3 font-medium">班级</th>
              <th className="px-5 py-3 font-medium">学生总数</th>
              <th className="px-5 py-3 font-medium">已提交</th>
              <th className="px-5 py-3 font-medium">未提交</th>
              <th className="px-5 py-3 font-medium">提交率</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50">
            {classOverview.rows.map((r) => (
              <tr key={r.name}>
                <td className="px-5 py-3 text-gray-700">{r.name}</td>
                <td className="px-5 py-3 text-gray-600">{r.total}</td>
                <td className="px-5 py-3 text-green-600">{r.submitted}</td>
                <td className="px-5 py-3 text-gray-600">{r.unsubmitted}</td>
                <td className="px-5 py-3 text-gray-600">
                  {r.total > 0 ? `${((r.submitted / r.total) * 100).toFixed(2)}%` : "-"}
                </td>
              </tr>
            ))}
            {classOverview.unassigned.total > 0 && (
              <tr>
                <td className="px-5 py-3 text-amber-600">未分班</td>
                <td className="px-5 py-3 text-gray-600">{classOverview.unassigned.total}</td>
                <td className="px-5 py-3 text-green-600">{classOverview.unassigned.submitted}</td>
                <td className="px-5 py-3 text-gray-600">{classOverview.unassigned.unsubmitted}</td>
                <td className="px-5 py-3 text-gray-600">
                  {((classOverview.unassigned.submitted / classOverview.unassigned.total) * 100).toFixed(2)}%
                </td>
              </tr>
            )}
            <tr className="bg-gray-50 font-medium">
              <td className="px-5 py-3 text-gray-800">合计</td>
              <td className="px-5 py-3 text-gray-800">{classOverview.total}</td>
              <td className="px-5 py-3 text-green-700">{classOverview.totalSubmitted}</td>
              <td className="px-5 py-3 text-gray-800">{classOverview.totalUnsubmitted}</td>
              <td className="px-5 py-3 text-gray-800">
                {classOverview.total > 0 ? `${((classOverview.totalSubmitted / classOverview.total) * 100).toFixed(2)}%` : "-"}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  );
}
