"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Tag, ChevronDown } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import StorageImage from "@/components/StorageImage";
import type { Stats, PagedData, Profile } from "@/hooks/useAdminAuth";

interface Props {
  /** 可选：由页面/OverviewTab 透传的加载实现（admin 端删除后统计卡联动）；未传时组件内部自 fetch */
  loadProfiles?: (p: number) => Promise<PagedData | null>;
  loadStats?: () => Promise<Stats | null>;
}

type ProfilesSortKey = "studentId" | "studentName" | "createdAt";
type SortDir = "asc" | "desc";

/** 版本历史行（#95）：详情弹窗内展示 */
interface SubmissionHistoryRow {
  id: number;
  version: number;
  tags: string[];
  avatar_url: string;
  evaluation_url: string;
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block w-3 text-xs ${active ? "text-green-600" : "text-gray-300"}`}>
      {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

/** 已提交档案数据列表：分页、搜索、标签筛选、详情查看、单个/批量删除 */
export default function ProfilesTab({ loadProfiles, loadStats }: Props) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [paged, setPaged] = useState<PagedData | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Profile | null>(null);
  const [search, setSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [sortKey, setSortKey] = useState<ProfilesSortKey>("createdAt");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  // 版本历史（#95）：详情弹窗内折叠展示
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<SubmissionHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  // 保留最新传入的 load 函数引用，初始加载 effect 仅 mount 时执行
  const loadProfilesRef = useRef(loadProfiles);
  const loadStatsRef = useRef(loadStats);

  useEffect(() => {
    loadProfilesRef.current = loadProfiles;
    loadStatsRef.current = loadStats;
  }, [loadProfiles, loadStats]);

  const defaultLoadProfiles = useCallback(async (p: number): Promise<PagedData | null> => {
    try {
      const res = await fetch(`/api/manage/profiles?page=${p}`);
      if (res.ok) return await res.json();
    } catch (err) {
      console.error("Failed to load profiles:", err);
      toast.error("加载档案列表失败");
    }
    return null;
  }, []);

  const defaultLoadStats = useCallback(async (): Promise<Stats | null> => {
    try {
      const res = await fetch("/api/manage/stats");
      if (res.ok) return await res.json();
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
    return null;
  }, []);

  const handleSort = (key: ProfilesSortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "createdAt" ? "desc" : "asc");
    }
  };

  const refreshStats = useCallback(async () => {
    const fn = loadStatsRef.current ?? defaultLoadStats;
    const s = await fn();
    if (s) setStats(s);
  }, [defaultLoadStats]);

  const refreshProfiles = useCallback(async (p: number) => {
    const fn = loadProfilesRef.current ?? defaultLoadProfiles;
    const d = await fn(p);
    if (d) setPaged(d);
  }, [defaultLoadProfiles]);

  /* eslint-disable react-hooks/set-state-in-effect -- reset selection on page change */
  useEffect(() => {
    setSelected(new Set());
  }, [page]);
  /* eslint-enable react-hooks/set-state-in-effect */

  useEffect(() => {
    refreshStats();
    refreshProfiles(1);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

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
      const res = await fetch("/api/manage/profiles", {
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

  // 加载版本历史（#95）：首次展开详情弹窗时拉取
  const loadHistory = async (userId: number) => {
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/manage/profiles/submissions?userId=${userId}`);
      const data = await res.json();
      if (res.ok) setHistoryRows(data.submissions || []);
    } catch (err) {
      console.error("Failed to load submission history:", err);
    } finally {
      setHistoryLoading(false);
    }
  };

  const openDetail = (p: Profile) => {
    setDetail(p);
    setHistoryOpen(false);
    setHistoryRows([]);
    if (p.userId != null) void loadHistory(p.userId);
  };

  return (
    <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700">
      <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">
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
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-green-300"
          />
          {/* Tag dropdown */}
          <div className="relative" ref={tagDropdownRef}>
            <button
              onClick={() => setTagDropdownOpen((v) => !v)}
              className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                selectedTags.size > 0
                  ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                  : "bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300"
              }`}
            >
              <Tag className="w-4 h-4" strokeWidth={1.5} />
              标签筛选
              {selectedTags.size > 0 && (
                <span className="ml-0.5 px-1.5 py-0.5 bg-green-500 text-white text-xs rounded-full leading-none">{selectedTags.size}</span>
              )}
              <ChevronDown className={`w-3 h-3 transition-transform ${tagDropdownOpen ? "rotate-180" : ""}`} />
            </button>
            {tagDropdownOpen && (
              <div className="absolute top-full left-0 mt-1 w-64 bg-card rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg z-30">
                <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                  <input
                    type="text"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="搜索标签..."
                    className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
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
                          isActive ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300" : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
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
            <span key={tag} className="inline-flex items-center gap-1 px-2 py-0.5 bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">
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
            <tr className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500 dark:text-gray-400">
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
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {filteredData?.data.map((p) => (
              <tr
                key={p.studentId}
                className={`hover:bg-gray-50/50 dark:hover:bg-gray-800/40 ${selected.has(p.studentId) ? "bg-blue-50/30 dark:bg-blue-900/20" : ""}`}
              >
                <td className="px-5 py-3">
                  <input
                    type="checkbox"
                    checked={selected.has(p.studentId)}
                    onChange={() => toggleSelect(p.studentId)}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{p.studentId}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-200">{p.studentName || "-"}</td>
                <td className="px-5 py-3">
                  {p.avatarUrl ? (
                    <StorageImage url={p.avatarUrl} storageId={p.storageId} alt="" className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <span className="text-gray-400 text-xs">无</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {p.evaluationUrl ? (
                    <StorageImage url={p.evaluationUrl} storageId={p.storageId} alt="" className="w-8 h-8 rounded object-cover" />
                  ) : (
                    <span className="text-gray-400 text-xs">无</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  <div className="flex flex-wrap gap-1">
                    {p.tags.slice(0, 3).map((t) => (
                      <span key={t} className="px-2 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-xs">
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
                    <button onClick={() => openDetail(p)}
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

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setDetail(null)}>
          <div className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-lg">档案详情</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">×</button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">学号</p>
                <p className="font-mono font-medium text-gray-800 dark:text-gray-100 mt-0.5">{detail.studentId}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <p className="text-xs text-gray-500 dark:text-gray-400">姓名</p>
                <p className="font-medium text-gray-800 dark:text-gray-100 mt-0.5">{detail.studentName || "-"}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 col-span-2">
                <p className="text-xs text-gray-500 dark:text-gray-400">提交时间</p>
                <p className="font-medium text-gray-800 dark:text-gray-100 mt-0.5">{detail.createdAt}</p>
              </div>
            </div>

            {detail.avatarUrl && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">虚拟形象</p>
                <StorageImage url={detail.avatarUrl} storageId={detail.storageId} alt="" className="w-20 h-20 rounded-xl object-cover border border-gray-100" />
              </div>
            )}

            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">标签（{detail.tags.length}个）</p>
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.map((t) => (
                  <span key={t} className="px-2.5 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">{t}</span>
                ))}
              </div>
            </div>

            {detail.evaluationUrl && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 mb-2">评价词云</p>
                <StorageImage url={detail.evaluationUrl} storageId={detail.storageId} alt="" className="w-full rounded-xl border border-gray-100" />
              </div>
            )}

            {/* 版本历史（#95）：折叠展示，打开详情时已预取 */}
            <div className="border-t border-gray-100 dark:border-gray-700 pt-3">
              <button
                onClick={() => setHistoryOpen((v) => !v)}
                className="w-full flex items-center justify-between text-sm font-medium text-gray-700 dark:text-gray-200"
                aria-expanded={historyOpen}
              >
                <span>版本历史（{historyRows.length}）</span>
                <span className="text-gray-400">{historyOpen ? "收起" : "展开"}</span>
              </button>
              {historyOpen && (
                <div className="mt-3 space-y-2">
                  {historyLoading ? (
                    <p className="text-sm text-gray-400">加载中...</p>
                  ) : historyRows.length === 0 ? (
                    <p className="text-sm text-gray-400">暂无版本记录</p>
                  ) : (
                    historyRows.map((h) => (
                      <div key={h.id} className="border border-gray-100 dark:border-gray-700 rounded-lg p-2.5 space-y-1.5">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-gray-700 dark:text-gray-200">版本 {h.version}</span>
                          {h.is_current === 1 ? (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">当前</span>
                          ) : (
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">历史</span>
                          )}
                          <span className="ml-auto text-[10px] text-gray-400">{h.submitted_at}</span>
                        </div>
                        <div className="flex flex-wrap gap-1">
                          {h.tags.length === 0 ? (
                            <span className="text-[10px] text-gray-400">暂无标签</span>
                          ) : (
                            h.tags.map((t) => (
                              <span key={t} className="px-1.5 py-0.5 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded text-[10px]">
                                {t}
                              </span>
                            ))
                          )}
                        </div>
                        {(h.avatar_url || h.evaluation_url) && (
                          <div className="flex gap-1.5">
                            {h.avatar_url && (
                              <StorageImage url={h.avatar_url} storageId={h.storage_id} alt="" className="w-8 h-8 rounded object-cover border border-gray-100 dark:border-gray-700" />
                            )}
                            {h.evaluation_url && (
                              <StorageImage url={h.evaluation_url} storageId={h.storage_id} alt="" className="h-8 w-14 rounded object-cover border border-gray-100 dark:border-gray-700" />
                            )}
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>
              )}
            </div>

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
    </div>
  );
}
