"use client";

import { useState, useEffect, useCallback } from "react";
import { toast } from "sonner";
import { StatCard } from "./AdminUI";
import type { Stats, PagedData, Profile } from "@/hooks/useAdminAuth";

interface Props {
  authHeaders: () => Record<string, string>;
  installed: boolean | null;
  loadStats: () => Promise<Stats | null>;
  loadProfiles: (p: number) => Promise<PagedData | null>;
}

export default function OverviewTab({ authHeaders, installed, loadStats, loadProfiles }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [paged, setPaged] = useState<PagedData | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Profile | null>(null);

  const refreshStats = useCallback(async () => {
    const s = await loadStats();
    if (s) setStats(s);
  }, [loadStats]);

  const refreshProfiles = useCallback(async (p: number) => {
    const d = await loadProfiles(p);
    if (d) setPaged(d);
  }, [loadProfiles]);

  /* eslint-disable react-hooks/set-state-in-effect -- reset selection on page change */
  useEffect(() => {
    setSelected(new Set());
  }, [page]);
  /* eslint-enable react-hooks/set-state-in-effect */

  /* eslint-disable react-hooks/set-state-in-effect -- initial data load */
  useEffect(() => {
    refreshStats();
    refreshProfiles(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleDeleteProfiles = async (ids: string[]) => {
    if (!confirm(`确定删除 ${ids.length} 条记录？`)) return;
    try {
      const res = await fetch("/api/admin/profiles", {
        method: "DELETE",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("删除失败");
      const { deleted } = await res.json();
      toast.success(`已删除 ${deleted} 条记录`);
      setSelected(new Set());
      refreshStats();
      refreshProfiles(page);
    } catch {
      toast.error("删除失败");
    }
  };

  const toggleSelect = (studentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!paged) return;
    if (selected.size === paged.data.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(paged.data.map((p) => p.studentId)));
    }
  };

  return (
    <>
      {!stats && installed !== false && (
        <div className="text-center py-12 text-gray-400">加载中...</div>
      )}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard label="总提交数" value={stats.total} />
          <StatCard label="今日新增" value={stats.today} />
          <StatCard label="标签种类" value={stats.uniqueTags} />
          <div className="bg-white rounded-xl border border-gray-100 p-5">
            <p className="text-xs text-gray-500 mb-2">热门标签</p>
            <div className="space-y-1">
              {stats.topTags.map((t) => (
                <div key={t.tag} className="flex justify-between text-sm">
                  <span className="text-gray-700">{t.tag}</span>
                  <span className="text-gray-400">{t.count}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">
            数据列表 {paged && `(${paged.total} 条)`}
          </h2>
          {selected.size > 0 && (
            <button
              onClick={() => handleDeleteProfiles(Array.from(selected))}
              className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              删除选中（{selected.size}）
            </button>
          )}
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 text-left text-gray-500">
                <th className="px-5 py-3 font-medium w-10">
                  <input
                    type="checkbox"
                    checked={paged ? selected.size === paged.data.length && paged.data.length > 0 : false}
                    onChange={toggleSelectAll}
                    className="rounded border-gray-300"
                  />
                </th>
                <th className="px-5 py-3 font-medium">学号</th>
                <th className="px-5 py-3 font-medium">姓名</th>
                <th className="px-5 py-3 font-medium">虚拟形象</th>
                <th className="px-5 py-3 font-medium">评价词云</th>
                <th className="px-5 py-3 font-medium">标签</th>
                <th className="px-5 py-3 font-medium">提交时间</th>
                <th className="px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {paged?.data.map((p) => (
                <tr
                  key={p.studentId}
                  className={`hover:bg-gray-50/50 ${selected.has(p.studentId) ? "bg-blue-50/30" : ""}`}
                >
                  <td className="px-5 py-3">
                    <input
                      type="checkbox"
                      checked={selected.has(p.studentId)}
                      onChange={() => toggleSelect(p.studentId)}
                      className="rounded border-gray-300"
                    />
                  </td>
                  <td className="px-5 py-3 font-mono text-xs text-gray-600">{p.studentId}</td>
                  <td className="px-5 py-3 text-gray-700">{p.studentName || "-"}</td>
                  <td className="px-5 py-3">
                    {p.avatarUrl ? (
                      <img src={p.avatarUrl} alt="" className="w-8 h-8 rounded-full object-cover" />
                    ) : (
                      <span className="text-gray-400 text-xs">无</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    {p.evaluationUrl ? (
                      <img src={p.evaluationUrl} alt="" className="w-8 h-8 rounded object-cover" />
                    ) : (
                      <span className="text-gray-400 text-xs">无</span>
                    )}
                  </td>
                  <td className="px-5 py-3">
                    <div className="flex flex-wrap gap-1">
                      {p.tags.slice(0, 3).map((t) => (
                        <span key={t} className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs">
                          {t}
                        </span>
                      ))}
                      {p.tags.length > 3 && (
                        <span className="text-xs text-gray-400">+{p.tags.length - 3}</span>
                      )}
                    </div>
                  </td>
                  <td className="px-5 py-3 text-gray-500 text-xs">{p.createdAt}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center gap-2">
                      <button onClick={() => setDetail(p)}
                        className="text-green-600 hover:text-green-700 text-xs font-medium">查看</button>
                      <button onClick={() => handleDeleteProfiles([p.studentId])}
                        className="text-red-500 hover:text-red-600 text-xs font-medium">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {paged?.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-gray-400">暂无数据</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {paged && paged.totalPages > 1 && (
          <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
            <span className="text-gray-500">第 {paged.page}/{paged.totalPages} 页</span>
            <div className="flex gap-2">
              <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
                className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">上一页</button>
              <button onClick={() => setPage((p) => Math.min(paged.totalPages, p + 1))} disabled={page >= paged.totalPages}
                className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50">下一页</button>
            </div>
          </div>
        )}
      </div>

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">档案详情</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">学号</span><span className="font-mono">{detail.studentId}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">姓名</span><span>{detail.studentName || "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">提交时间</span><span>{detail.createdAt}</span></div>
            </div>
            {detail.avatarUrl && (
              <img src={detail.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
            )}
            <div>
              <p className="text-xs text-gray-500 mb-2">标签（{detail.tags.length}个）</p>
              <div className="flex flex-wrap gap-1">
                {detail.tags.map((t) => (
                  <span key={t} className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs">{t}</span>
                ))}
              </div>
            </div>
            {detail.evaluationUrl && (
              <div>
                <p className="text-xs text-gray-500 mb-2">评价词云</p>
                <img src={detail.evaluationUrl} alt="" className="w-full rounded-lg border border-gray-100" />
              </div>
            )}
            <button onClick={() => { handleDeleteProfiles([detail.studentId]); setDetail(null); }}
              className="w-full py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors">
              删除此记录
            </button>
          </div>
        </div>
      )}
    </>
  );
}
