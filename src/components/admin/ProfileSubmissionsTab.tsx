"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, History, TriangleAlert, Trash2, Users, X } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import StorageImage from "@/components/StorageImage";
import { useTagColorMap } from "@/hooks/useTagColorMap";

interface ProfileSummary {
  userId?: number;
  studentId: string;
  studentName: string;
}

interface SubmissionItem {
  id: number;
  version: number;
  tags: string[];
  avatar_url: string;
  evaluation_url: string;
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

interface ExceedRow {
  user_id: number;
  user_code: string;
  name: string;
  class_id: number | null;
  version_count: number;
}

/** 档案提交历史管理（#95）：学生选择器 + 版本列表 + 超限学生子面板（仅 admin 可清理） */
export default function ProfileSubmissionsTab() {
  // 标签三色映射（#95）：历史版本标签按分类着色，与「我的标签」展示态一致
  const tagColorMap = useTagColorMap();

  const [students, setStudents] = useState<ProfileSummary[]>([]);
  const [studentLoading, setStudentLoading] = useState(false);
  const [search, setSearch] = useState("");
  const [selectedUserId, setSelectedUserId] = useState<number | null>(null);
  const [selectedName, setSelectedName] = useState("");
  const [submissions, setSubmissions] = useState<SubmissionItem[]>([]);
  const [subLoading, setSubLoading] = useState(false);
  const [exceeding, setExceeding] = useState<ExceedRow[]>([]);
  const [maxVersions, setMaxVersions] = useState(10);
  const [confirmCleanup, setConfirmCleanup] = useState<ExceedRow | null>(null);
  const [confirmCleanupAll, setConfirmCleanupAll] = useState(false);
  const [cleaning, setCleaning] = useState(false);
  // 学生选择器：按钮 + 弹出面板（搜索 + 列表），样式与标签筛选下拉一致
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);

  // 学生选择器数据源：分页拉取全部已提交学生（pageSize=100 循环至 total），客户端搜索过滤
  const loadStudents = useCallback(async () => {
    setStudentLoading(true);
    try {
      const all: ProfileSummary[] = [];
      let page = 1;
      let total = 0;
      do {
        const res = await fetch(`/api/manage/profiles?page=${page}&pageSize=100`);
        const data = await res.json();
        if (!res.ok) {
          toast.error(data.error || "学生列表加载失败");
          break;
        }
        all.push(...(data.data || []));
        total = data.total || 0;
        page += 1;
      } while (all.length < total && page <= 50); // 防御性上限，避免异常死循环
      setStudents(all);
    } catch (err) {
      console.error("Failed to load students:", err);
      toast.error("学生列表加载失败");
    } finally {
      setStudentLoading(false);
    }
  }, []);

  const loadExceeding = useCallback(async () => {
    try {
      const res = await fetch("/api/manage/profiles/submissions/exceeding");
      const data = await res.json();
      if (res.ok) {
        setExceeding(data.students || []);
        setMaxVersions(data.maxVersions);
      }
    } catch (err) {
      console.error("Failed to load exceeding:", err);
    }
  }, []);

  const loadSubmissions = useCallback(async (userId: number) => {
    setSubLoading(true);
    try {
      const res = await fetch(`/api/manage/profiles/submissions?userId=${userId}`);
      const data = await res.json();
      if (res.ok) setSubmissions(data.submissions || []);
      else toast.error(data.error || "历史记录加载失败");
    } catch (err) {
      console.error("Failed to load submissions:", err);
      toast.error("历史记录加载失败");
    } finally {
      setSubLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- initial data load */
  useEffect(() => {
    loadStudents();
    loadExceeding();
  }, [loadStudents, loadExceeding]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 点击外部关闭学生选择器
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (pickerRef.current && !pickerRef.current.contains(e.target as Node)) {
        setPickerOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return students;
    return students.filter(
      (s) =>
        s.studentId.toLowerCase().includes(q) ||
        s.studentName.toLowerCase().includes(q)
    );
  }, [students, search]);

  const handleSelect = (userId: number, name: string) => {
    setSelectedUserId(userId);
    setSelectedName(name);
    setSubmissions([]);
    setPickerOpen(false);
    void loadSubmissions(userId);
  };

  const handleClear = () => {
    setSelectedUserId(null);
    setSelectedName("");
    setSubmissions([]);
  };

  const handleCleanup = async (row: ExceedRow) => {
    setCleaning(true);
    try {
      const res = await fetch("/api/manage/profiles/submissions/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userId: row.user_id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "清理失败");
      toast.success(`已清理 ${data.deleted} 条最旧版本`);
      if (selectedUserId === row.user_id) void loadSubmissions(row.user_id);
      void loadExceeding();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清理失败");
    } finally {
      setCleaning(false);
      setConfirmCleanup(null);
    }
  };

  // 一键清理全部超限学生（spec：清理所有学生的超限版本）
  const handleCleanupAll = async () => {
    setCleaning(true);
    try {
      const res = await fetch("/api/manage/profiles/submissions/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "清理失败");
      toast.success(`已清理 ${data.studentsAffected} 名学生的 ${data.deleted} 条最旧版本`);
      if (selectedUserId !== null) void loadSubmissions(selectedUserId);
      void loadExceeding();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清理失败");
    } finally {
      setCleaning(false);
      setConfirmCleanupAll(false);
    }
  };

  return (
    <div className="space-y-5">
      {/* 学生选择器 + 版本列表 */}
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <History size={16} className="text-gray-400 dark:text-gray-500" aria-hidden />
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">档案提交历史</h2>
        </div>

        {/* 学生选择器：按钮 + 弹出面板（搜索 + 列表） */}
        <div className="relative" ref={pickerRef}>
          {/* 组合按钮外观由 div 承载，内部为两个兄弟 button（避免 button 嵌套导致 hydration 错误） */}
          <div
            className={`rounded-lg border transition-colors flex items-stretch overflow-hidden ${
              selectedUserId !== null
                ? "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-800"
                : "bg-card border-gray-200 dark:border-gray-700"
            }`}
          >
            <button
              onClick={() => setPickerOpen((v) => !v)}
              className={`px-3 py-2 text-sm font-medium transition-colors flex items-center gap-1.5 flex-1 min-w-0 ${
                selectedUserId !== null
                  ? "text-green-700 dark:text-green-300 hover:bg-green-100/60 dark:hover:bg-green-900/40"
                  : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
              }`}
            >
              <Users className="w-4 h-4 flex-shrink-0" strokeWidth={1.5} />
              <span className="max-w-56 truncate">
                {selectedUserId !== null ? `${selectedName}（${students.find((s) => s.userId === selectedUserId)?.studentId ?? ""}）` : "选择已提交的学生..."}
              </span>
              <ChevronDown className={`w-3 h-3 flex-shrink-0 transition-transform ${pickerOpen ? "rotate-180" : ""}`} />
            </button>
            {selectedUserId !== null && (
              <button
                onClick={handleClear}
                aria-label="清除选择"
                className={`px-2.5 py-2 transition-colors border-l ${
                  "border-green-200 dark:border-green-800 text-green-700 dark:text-green-300 hover:bg-green-100/60 dark:hover:bg-green-900/40"
                }`}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
          {pickerOpen && (
            <div className="absolute top-full left-0 mt-1 w-80 bg-card rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg z-30">
              <div className="p-2 border-b border-gray-100 dark:border-gray-700">
                <input
                  type="text"
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  placeholder="搜索学号/姓名..."
                  className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  autoFocus
                />
              </div>
              <div className="max-h-64 overflow-y-auto py-1">
                {studentLoading && students.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-gray-400">加载中...</div>
                ) : filteredStudents.length === 0 ? (
                  <div className="px-3 py-4 text-center text-sm text-gray-400">无匹配学生</div>
                ) : (
                  /* 只渲染前 10 个（大名单时避免卡顿），底部提示剩余数量 */
                  filteredStudents.slice(0, 10).map((s) => (
                    <button
                      key={s.userId}
                      onClick={() => s.userId != null && handleSelect(s.userId, s.studentName)}
                      className={`w-full text-left px-3 py-2 text-sm flex items-center gap-2 transition-colors ${
                        selectedUserId === s.userId
                          ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                          : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                      }`}
                    >
                      <span className="font-mono text-xs">{s.studentId}</span>
                      <span className="truncate">{s.studentName}</span>
                      {selectedUserId === s.userId && <span className="ml-auto text-xs">✓</span>}
                    </button>
                  ))
                )}
              </div>
              <div className="px-3 py-1.5 border-t border-gray-100 dark:border-gray-700 text-[10px] text-gray-400">
                共 {students.length} 名已提交学生
                {filteredStudents.length > 10 && `，匹配 ${filteredStudents.length} 名，仅显示前 10 个，可输入学号/姓名精确查找`}
              </div>
            </div>
          )}
        </div>

        {selectedUserId !== null && (
          <div className="space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">
              {selectedName} 的提交历史（{submissions.length} 个版本）
            </p>
            {subLoading ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">加载中...</p>
            ) : submissions.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">暂无版本记录</p>
            ) : (
              <ul className="space-y-2">
                {submissions.map((s) => (
                  <li key={s.id} className="border border-gray-100 dark:border-gray-700 rounded-lg p-3 space-y-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className="text-sm font-semibold text-gray-800 dark:text-gray-100">版本 {s.version}</span>
                      {s.is_current === 1 ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
                          当前版本
                        </span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                          历史版本
                        </span>
                      )}
                      <span className="ml-auto text-xs text-gray-400 dark:text-gray-500">{s.submitted_at}</span>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      {s.tags.length === 0 ? (
                        <span className="text-xs text-gray-400 dark:text-gray-500">暂无标签</span>
                      ) : (
                        s.tags.map((tag) => (
                          <span key={tag} className={`px-2.5 py-1 rounded-full text-xs ${tagColorMap.get(tag) ?? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"}`}>
                            {tag}
                          </span>
                        ))
                      )}
                    </div>
                    {(s.avatar_url || s.evaluation_url) && (
                      <div className="flex gap-2">
                        {s.avatar_url && (
                          <StorageImage url={s.avatar_url} storageId={s.storage_id} alt={`版本 ${s.version} 头像`} className="w-12 h-12 rounded-lg object-cover border border-gray-100 dark:border-gray-700" />
                        )}
                        {s.evaluation_url && (
                          <StorageImage url={s.evaluation_url} storageId={s.storage_id} alt={`版本 ${s.version} 评价词云`} className="h-12 w-20 rounded-lg object-cover border border-gray-100 dark:border-gray-700" />
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>

      {/* 超限学生子面板（#95）：展示超限名单，admin 可手动清理最旧版本
          每次提交会自动清理超限；仅在调低版本上限后，存量学生可能超限并在此浮现 */}
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center gap-2 flex-wrap">
          <TriangleAlert size={16} className="text-amber-500" aria-hidden />
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">超限学生</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">版本上限 {maxVersions} 条，超出部分仅删除记录（文件保留）</span>
          {exceeding.length > 0 && (
            <button
              onClick={() => setConfirmCleanupAll(true)}
              disabled={cleaning}
              className="ml-auto px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
            >
              <Trash2 className="w-3.5 h-3.5" aria-hidden />
              一键清理全部（{exceeding.length} 名）
            </button>
          )}
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          每次提交时会自动清理超限版本，正常情况下此处为空；仅当调低「功能设置」中的版本上限后，存量学生可能超限并在此列出，可单个或一键清理。
        </p>
        {exceeding.length === 0 ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">暂无超限学生</p>
        ) : (
          <ul className="space-y-2">
            {exceeding.map((row) => (
              <li key={row.user_id} className="flex items-center gap-3 border border-gray-100 dark:border-gray-700 rounded-lg px-3 py-2">
                <div className="flex-1 min-w-0">
                  <p className="text-sm text-gray-800 dark:text-gray-100 truncate">
                    {row.name} <span className="font-mono text-xs text-gray-400">({row.user_code})</span>
                  </p>
                  <p className="text-xs text-amber-600 dark:text-amber-400">{row.version_count} 个版本（超限 {row.version_count - maxVersions} 条）</p>
                </div>
                <button
                  onClick={() => setConfirmCleanup(row)}
                  disabled={cleaning}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  清理至上限
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmCleanup}
        title="确认清理"
        variant="warning"
        confirmText="确认清理"
        message={
          confirmCleanup
            ? `将删除 ${confirmCleanup.name}（${confirmCleanup.user_code}）最旧的 ${confirmCleanup.version_count - maxVersions} 条版本记录（仅删除记录，图片文件保留）。确定继续吗？`
            : ""
        }
        onConfirm={() => confirmCleanup && handleCleanup(confirmCleanup)}
        onCancel={() => setConfirmCleanup(null)}
      />

      <ConfirmDialog
        open={confirmCleanupAll}
        title="确认一键清理"
        variant="warning"
        confirmText="确认清理"
        message={`将删除全部 ${exceeding.length} 名超限学生的超限版本记录（仅删除记录，图片文件保留）。确定继续吗？`}
        onConfirm={handleCleanupAll}
        onCancel={() => setConfirmCleanupAll(false)}
      />
    </div>
  );
}
