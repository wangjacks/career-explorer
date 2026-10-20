"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { toast } from "sonner";
import { Tag, ChevronDown } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import StorageImage from "@/components/StorageImage";
import { useTagColorMap } from "@/hooks/useTagColorMap";
import { buildRiasecBars } from "@/lib/assessment-view";
import { typeColorOf } from "@/lib/assessment-colors";
import { formatResultTime } from "@/lib/assessment-flow";
import {
  ASSESSMENT_LEAD_FILTERS,
  hasAssessmentScores,
  isAssessed,
  type AssessmentLeadFilter,
} from "@/lib/profile-assessment";
import {
  DEFAULT_PROFILE_SORT,
  PROFILE_QUERY_MAX_LENGTH,
  buildProfilesQueryString,
  hasActiveProfileFilters,
  type ProfileListQuery,
  type ProfileSortKey,
  type SortDir,
} from "@/lib/profile-query";
import type { Stats, PagedData, Profile } from "@/hooks/useAdminAuth";

interface Props {
  /** 可选：由页面/OverviewTab 透传的加载实现（admin 端删除后统计卡联动）；未传时组件内部自 fetch */
  loadProfiles?: (p: number, query?: ProfileListQuery) => Promise<PagedData | null>;
  loadStats?: () => Promise<Stats | null>;
}

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
    <span aria-hidden="true" className={`ml-1 inline-block w-3 text-xs ${active ? "text-green-600" : "text-gray-300"}`}>
      {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

/** 霍兰德三字码徽章（#234）：底色取首位字母的类型色，文字色按对比度取（见 assessment-colors） */
function AssessmentCodeBadge({ code }: { code: string }) {
  const color = typeColorOf(code);
  return (
    <span
      className="inline-block rounded-lg px-2 py-0.5 font-mono text-xs font-semibold"
      style={{ backgroundColor: color.bar, color: color.chipFg }}
      title={`霍兰德三字码 ${code}，首位 ${code.trim().slice(0, 1).toUpperCase()} 为主导型`}
    >
      {code}
    </span>
  );
}

/** 未测胶囊（#234）：灰态、不出现红叉这类否定式样式；文字色深一档保证 AA 对比度 */
function NotAssessedPill() {
  return (
    <span className="inline-block rounded-full bg-gray-100 dark:bg-gray-800 px-2 py-0.5 text-xs text-gray-600 dark:text-gray-400">
      未测
    </span>
  );
}

/** 已提交档案数据列表：分页、搜索、标签筛选、详情查看、单个/批量删除 */
export default function ProfilesTab({ loadProfiles, loadStats }: Props) {
  // 标签三色映射（#95）：详情弹窗版本历史标签按分类着色
  const tagColorMap = useTagColorMap();

  const [stats, setStats] = useState<Stats | null>(null);
  const [paged, setPaged] = useState<PagedData | null>(null);
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [detail, setDetail] = useState<Profile | null>(null);
  const [search, setSearch] = useState("");
  // 搜索防抖（#295）：输入值即时回显，300ms 后才作为服务端查询条件发出
  const [appliedSearch, setAppliedSearch] = useState("");
  const [selectedTags, setSelectedTags] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState<string[] | null>(null);
  const [sortKey, setSortKey] = useState<ProfileSortKey>(DEFAULT_PROFILE_SORT.sortKey);
  const [sortDir, setSortDir] = useState<SortDir>(DEFAULT_PROFILE_SORT.sortDir);
  // 主导型筛选（#234 / #295）：语义 = 三字码首位；与搜索、标签一起下推服务端，跨页生效
  const [leadFilter, setLeadFilter] = useState<AssessmentLeadFilter>("all");
  const [tagDropdownOpen, setTagDropdownOpen] = useState(false);
  const [tagSearch, setTagSearch] = useState("");
  const tagDropdownRef = useRef<HTMLDivElement>(null);
  // 版本历史（#95）：详情弹窗内折叠展示
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyRows, setHistoryRows] = useState<SubmissionHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // 历史请求序号（review 修复）：快速切换学生时丢弃过期响应
  const historySeqRef = useRef(0);
  // 列表请求序号（#295）：快速切换筛选/排序/翻页时丢弃过期响应，见 `refreshProfiles`
  const profilesSeqRef = useRef(0);

  // 弹窗 Escape 关闭（键盘可达性）
  useEscapeKey(!!detail, () => setDetail(null));

  // 保留最新传入的 load 函数引用，初始加载 effect 仅 mount 时执行
  const loadProfilesRef = useRef(loadProfiles);
  const loadStatsRef = useRef(loadStats);

  useEffect(() => {
    loadProfilesRef.current = loadProfiles;
    loadStatsRef.current = loadStats;
  }, [loadProfiles, loadStats]);

  const defaultLoadProfiles = useCallback(async (p: number, query?: ProfileListQuery): Promise<PagedData | null> => {
    try {
      const res = await fetch(`/api/manage/profiles?${buildProfilesQueryString(p, query)}`);
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

  const handleSort = (key: ProfileSortKey) => {
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

  const refreshProfiles = useCallback(
    async (p: number, query?: ProfileListQuery) => {
      // 请求序号（#295 review 修复）：筛选/排序/翻页每次都发服务端请求，慢的旧响应后到时
      // 必须丢弃，否则表格显示旧条件的行与 total、chip 却是新条件（快速连点 I 再点 S 即可触发）
      const seq = ++profilesSeqRef.current;
      const fn = loadProfilesRef.current ?? defaultLoadProfiles;
      const d = await fn(p, query);
      if (!d || seq !== profilesSeqRef.current) return;
      setPaged(d);
    },
    [defaultLoadProfiles]
  );

  // 查询条件（#295）：搜索 / 标签 / 主导型 / 排序；条件变化时回到第 1 页，避免停留在空页
  const query = useMemo<ProfileListQuery>(
    () => ({
      ...(appliedSearch.trim() ? { q: appliedSearch.trim() } : {}),
      ...(selectedTags.size > 0 ? { tags: Array.from(selectedTags).sort() } : {}),
      lead: leadFilter,
      sortKey,
      sortDir,
    }),
    [appliedSearch, selectedTags, leadFilter, sortKey, sortDir]
  );
  const queryKey = useMemo(() => JSON.stringify(query), [query]);
  const lastQueryKeyRef = useRef(queryKey);

  /* eslint-disable react-hooks/set-state-in-effect -- reset selection + load page data on page/query change */
  useEffect(() => {
    const queryChanged = lastQueryKeyRef.current !== queryKey;
    if (queryChanged) {
      lastQueryKeyRef.current = queryKey;
      // 条件变化先回到第 1 页：下一次 effect 用新条件 + 第 1 页拉取，不发两次请求
      if (page !== 1) {
        setPage(1);
        return;
      }
    }
    setSelected(new Set());
    void refreshProfiles(page, query);
  }, [page, query, queryKey, refreshProfiles]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 搜索防抖：输入停止 300ms 后才改生效值（避免每敲一个字打一次接口）
  useEffect(() => {
    const timer = setTimeout(() => setAppliedSearch(search), 300);
    return () => clearTimeout(timer);
  }, [search]);

  useEffect(() => {
    refreshStats();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- only on mount
  }, []);

  // 筛选 / 排序 / 分页都由服务端完成（#295）：当页数据即最终结果，total 是**过滤后**的全校命中数
  const rows = paged?.data ?? [];
  const hasFilter = hasActiveProfileFilters(query);

  // 页码越界自愈（#295）：筛选后结果变少、或删掉最后一页的最后一行时，别把老师留在空页上
  /* eslint-disable react-hooks/set-state-in-effect -- 越界页码只能在拿到服务端 totalPages 后修正 */
  useEffect(() => {
    if (paged && page > 1 && paged.totalPages >= 1 && page > paged.totalPages) {
      setPage(paged.totalPages);
    }
  }, [paged, page]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 表头全选态：按「当前可见行是否全部已选」判定（只比数量在筛选后会误判）
  const allVisibleSelected =
    rows.length > 0 && rows.every((p) => selected.has(p.studentId));

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
      void refreshProfiles(page, query);
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
    const visible = rows;
    // 以「当前可见行是否全部已选」为准：只按数量比较会在筛选后把别人的选择误判成全选
    const allVisibleSelected =
      visible.length > 0 && visible.every((p) => selected.has(p.studentId));
    setSelected((prev) => {
      const next = new Set(prev);
      for (const p of visible) {
        if (allVisibleSelected) next.delete(p.studentId);
        else next.add(p.studentId);
      }
      return next;
    });
  };

  // 加载版本历史（#95）：首次展开详情弹窗时拉取；序号 guard 防旧响应覆盖新选择
  const loadHistory = async (userId: number) => {
    const seq = ++historySeqRef.current;
    setHistoryLoading(true);
    try {
      const res = await fetch(`/api/manage/profiles/submissions?userId=${userId}`);
      const data = await res.json();
      if (seq !== historySeqRef.current) return;
      if (res.ok) setHistoryRows(data.submissions || []);
    } catch (err) {
      if (seq !== historySeqRef.current) return;
      console.error("Failed to load submission history:", err);
    } finally {
      if (seq === historySeqRef.current) setHistoryLoading(false);
    }
  };

  const openDetail = (p: Profile) => {
    setDetail(p);
    setHistoryOpen(false);
    setHistoryRows([]);
    if (p.userId != null) void loadHistory(p.userId);
  };

  return (
    <div className="bg-card rounded-xl border border-border-soft">
      <div className="px-5 py-4 border-b border-border-soft flex flex-col gap-3">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-foreground">
            数据列表 {paged && `(${paged.total} 条${hasFilter ? " · 已筛选" : ""})`}
          </h2>
          {selected.size > 0 && (
            <button
              onClick={() => setConfirmDelete(Array.from(selected))}
              className="px-4 py-1.5 bg-danger hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
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
            maxLength={PROFILE_QUERY_MAX_LENGTH}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-focus-ring"
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
                <div className="p-2 border-b border-border-soft">
                  <input
                    type="text"
                    value={tagSearch}
                    onChange={(e) => setTagSearch(e.target.value)}
                    placeholder="搜索标签..."
                    className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
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
          {/* 主导型筛选（#234 / #295）：语义 = 三字码首位（如 SIA 只在 S 下命中），与搜索、标签一起跨页生效 */}
          <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="主导型筛选">
            {ASSESSMENT_LEAD_FILTERS.map(({ value, label }) => {
              const active = leadFilter === value;
              return (
                <button
                  key={value}
                  type="button"
                  aria-pressed={active}
                  // 可见文本只有单字母，读屏需要更完整的名字（R 型之类不出现「型」字）
                  aria-label={value === "all" ? "全部测评状态" : value === "none" ? "未测" : `主导型 ${label}`}
                  // #295 定稿：主导型 = 三字码首位（与数据大屏按首位归型的口径一致），
                  // 不是「包含该字母」，用 tooltip 把这个语义讲清楚
                  title={
                    value === "all"
                      ? "不按兴趣类型筛选"
                      : value === "none"
                        ? "未完成测评（或三字码无效）"
                        : `按三字码首位（主导型）筛选 ${label}，如 SIA 只在 S 下命中`
                  }
                  onClick={() => setLeadFilter(value)}
                  className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-xs font-medium transition-colors ${
                    active
                      ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 border-green-200 dark:border-green-800"
                      : "bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-gray-300"
                  }`}
                >
                  {value !== "all" && value !== "none" && (
                    <span
                      aria-hidden="true"
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: typeColorOf(value).bar }}
                    />
                  )}
                  {label}
                </button>
              );
            })}
          </div>
          {(selectedTags.size > 0 || search || leadFilter !== "all" || hasFilter) && (
            <button
              onClick={() => { setSelectedTags(new Set()); setSearch(""); setAppliedSearch(""); setLeadFilter("all"); }}
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
            <tr className="bg-gray-50 dark:bg-gray-800 text-left text-muted">
              <th className="px-5 py-3 font-medium w-10">
                <input
                  type="checkbox"
                  aria-label="全选档案"
                  checked={allVisibleSelected}
                  onChange={toggleSelectAll}
                  className="rounded border-gray-300"
                />
              </th>
              <th aria-sort={sortKey === "studentId" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="px-5 py-3 font-medium">
                <button type="button" onClick={() => handleSort("studentId")} className="cursor-pointer select-none">学号<SortIcon active={sortKey === "studentId"} dir={sortDir} /></button>
              </th>
              <th aria-sort={sortKey === "studentName" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="px-5 py-3 font-medium">
                <button type="button" onClick={() => handleSort("studentName")} className="cursor-pointer select-none">姓名<SortIcon active={sortKey === "studentName"} dir={sortDir} /></button>
              </th>
              <th className="px-5 py-3 font-medium">虚拟形象</th>
              <th className="px-5 py-3 font-medium">评价词云</th>
              <th className="px-5 py-3 font-medium">标签</th>
              <th className="px-5 py-3 font-medium">兴趣测评</th>
              <th aria-sort={sortKey === "createdAt" ? (sortDir === "asc" ? "ascending" : "descending") : "none"} className="px-5 py-3 font-medium">
                <button type="button" onClick={() => handleSort("createdAt")} className="cursor-pointer select-none">提交时间<SortIcon active={sortKey === "createdAt"} dir={sortDir} /></button>
              </th>
              <th className="px-5 py-3 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {rows.map((p) => (
              <tr
                key={p.studentId}
                className={`hover:bg-gray-50/50 dark:hover:bg-gray-800/40 ${selected.has(p.studentId) ? "bg-blue-50/30 dark:bg-blue-900/20" : ""}`}
              >
                <td className="px-5 py-3">
                  <input
                    type="checkbox"
                    aria-label={`选择 ${p.studentName || p.studentId}`}
                    checked={selected.has(p.studentId)}
                    onChange={() => toggleSelect(p.studentId)}
                    className="rounded border-gray-300"
                  />
                </td>
                <td className="px-5 py-3 font-mono text-xs text-gray-600 dark:text-gray-300">{p.studentId}</td>
                <td className="px-5 py-3 text-gray-700 dark:text-gray-200">{p.studentName || "-"}</td>
                <td className="px-5 py-3">
                  {p.avatarUrl ? (
                    <StorageImage url={p.avatarUrl} storageId={p.storageId} alt="" thumbnail className="w-8 h-8 rounded-full object-cover" />
                  ) : (
                    <span className="text-gray-400 text-xs">无</span>
                  )}
                </td>
                <td className="px-5 py-3">
                  {p.evaluationUrl ? (
                    <StorageImage url={p.evaluationUrl} storageId={p.storageId} alt="" thumbnail className="w-8 h-8 rounded object-cover" />
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
                <td className="px-5 py-3">
                  {isAssessed(p) ? (
                    <AssessmentCodeBadge code={p.assessmentCode as string} />
                  ) : (
                    <NotAssessedPill />
                  )}
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
            {/* 首屏加载中 / 加载失败（paged 仍为 null）不渲染空态提示，避免把「还没取到」说成「没有数据」 */}
            {paged && rows.length === 0 && (
              <tr>
                <td colSpan={9} className="px-5 py-12 text-center text-gray-400">
                  {hasFilter ? "没有匹配的档案（筛选已跨页生效）" : "暂无数据"}
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {paged && paged.totalPages > 1 && (
        <div className="px-5 py-3 border-t border-border-soft flex items-center justify-between text-sm">
          <span className="text-muted">第 {paged.page}/{paged.totalPages} 页</span>
          <div className="flex gap-2">
            <button onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1}
              className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">上一页</button>
            <button onClick={() => setPage((p) => Math.min(paged.totalPages, p + 1))} disabled={page >= paged.totalPages}
              className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800">下一页</button>
          </div>
        </div>
      )}

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setDetail(null)}>
          <div role="dialog" aria-modal="true" aria-labelledby="profiles-detail-title" className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 id="profiles-detail-title" className="font-semibold text-foreground text-lg">档案详情</h3>
              <button onClick={() => setDetail(null)} aria-label="关闭" className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 text-xl">×</button>
            </div>

            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <p className="text-xs text-muted">学号</p>
                <p className="font-mono font-medium text-foreground mt-0.5">{detail.studentId}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3">
                <p className="text-xs text-muted">姓名</p>
                <p className="font-medium text-foreground mt-0.5">{detail.studentName || "-"}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-3 col-span-2">
                <p className="text-xs text-muted">提交时间</p>
                <p className="font-medium text-foreground mt-0.5">{detail.createdAt}</p>
              </div>
            </div>

            {detail.avatarUrl && (
              <div>
                <p className="text-xs text-muted mb-2">虚拟形象</p>
                <StorageImage url={detail.avatarUrl} storageId={detail.storageId} alt="" className="w-20 h-20 rounded-xl object-cover border border-gray-100" />
              </div>
            )}

            <div>
              <p className="text-xs text-muted mb-2">标签（{detail.tags.length}个）</p>
              <div className="flex flex-wrap gap-1.5">
                {detail.tags.map((t) => (
                  <span key={t} className="px-2.5 py-1 bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300 rounded-full text-xs font-medium">{t}</span>
                ))}
              </div>
            </div>

            {detail.evaluationUrl && (
              <div>
                <p className="text-xs text-muted mb-2">评价词云</p>
                <StorageImage url={detail.evaluationUrl} storageId={detail.storageId} alt="" className="w-full rounded-xl border border-gray-100" />
              </div>
            )}

            {/* 职业兴趣测评（#234）：未测时整块不渲染；条形口径与结果页一致（buildRiasecBars） */}
            {isAssessed(detail) && (
              <div className="border-t border-border-soft pt-3" role="group" aria-label="职业兴趣测评">
                <div className="flex items-center justify-between">
                  <p className="text-sm font-medium text-foreground">职业兴趣测评</p>
                  <span className="text-[11px] text-muted">
                    {formatResultTime(detail.assessmentAt) || "完成时间未记录"}
                  </span>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <AssessmentCodeBadge code={detail.assessmentCode as string} />
                  <span className="text-[11px] text-muted">霍兰德三字码 · 首位即主导型</span>
                </div>
                {hasAssessmentScores(detail) && (() => {
                  const bars = buildRiasecBars(detail.assessmentScores ?? [], detail.assessmentCode);
                  return (
                    <div className="mt-3 space-y-1.5">
                      {bars.map((bar) => (
                        <div key={bar.key} className="flex items-center gap-2">
                          <span className="w-24 flex-shrink-0 text-xs text-muted">
                            {bar.key} · {bar.label}
                            {bar.isTop && (
                              <span className="ml-1 rounded bg-green-50 px-1 py-0.5 text-[9px] text-green-600 dark:bg-green-900/30 dark:text-green-400">
                                主要
                              </span>
                            )}
                          </span>
                          <div className="h-2 flex-1 overflow-hidden rounded-full bg-gray-100 dark:bg-gray-800">
                            <div
                              className="h-full rounded-full"
                              style={{ width: `${bar.percent}%`, backgroundColor: typeColorOf(bar.key).bar }}
                            />
                          </div>
                          {/* 与学生端报告一致：保留一位小数，而不是四舍五入成整数 */}
                          <span className="w-10 flex-shrink-0 text-right font-mono text-xs text-muted">
                            {bar.standard.toFixed(1)}
                          </span>
                        </div>
                      ))}
                    </div>
                  );
                })()}
                <p className="mt-2 text-[11px] leading-5 text-muted">
                  需要重测时，请该生登录后进入「职业测评」重新作答：每次提交都会生成新的当前报告，旧版本保留可查。
                </p>
              </div>
            )}

            {/* 版本历史（#95）：折叠展示，打开详情时已预取 */}
            <div className="border-t border-border-soft pt-3">
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
                      <div key={h.id} className="border border-border-soft rounded-lg p-2.5 space-y-1.5">
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
                              <span key={t} className={`px-1.5 py-0.5 rounded text-[10px] ${tagColorMap.get(t) ?? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"}`}>
                                {t}
                              </span>
                            ))
                          )}
                        </div>
                        {(h.avatar_url || h.evaluation_url) && (
                          <div className="flex gap-1.5">
                            {h.avatar_url && (
                              <StorageImage url={h.avatar_url} storageId={h.storage_id} alt="" className="w-8 h-8 rounded object-cover border border-border-soft" />
                            )}
                            {h.evaluation_url && (
                              <StorageImage url={h.evaluation_url} storageId={h.storage_id} alt="" className="h-8 w-14 rounded object-cover border border-border-soft" />
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
                className="flex-1 py-2 bg-danger hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors">
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
