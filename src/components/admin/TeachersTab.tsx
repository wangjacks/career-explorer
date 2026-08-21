"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import ConfirmDialog from "./ConfirmDialog";
import { generatePassword } from "@/lib/password";

interface TeacherItem {
  id: number;
  user_code: string;
  name: string;
  created_at: string;
}

/** 密码输入框：支持自动生成 + 手动输入/修改 */
function PasswordField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="至少 8 位密码"
        className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300"
      />
      <button
        type="button"
        onClick={() => onChange(generatePassword())}
        className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm rounded-lg transition-colors whitespace-nowrap"
      >
        自动生成
      </button>
    </div>
  );
}

/** 创建/重置成功后的一次性凭据展示弹窗（关闭后不再可见） */
function CredentialsDialog({
  title,
  code,
  password,
  onClose,
}: {
  title: string;
  code: string;
  password: string;
  onClose: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-lg">{title}</h3>
        <p className="text-xs text-amber-600">请立即记录并告知教师，关闭后将无法再次查看密码。</p>
        <div className="space-y-2 text-sm">
          <div className="flex justify-between items-center bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
            <span className="text-gray-500 dark:text-gray-400">编号</span>
            <code className="font-mono font-medium text-gray-800 dark:text-gray-100">{code}</code>
          </div>
          <div className="flex justify-between items-center bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2">
            <span className="text-gray-500 dark:text-gray-400">密码</span>
            <code className="font-mono font-medium text-gray-800 dark:text-gray-100">{password}</code>
          </div>
        </div>
        <button
          onClick={onClose}
          className="w-full py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
        >
          我已记录
        </button>
      </div>
    </div>
  );
}

export default function TeachersTab() {
  const [teachers, setTeachers] = useState<TeacherItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 创建表单
  const [newCode, setNewCode] = useState("");
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");

  // 弹窗状态
  const [credentials, setCredentials] = useState<{ title: string; code: string; password: string } | null>(null);
  const [resetting, setResetting] = useState<TeacherItem | null>(null);
  const [resetPassword, setResetPassword] = useState("");
  const [renaming, setRenaming] = useState<TeacherItem | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [deleting, setDeleting] = useState<TeacherItem | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/manage/teachers");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取教师列表失败");
      setTeachers(data.data || []);
    } catch (err) {
      console.error("Failed to load teachers:", err);
      toast.error(err instanceof Error ? err.message : "获取教师列表失败");
    } finally {
      setLoading(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- load on mount */
  useEffect(() => {
    refresh();
  }, [refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const createTeacher = async () => {
    const code = newCode.trim();
    const name = newName.trim();
    if (!/^\d{8}$/.test(code)) return toast.warning("教师编号须为 8 位数字");
    if (!name) return toast.warning("请输入姓名");
    if (newPassword.length < 8) return toast.warning("密码须至少 8 位（可点「自动生成」）");
    try {
      const res = await fetch("/api/manage/teachers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode: code, name, password: newPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "创建失败");
      setCredentials({ title: "教师账户已创建", code, password: newPassword });
      setNewCode("");
      setNewName("");
      setNewPassword("");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "创建失败");
    }
  };

  const resetPasswordSubmit = async () => {
    if (!resetting) return;
    if (resetPassword.length < 8) return toast.warning("密码须至少 8 位（可点「自动生成」）");
    try {
      const res = await fetch(`/api/manage/teachers/${resetting.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: resetPassword }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "重置失败");
      setCredentials({ title: "密码已重置", code: resetting.user_code, password: resetPassword });
      setResetting(null);
      setResetPassword("");
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "重置失败");
    }
  };

  const renameTeacher = async () => {
    if (!renaming) return;
    const name = renameValue.trim();
    if (!name) return toast.warning("请输入姓名");
    try {
      const res = await fetch(`/api/manage/teachers/${renaming.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "改名失败");
      toast.success("已改名");
      setRenaming(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "改名失败");
    }
  };

  const deleteTeacher = async () => {
    if (!deleting) return;
    try {
      const res = await fetch(`/api/manage/teachers/${deleting.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      toast.success(`教师「${deleting.name}」已删除`);
      setDeleting(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  return (
    <div className="space-y-6">
      {/* 创建教师 */}
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5">
        <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100 mb-3">创建教师账户</h3>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">教师编号（8 位数字）</label>
            <input
              value={newCode}
              onChange={(e) => setNewCode(e.target.value)}
              placeholder="如 10000001"
              maxLength={8}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">姓名</label>
            <input
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="教师姓名"
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">初始密码</label>
            <PasswordField value={newPassword} onChange={setNewPassword} />
          </div>
        </div>
        <button
          onClick={createTeacher}
          className="mt-3 px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
        >
          创建教师
        </button>
      </div>

      {/* 教师列表 */}
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 overflow-hidden">
        <div className="px-5 py-4 border-b border-gray-100 dark:border-gray-700 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-100">教师列表</h3>
          <span className="text-xs text-gray-400 dark:text-gray-500">{teachers.length} 名教师</span>
        </div>

        {loading ? (
          <p className="p-5 text-sm text-gray-400 dark:text-gray-500">加载中...</p>
        ) : teachers.length === 0 ? (
          <p className="p-5 text-sm text-gray-400 dark:text-gray-500">暂无教师账户</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-gray-400 dark:text-gray-500 border-b border-gray-100 dark:border-gray-700">
                  <th className="px-5 py-2.5 font-medium">编号</th>
                  <th className="px-3 py-2.5 font-medium">姓名</th>
                  <th className="px-3 py-2.5 font-medium hidden md:table-cell">创建时间</th>
                  <th className="px-5 py-2.5 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {teachers.map((t) => (
                  <tr key={t.id} className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/60 dark:hover:bg-gray-800/40">
                    <td className="px-5 py-3 font-mono text-gray-700 dark:text-gray-300">{t.user_code}</td>
                    <td className="px-3 py-3 font-medium text-gray-800 dark:text-gray-100">{t.name}</td>
                    <td className="px-3 py-3 text-gray-400 dark:text-gray-500 text-xs hidden md:table-cell">{t.created_at}</td>
                    <td className="px-5 py-3 text-right whitespace-nowrap">
                      <button
                        onClick={() => {
                          setRenaming(t);
                          setRenameValue(t.name);
                        }}
                        className="text-xs text-green-600 hover:underline mr-3"
                      >
                        改名
                      </button>
                      <button
                        onClick={() => {
                          setResetting(t);
                          setResetPassword("");
                        }}
                        className="text-xs text-amber-600 hover:underline mr-3"
                      >
                        重置密码
                      </button>
                      <button
                        onClick={() => setDeleting(t)}
                        className="text-xs text-red-500 hover:underline"
                      >
                        删除
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 重置密码弹窗 */}
      {resetting && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setResetting(null)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-lg">重置密码 — {resetting.name}</h3>
            <PasswordField value={resetPassword} onChange={setResetPassword} />
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setResetting(null)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={resetPasswordSubmit}
                className="flex-1 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
              >
                重置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 改名弹窗 */}
      {renaming && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setRenaming(null)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-lg">教师改名</h3>
            <input
              value={renameValue}
              onChange={(e) => setRenameValue(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && renameTeacher()}
              className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setRenaming(null)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={renameTeacher}
                className="flex-1 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleting !== null}
        title="删除教师"
        variant="danger"
        confirmText="删除"
        message={
          <>
            确定删除教师「{deleting?.name}」（{deleting?.user_code}）？该教师创建的班级将保留，但创建者关联会被清除，此操作不可撤销。
          </>
        }
        onConfirm={deleteTeacher}
        onCancel={() => setDeleting(null)}
      />

      {credentials && (
        <CredentialsDialog
          title={credentials.title}
          code={credentials.code}
          password={credentials.password}
          onClose={() => setCredentials(null)}
        />
      )}
    </div>
  );
}
