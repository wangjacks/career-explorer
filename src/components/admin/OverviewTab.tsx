"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { StatCard } from "./AdminUI";
import ConfirmDialog from "./ConfirmDialog";
import type { Stats, PagedData, Profile, Student } from "@/hooks/useAdminAuth";

interface Props {
  installed: boolean | null;
  loadStats: () => Promise<Stats | null>;
  loadProfiles: (p: number) => Promise<PagedData | null>;
  students: Student[];
}

type OverviewSortKey = "studentId" | "studentName" | "createdAt";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block w-3 text-xs ${active ? "text-green-600" : "text-gray-300"}`}>
      {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

export default function OverviewTab({ installed, loadStats, loadProfiles, students }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [paged, setPaged] = useState<PagedData | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Profile | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [sortKey, setSortKey] = useState<OverviewSortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const tagDropdownRef = useRef<HTMLDivElement>(null);

  // 班级概览：拉取班级列表 + 按学生归属聚合提交情况
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

  const handleSort = (key: OverviewSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "createdAt" ? "desc" : "asc");
    }
  };

  const refreshStats = useCallback(async () => {
    const s = await loadStats();
    if (s) {
      setStats(s);
      setLoadError(false);
    } else {
      setLoadError(true);
    }
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

  // Client-side search filter + sort
  const filteredData = useMemo(() => {
    if (!paged) return null;
    const q = search.trim().toLowerCase();
    let list = paged.data;
    if (q) {
      list = list.filter((p) =>
        p.studentId.toLowerCase().includes(q) ||
        (p.studentName || "").toLowerCase().includes(q)
      );
    }
    if (selectedTags.size > 0) {
      list = list.filter((p) =>
        Array.from(selectedTags).every((tag) => p.tags.includes(tag))
      );
    }
    const sorted = [...list].sort((a, b) => {
      const va = (a[sortKey as keyof Profile] || "") as string;
      const vb = (b[sortKey as keyof Profile] || "") as string;
      const cmp = va.localeCompare(vb, "zh-CN");
      return sortDir === "asc" ? cmp : -cmp;
    });
    const hasFilter = !!q || selectedTags.size > 0;
    return { ...paged, data: sorted, total: hasFilter ? sorted.length : paged.total };
  }, [paged, search, selectedTags, sortKey, sortDir]);

  // Close tag dropdown on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (tagDropdownRef.current && !tagDropdownRef.current.contains(e.target as Node)) {
        setTagDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = new Set(prev);
      if (next.has(tag)) next.delete(tag);
      else next.add(tag);
      return next;
    });
  };

  const filteredTags = useMemo(() => {
    if (!stats?.topTags) return [];
    const q = tagSearch.trim().toLowerCase();
    if (!q) return stats.topTags;
    return stats.topTags.filter((t) => t.tag.toLowerCase().includes(q));
  }, [stats, tagSearch]);

  const handleDeleteProfiles = async (ids: string[]) => {
    try {
      const res = await fetch("/api/admin/profiles", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
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
      {loadError && !stats && (
        <div className="text-center py-12 text-red-500">
          <p>数据加载失败</p>
          <button onClick={() => { refreshStats(); refreshProfiles(page); }}
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
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.362 5.214A8.252 8.252 0 0112 21 8.25 8.25 0 016.038 7.048 8.287 8.287 0 009 9.6a8.983 8.983 0 013.361-6.867 8.21 8.21 0 003 2.48z" />
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
      {students.length > 0 && (
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
                      {r.total > 0 ? `${Math.round((r.submitted / r.total) * 100)}%` : "-"}
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
                      {Math.round((classOverview.unassigned.submitted / classOverview.unassigned.total) * 100)}%
                    </td>
                  </tr>
                )}
                <tr className="bg-gray-50 font-medium">
                  <td className="px-5 py-3 text-gray-800">合计</td>
                  <td className="px-5 py-3 text-gray-800">{classOverview.total}</td>
                  <td className="px-5 py-3 text-green-700">{classOverview.totalSubmitted}</td>
                  <td className="px-5 py-3 text-gray-800">{classOverview.totalUnsubmitted}</td>
                  <td className="px-5 py-3 text-gray-800">
                    {classOverview.total > 0 ? `${Math.round((classOverview.totalSubmitted / classOverview.total) * 100)}%` : "-"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}

      <div className="bg-white rounded-xl border border-gray-100">
        <div className="px-5 py-4 border-b border-gray-100 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <h2 className="font-semibold text-gray-800">
              数据列表 {paged && `(${paged.total} 条)`}
            </h2>
            {selected.size > 0 && (
              <button
                onClick={() => setConfirmDelete(Array.from(selected))}
                className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                删除选中（{selected.size}）
              </button>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索学号/姓名..."
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            {/* Tag dropdown */}
            <div className="relative" ref={tagDropdownRef}>
              <button
                onClick={() => setTagDropdownOpen((v) => !v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                  selectedTags.size > 0
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M9.568 3H5.25A2.25 2.25 0 003 5.25v4.318c0 .597.237 1.17.659 1.591l9.581 9.581c.699.699 1.78.872 2.607.33a18.095 18.095 0 005.223-5.223c.542-.827.369-1.908-.33-2.607L11.16 3.66A2.25 2.25 0 009.568 3z" />
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M6 6h.008v.008H6V6z" />
                </svg>
                标签筛选
                {selectedTags.size > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 bg-green-500 text-white text-xs rounded-full leading-none">{selectedTags.size}</span>
                )}
                <svg className={`w-3 h-3 transition-transform ${tagDropdownOpen ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {tagDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl border border-gray-200 shadow-lg z-30">
                  <div className="p-2 border-b border-gray-100">
                    <input
                      type="text"
                      value={tagSearch}
                      onChange={(e) => setTagSearch(e.target.value)}
                      placeholder="搜索标签..."
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto py-1">
                    {filteredTags.map((t) => {
                      const isActive = selectedTags.has(t.tag);
                      return (
                        <button
                          key={t.tag}
                          onClick={() => toggleTag(t.tag)}
                          className={`w-full text-left px-3 py-1.5 text-sm flex items-center justify-between transition-colors ${
                            isActive ? "bg-green-50 text-green-700" : "hover:bg-gray-50 text-gray-700"
                          }`}
                        >
                          <span className="flex items-center gap-2 truncate">
                            <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-xs ${
                              isActive ? "bg-green-500 border-green-500 text-white" : "border-gray-300"
                            }`}>
                              {isActive && "✓"}
                            </span>
                            <span className="truncate">{t.tag}</span>
                          </span>
                          <span className="text-xs text-gray-400 ml-2 flex-shrink-0">{t.count}</span>
                        </button>
                      );
                    })}
                    {filteredTags.length === 0 && (
                      <div className="px-3 py-4 text-center text-sm text-gray-400">无匹配标签</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            {/* Selected tags as removable pills */}
            {Array.from(selectedTags).map((tag) => (
              <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 text-green-700 rounded-full text-xs font-medium">
                {tag}
                <button onClick={() => toggleTag(tag)} className="hover:text-green-900 leading-none">×</button>
              </span>
            ))}
            {(selectedTags.size > 0 || search) && (
              <button
                onClick={() => { setSelectedTags(new Set()); setSearch(""); }}
                className="text-xs text-gray-400 hover:text-gray-600 ml-1 transition-colors"
              >
                清除筛选
              </button>
            )}
          </div>
        </div>
        <div className="overflow-x-auto rounded-b-xl">
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
                <th className="px-5 py-3 font-medium cursor-pointer select-none" onClick={() => handleSort("studentId")}>学号<SortIcon active={sortKey === "studentId"} dir={sortDir} /></th>
                <th className="px-5 py-3 font-medium cursor-pointer select-none" onClick={() => handleSort("studentName")}>姓名<SortIcon active={sortKey === "studentName"} dir={sortDir} /></th>
                <th className="px-5 py-3 font-medium">虚拟形象</th>
                <th className="px-5 py-3 font-medium">评价词云</th>
                <th className="px-5 py-3 font-medium">标签</th>
                <th className="px-5 py-3 font-medium cursor-pointer select-none" onClick={() => handleSort("createdAt")}>提交时间<SortIcon active={sortKey === "createdAt"} dir={sortDir} /></th>
                <th className="px-5 py-3 font-medium">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredData?.data.map((p) => (
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
                      <button onClick={() => setConfirmDelete([p.studentId])}
                        className="text-red-500 hover:text-red-600 text-xs font-medium">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredData?.data.length === 0 && (
                <tr>
                  <td colSpan={8} className="px-5 py-12 text-center text-gray-400">
                    {paged?.data.length === 0 ? "暂无数据" : "无匹配结果"}
                  </td>
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
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 text-lg">档案详情</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">学号</p>
                <p className="font-mono font-medium text-gray-800 mt-0.5">{detail.studentId}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3">
                <p className="text-xs text-gray-500">姓名</p>
                <p className="font-medium text-gray-800 mt-0.5">{detail.studentName || "-"}</p>
              </div>
              <div className="bg-gray-50 rounded-lg p-3 col-span-2">
                <p className="text-xs text-gray-500">提交时间</p>
                <p className="font-medium text-gray-800 mt-0.5">{detail.createdAt}</p>
              </div>
            </div>

            {detail.avatarUrl && (
              <div>
                <p className="text-xs text-gray-500 mb-2">虚拟形象</p>
                <img src={detail.avatarUrl} alt="" className="w-20 h-20 rounded-xl object-cover border border-gray-100" />
              </div>
            )}

            <div>
              <p className="text-xs text-gray-500 mb-2">标签（{detail.tags.length}个）</p>
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.map((t) => (
                  <span key={t} className="px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-xs font-medium">{t}</span>
                ))}
              </div>
            </div>

            {detail.evaluationUrl && (
              <div>
                <p className="text-xs text-gray-500 mb-2">评价词云</p>
                <img src={detail.evaluationUrl} alt="" className="w-full rounded-xl border border-gray-100" />
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button onClick={() => setDetail(null)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">
                关闭
              </button>
              <button onClick={() => { setConfirmDelete([detail.studentId]); setDetail(null); }}
                className="flex-1 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors">
                删除此记录
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="确认删除"
        message={`确定删除 ${confirmDelete?.length} 条档案记录？此操作不可恢复。`}
        variant="danger"
        confirmText="删除"
        onConfirm={() => { if (confirmDelete) { handleDeleteProfiles(confirmDelete); setConfirmDelete(null); } }}
        onCancel={() => setConfirmDelete(null)}
      />
    </>
  );
}
