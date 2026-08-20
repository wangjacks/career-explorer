"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { ChevronRight, Copy, RefreshCw, FolderPlus } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";

interface ClassItem {
  id: number;
  name: string;
  invitation_code: string;
  created_at: string;
}

interface TeacherClassPair {
  teacher_id: number;
  class_id: number;
}

interface StudentItem {
  id: number;
  user_code: string;
  name: string;
  class_id: number | null;
}

interface TeacherItem {
  id: number;
  name: string;
}

interface Props {
  /** admin = 全权管理；teacher = 可创建，仅可维护自己创建的班级 */
  mode: "admin" | "teacher";
  /** teacher 模式下的当前用户 uid，用于标记「我创建的」 */
  teacherUid?: number | null;
}

export default function ClassesTab({ mode, teacherUid }: Props) {
  const [classes, setClasses] = useState<ClassItem[]>([]);
  const [pairs, setPairs] = useState<TeacherClassPair[]>([]);
  const [students, setStudents] = useState<StudentItem[]>([]);
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState<Set<number>>(new Set());

  // 创建/改名
  const [nameInput, setNameInput] = useState("");
  const [renaming, setRenaming] = useState<ClassItem | null>(null);
  const [renameValue, setRenameValue] = useState("");

  // 确认对话框
  const [deleting, setDeleting] = useState<ClassItem | null>(null);
  const [resetting, setResetting] = useState<ClassItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const [classesRes, studentsRes] = await Promise.all([
        fetch("/api/manage/classes"),
        fetch("/api/manage/students"),
      ]);
      const classesData = await classesRes.json();
      if (!classesRes.ok) throw new Error(classesData.error || "获取班级失败");
      setClasses(classesData.data || []);
      setPairs(classesData.teacher_classes || []);
      if (studentsRes.ok) {
        const studentsData = await studentsRes.json();
        setStudents(studentsData.data || []);
      }
      if (mode === "admin") {
        const teachersRes = await fetch("/api/manage/teachers");
        if (teachersRes.ok) {
          const teachersData = await teachersRes.json();
          setTeachers(teachersData.data || []);
        }
      }
    } catch (err) {
      console.error("Failed to load classes:", err);
      toast.error(err instanceof Error ? err.message : "获取班级失败");
    } finally {
      setLoading(false);
    }
  }, [mode]);

  /* eslint-disable react-hooks/set-state-in-effect -- load on mount */
  useEffect(() => {
    refresh();
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const studentsByClass = useMemo(() => {
    const map = new Map<number, StudentItem[]>();
    for (const s of students) {
      if (s.class_id == null) continue;
      const list = map.get(s.class_id) ?? [];
      list.push(s);
      map.set(s.class_id, list);
    }
    return map;
  }, [students]);

  const creatorName = useCallback(
    (classId: number): string | null => {
      const pair = pairs.find((p) => p.class_id === classId);
      if (!pair) return null;
      if (mode === "teacher") return pair.teacher_id === teacherUid ? "我创建的" : null;
      return teachers.find((t) => t.id === pair.teacher_id)?.name ?? "教师创建";
    },
    [pairs, teachers, mode, teacherUid]
  );

  const canModify = useCallback(
    (classId: number): boolean => {
      if (mode === "admin") return true;
      return pairs.some((p) => p.class_id === classId && p.teacher_id === teacherUid);
    },
    [mode, pairs, teacherUid]
  );

  const createClass = async () => {
    const name = nameInput.trim();
    if (!name) return toast.warning("请输入班级名称");
    try {
      const res = await fetch("/api/manage/classes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      toast.success(`班级「${name}」已创建`);
      setNameInput("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败");
    }
  };

  const renameClass = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return toast.warning("请输入班级名称");
    try {
      const res = await fetch(`/api/manage/classes/${renaming.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "改名失败");
      toast.success("班级已改名");
      setRenaming(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "改名失败");
    }
  };

  const deleteClass = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/manage/classes/${deleting.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      toast.success(`班级「${deleting.name}」已删除`);
      setDeleting(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const resetCode = async () => {
    if (!resetting) return;
    try {
      const res = await fetch(`/api/manage/classes/${resetting.id}/reset-code`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重置失败");
      toast.success(`新邀请码：${data.invitation_code}`);
      setResetting(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重置失败");
    }
  };

  const copyCode = async (code: string) => {
    try {
      await navigator.clipboard.writeText(code);
      toast.success("邀请码已复制");
    } catch {
      toast.error("复制失败，请手动复制");
    }
  };

  const toggleExpand = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  return (
    <div className="space-y-6">
      {/* 创建班级 */}
      <div className="bg-white rounded-xl border border-gray-100 p-5">
        <h3 className="text-sm font-semibold text-gray-800 mb-3">创建班级</h3>
        <div className="flex flex-col sm:flex-row gap-2">
          <input
            value={nameInput}
            onChange={(e) => setNameInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && createClass()}
            placeholder="班级名称，如 2026级1班"
            className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
          />
          <button
            onClick={createClass}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            创建（自动生成邀请码）
          </button>
        </div>
      </div>

      {/* 班级列表 */}
      <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800">班级列表</h3>
          <span className="text-xs text-gray-400">{classes.length} 个班级</span>
        </div>

        {loading ? (
          <p className="p-5 text-sm text-gray-400">加载中...</p>
        ) : classes.length === 0 ? (
          <p className="p-5 text-sm text-gray-400 flex items-center justify-center gap-2">
            <FolderPlus size={18} strokeWidth={1.5} className="text-gray-300" />
            暂无班级，请先创建
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 border-b border-gray-100">
                  <th className="px-5 py-2.5 font-medium w-8"></th>
                  <th className="px-3 py-2.5 font-medium">班级名称</th>
                  <th className="px-3 py-2.5 font-medium">学生数</th>
                  <th className="px-3 py-2.5 font-medium">邀请码</th>
                  <th className="px-3 py-2.5 font-medium hidden md:table-cell">创建时间</th>
                  <th className="px-5 py-2.5 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {classes.map((klass) => {
                  const members = studentsByClass.get(klass.id) ?? [];
                  const isOpen = expanded.has(klass.id);
                  const modifiable = canModify(klass.id);
                  const creator = creatorName(klass.id);
                  return (
                    <FragmentRow
                      key={klass.id}
                      klass={klass}
                      members={members}
                      isOpen={isOpen}
                      modifiable={modifiable}
                      creator={creator}
                      onToggle={() => toggleExpand(klass.id)}
                      onRename={() => {
                        setRenaming(klass);
                        setRenameValue(klass.name);
                      }}
                      onDelete={() => setDeleting(klass)}
                      onReset={() => setResetting(klass)}
                      onCopy={() => copyCode(klass.invitation_code)}
                    />
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 改名弹窗 */}
      {renaming && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setRenaming(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-800 text-lg">班级改名</h3>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && renameClass()}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setRenaming(null)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={renameClass}
                className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="删除班级"
        variant="danger"
        confirmText="删除"
        message={
          <>
            确定删除班级「{deleting?.name}」？该班级下的 {studentsByClass.get(deleting?.id ?? -1)?.length ?? 0} 名学生将变为未分班，此操作不可撤销。
          </>
        }
        onConfirm={deleteClass}
        onCancel={() => setDeleting(null)}
      />

      <ConfirmDialog
        open={resetting !== null}
        title="重置邀请码"
        variant="warning"
        confirmText="重置"
        message={
          <>
            确定重置班级「{resetting?.name}」的邀请码？旧邀请码将立即失效，正在使用该码注册的学生将无法完成注册。
          </>
        }
        onConfirm={resetCode}
        onCancel={() => setResetting(null)}
      />
    </div>
  );
}

function FragmentRow({
  klass,
  members,
  isOpen,
  modifiable,
  creator,
  onToggle,
  onRename,
  onDelete,
  onReset,
  onCopy,
}: {
  klass: ClassItem;
  members: StudentItem[];
  isOpen: boolean;
  modifiable: boolean;
  creator: string | null;
  onToggle: () => void;
  onRename: () => void;
  onDelete: () => void;
  onReset: () => void;
  onCopy: () => void;
}) {
  return (
    <>
      <tr className="border-b border-gray-50 hover:bg-gray-50/60">
        <td className="px-5 py-3">
          <button
            onClick={onToggle}
            className="text-gray-400 hover:text-gray-600"
            aria-label={isOpen ? "收起学生名单" : "展开学生名单"}
          >
            <ChevronRight
              className={`w-3.5 h-3.5 transition-transform ${isOpen ? "rotate-90" : ""}`}
            />
          </button>
        </td>
        <td className="px-3 py-3">
          <span className="font-medium text-gray-800">{klass.name}</span>
          {creator && (
            <span className="ml-2 px-1.5 py-0.5 bg-blue-50 text-blue-500 rounded text-xs">{creator}</span>
          )}
        </td>
        <td className="px-3 py-3 text-gray-600">{members.length} 人</td>
        <td className="px-3 py-3">
          <span className="inline-flex items-center gap-1.5">
            <code className="px-2 py-0.5 bg-gray-100 rounded text-xs font-mono text-gray-700">
              {klass.invitation_code}
            </code>
            <button onClick={onCopy} className="text-gray-400 hover:text-green-600" aria-label="复制邀请码">
              <Copy className="w-3.5 h-3.5" />
            </button>
            {modifiable && (
              <button onClick={onReset} className="text-gray-400 hover:text-amber-600" aria-label="重置邀请码">
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
            )}
          </span>
        </td>
        <td className="px-3 py-3 text-gray-400 text-xs hidden md:table-cell">{klass.created_at}</td>
        <td className="px-5 py-3 text-right whitespace-nowrap">
          {modifiable ? (
            <>
              <button onClick={onRename} className="text-xs text-green-600 hover:underline mr-3">
                改名
              </button>
              <button onClick={onDelete} className="text-xs text-red-500 hover:underline">
                删除
              </button>
            </>
          ) : (
            <span className="text-xs text-gray-300">只读</span>
          )}
        </td>
      </tr>
      {isOpen && (
        <tr className="border-b border-gray-100 bg-gray-50/50">
          <td></td>
          <td colSpan={5} className="px-3 py-3">
            {members.length === 0 ? (
              <p className="text-xs text-gray-400">该班级暂无学生</p>
            ) : (
              <div className="flex flex-wrap gap-1.5">
                {members.map((s) => (
                  <span
                    key={s.id}
                    className="px-2 py-1 bg-white border border-gray-200 rounded text-xs text-gray-600"
                    title={s.user_code}
                  >
                    {s.name}
                    <span className="ml-1 text-gray-300">{s.user_code.slice(-4)}</span>
                  </span>
                ))}
              </div>
            )}
          </td>
        </tr>
      )}
    </>
  );
}
