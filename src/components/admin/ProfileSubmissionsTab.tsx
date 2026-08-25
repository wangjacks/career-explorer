"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { History, TriangleAlert, Trash2 } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import StorageImage from "@/components/StorageImage";

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
  const [cleaning, setCleaning] = useState(false);

  // 学生选择器数据源：已提交档案列表（取第一页 100 条，客户端搜索过滤）
  const loadStudents = useCallback(async () => {
    setStudentLoading(true);
    try {
      const res = await fetch("/api/manage/profiles?page=1&pageSize=100");
      const data = await res.json();
      if (res.ok) setStudents(data.data || []);
      else toast.error(data.error || "学生列表加载失败");
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
    void loadSubmissions(userId);
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

  return (
    <div className="space-y-5">
      {/* 学生选择器 + 版本列表 */}
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <History size={16} className="text-gray-400 dark:text-gray-500" aria-hidden />
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">档案提交历史</h2>
        </div>

        <div className="flex flex-wrap items-center gap-3">
          <input
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="搜索学号/姓名..."
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-green-300"
          />
          <select
            value={selectedUserId ?? ""}
            onChange={(e) => {
              const userId = Number(e.target.value);
              const student = filteredStudents.find((s) => s.userId === userId);
              if (userId > 0 && student) handleSelect(userId, student.studentName);
            }}
            className="px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
          >
            <option value="">{studentLoading ? "加载学生中..." : "选择已提交的学生..."}</option>
            {filteredStudents.map((s) => (
              <option key={s.userId} value={s.userId}>
                {s.studentId} · {s.studentName}
              </option>
            ))}
          </select>
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
                          <span key={tag} className="px-2.5 py-1 rounded-full text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">
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

      {/* 超限学生子面板（#95）：展示超限名单，admin 可手动清理最旧版本 */}
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <TriangleAlert size={16} className="text-amber-500" aria-hidden />
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">超限学生</h2>
          <span className="text-xs text-gray-400 dark:text-gray-500">版本上限 {maxVersions} 条，超出部分仅删除记录（文件保留）</span>
        </div>
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
    </div>
  );
}
