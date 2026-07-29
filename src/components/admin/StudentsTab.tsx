"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Field } from "./AdminUI";
import ConfirmDialog from "./ConfirmDialog";
import type { Student } from "@/hooks/useAdminAuth";

interface Props {
  students: Student[];
  loadError?: boolean;
  onRetry?: () => void;
  onStudentsChanged: () => void;
}

type SortKey = "student_id" | "name" | "class_name";
type SortDir = "asc" | "desc";

function SortIcon({ active, dir }: { active: boolean; dir: SortDir }) {
  return (
    <span className={`ml-1 inline-block w-3 text-xs ${active ? "text-green-600" : "text-gray-300"}`}>
      {active ? (dir === "asc" ? "↑" : "↓") : "↕"}
    </span>
  );
}

export default function StudentsTab({ students, loadError, onRetry, onStudentsChanged }: Props) {
  const [newStudentId, setNewStudentId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [newClassName, setNewClassName] = useState("");
  const [classList, setClassList] = useState<string[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());

  // Search & sort
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("student_id");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // Edit modal
  const [editing, setEditing] = useState<Student | null>(null);
  const [editName, setEditName] = useState("");
  const [editClass, setEditClass] = useState("");

  // Inline edit
  const [inlineEdit, setInlineEdit] = useState<{ studentId: string; field: "name" | "class_name"; value: string } | null>(null);

  // Confirm dialog
  const [confirmDelete, setConfirmDelete] = useState<{ ids: string[] } | null>(null);
  const [confirmBatchDelete, setConfirmBatchDelete] = useState(false);
  const [confirmBatchClass, setConfirmBatchClass] = useState(false);
  const [batchClassName, setBatchClassName] = useState("");

  const batchInputRef = useRef<HTMLTextAreaElement>(null);

  const refreshClasses = async () => {
    try {
      const res = await fetch("/api/admin/students/classes");
      if (res.ok) {
        const data = await res.json();
        setClassList(data.data || []);
      }
    } catch { /* ignore */ }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshClasses(); }, []);

  // Filtered + sorted students
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = students;
    if (q) {
      list = students.filter((s) =>
        s.student_id.toLowerCase().includes(q) ||
        s.name.toLowerCase().includes(q) ||
        (s.class_name || "").toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const va = a[sortKey] || "";
      const vb = b[sortKey] || "";
      const cmp = va.localeCompare(vb, "zh-CN");
      return sortDir === "asc" ? cmp : -cmp;
    });
  }, [students, search, sortKey, sortDir]);

  const handleSort = (key: SortKey) => {
    if (sortKey === key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir("asc");
    }
  };

  const handleAddStudent = async () => {
    if (!/^\d{12}$/.test(newStudentId)) {
      toast.warning("学号必须为12位数字");
      return;
    }
    if (!newStudentName.trim()) {
      toast.warning("请输入姓名");
      return;
    }
    try {
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: newStudentId, name: newStudentName.trim(), className: newClassName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success("添加成功");
      setNewStudentId("");
      setNewStudentName("");
      setNewClassName("");
      onStudentsChanged();
      refreshClasses();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "添加失败");
    }
  };

  const handleBatchImport = async () => {
    const text = batchInputRef.current?.value || "";
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) {
      toast.warning("请输入学生数据");
      return;
    }

    const idKeywords = ["学号", "student_id", "studentid", "学籍号", "编号", "id"];
    const nameKeywords = ["姓名", "name", "名字", "学生姓名", "student_name"];
    const classKeywords = ["班级", "class", "classname", "班"];

    const firstCells = lines[0].split(/[,，\t]/).map((s) => s.trim().toLowerCase());
    let idCol = -1, nameCol = -1, classCol = -1;
    for (let i = 0; i < firstCells.length; i++) {
      if (idCol === -1 && idKeywords.some((k) => firstCells[i] === k)) idCol = i;
      if (nameCol === -1 && nameKeywords.some((k) => firstCells[i] === k)) nameCol = i;
      if (classCol === -1 && classKeywords.some((k) => firstCells[i] === k)) classCol = i;
    }

    const hasHeader = idCol !== -1 || nameCol !== -1 || classCol !== -1;
    const dataLines = hasHeader ? lines.slice(1) : lines;
    if (idCol === -1) idCol = 0;
    if (nameCol === -1) nameCol = 1;

    const parsed = dataLines.map((line) => {
      const cells = line.split(/[,，\t]/).map((s) => s.trim());
      return {
        studentId: cells[idCol] || "",
        name: cells[nameCol] || "",
        ...(classCol !== -1 ? { className: cells[classCol] || "" } : {}),
      };
    });
    try {
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
      if (batchInputRef.current) batchInputRef.current.value = "";
      onStudentsChanged();
      refreshClasses();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    }
  };

  // Inline edit save
  const saveInlineEdit = async (studentId: string, field: "name" | "class_name", value: string) => {
    setInlineEdit(null);
    try {
      const body = field === "name" ? { studentId, name: value } : { studentId, className: value };
      const res = await fetch("/api/admin/students", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error("更新失败");
      onStudentsChanged();
      refreshClasses();
    } catch {
      toast.error("更新失败");
    }
  };

  // Modal edit save
  const openEditModal = (s: Student) => {
    setEditing(s);
    setEditName(s.name);
    setEditClass(s.class_name || "");
  };

  const saveEditModal = async () => {
    if (!editing) return;
    if (!editName.trim()) {
      toast.warning("姓名不能为空");
      return;
    }
    try {
      const res = await fetch("/api/admin/students", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: editing.student_id, name: editName.trim(), className: editClass.trim() }),
      });
      if (!res.ok) throw new Error("更新失败");
      toast.success("更新成功");
      setEditing(null);
      onStudentsChanged();
      refreshClasses();
    } catch {
      toast.error("更新失败");
    }
  };

  // Delete
  const handleDeleteSingle = (id: string) => setConfirmDelete({ ids: [id] });
  const handleDeleteSelected = () => setConfirmBatchDelete(true);

  const executeDelete = async (ids: string[]) => {
    try {
      const res = await fetch("/api/admin/students", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("删除失败");
      toast.success(`已删除 ${ids.length} 名学生`);
      setSelectedStudents(new Set());
      onStudentsChanged();
    } catch {
      toast.error("删除失败");
    }
  };

  // Batch set class
  const executeBatchSetClass = async () => {
    const ids = Array.from(selectedStudents);
    try {
      await Promise.all(
        ids.map((id) =>
          fetch("/api/admin/students", {
            method: "PUT",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ studentId: id, className: batchClassName }),
          })
        )
      );
      toast.success(`已更新 ${ids.length} 名学生的班级`);
      setBatchClassName("");
      setSelectedStudents(new Set());
      onStudentsChanged();
      refreshClasses();
    } catch {
      toast.error("批量更新失败");
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
      <h2 className="font-semibold text-gray-800">学生管理</h2>

      {loadError && students.length === 0 && (
        <div className="text-center py-6 text-red-500 space-y-2">
          <p>学生列表加载失败</p>
          <button onClick={onRetry}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg transition-colors">重试</button>
        </div>
      )}

      {/* Add student form */}
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="学号" value={newStudentId}
          onChange={(v) => setNewStudentId(v.replace(/\D/g, "").slice(0, 12))} />
        <Field label="姓名" value={newStudentName}
          onChange={(v) => setNewStudentName(v)} />
        <div className="space-y-1">
          <label className="text-xs text-gray-500">班级</label>
          <input list="class-datalist-add" value={newClassName} onChange={(e) => setNewClassName(e.target.value)}
            placeholder="可选"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
          <datalist id="class-datalist-add">
            {classList.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
        <button onClick={handleAddStudent}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap">
          添加
        </button>
      </div>

      {/* Batch import */}
      <div className="space-y-2">
        <label className="text-xs text-gray-500">批量导入（支持标题行自动识别，如：学号,姓名,班级）</label>
        <textarea
          ref={batchInputRef}
          rows={3}
          placeholder={"学号,姓名,班级\n202505050101,张三,2025级1班"}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300"
        />
        <button onClick={handleBatchImport}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors">
          批量导入
        </button>
      </div>

      {/* Student list with search */}
      <div className="border border-gray-100 rounded-lg overflow-hidden">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-3 bg-gray-50 gap-2">
          <span className="text-sm text-gray-600">
            学生列表（{filteredStudents.length} / {students.length} 名）
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索学号/姓名/班级..."
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            {selectedStudents.size > 0 && (
              <>
                <button onClick={() => setConfirmBatchClass(true)}
                  className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors">
                  批量设班（{selectedStudents.size}）
                </button>
                <button onClick={handleDeleteSelected}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg transition-colors">
                  删除选中（{selectedStudents.size}）
                </button>
              </>
            )}
          </div>
        </div>

        <div className="max-h-[500px] overflow-y-auto">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 w-10">
                  <input type="checkbox" className="rounded border-gray-300"
                    checked={filteredStudents.length > 0 && selectedStudents.size === filteredStudents.length}
                    onChange={() => {
                      if (selectedStudents.size === filteredStudents.length) setSelectedStudents(new Set());
                      else setSelectedStudents(new Set(filteredStudents.map((s) => s.student_id)));
                    }} />
                </th>
                <th className="px-4 py-2 cursor-pointer select-none" onClick={() => handleSort("student_id")}>
                  学号<SortIcon active={sortKey === "student_id"} dir={sortDir} />
                </th>
                <th className="px-4 py-2 cursor-pointer select-none" onClick={() => handleSort("name")}>
                  姓名<SortIcon active={sortKey === "name"} dir={sortDir} />
                </th>
                <th className="px-4 py-2 cursor-pointer select-none" onClick={() => handleSort("class_name")}>
                  班级<SortIcon active={sortKey === "class_name"} dir={sortDir} />
                </th>
                <th className="px-4 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {filteredStudents.map((s) => (
                <tr key={s.student_id} className="hover:bg-gray-50/50 group">
                  <td className="px-4 py-2">
                    <input type="checkbox" className="rounded border-gray-300"
                      checked={selectedStudents.has(s.student_id)}
                      onChange={() => {
                        const next = new Set(selectedStudents);
                        if (next.has(s.student_id)) next.delete(s.student_id);
                        else next.add(s.student_id);
                        setSelectedStudents(next);
                      }} />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{s.student_id}</td>
                  <td className="px-4 py-2">
                    {inlineEdit?.studentId === s.student_id && inlineEdit.field === "name" ? (
                      <input autoFocus value={inlineEdit.value}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                        onBlur={() => saveInlineEdit(s.student_id, "name", inlineEdit.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit(s.student_id, "name", inlineEdit.value);
                          if (e.key === "Escape") setInlineEdit(null);
                        }}
                        className="px-2 py-0.5 border border-gray-300 rounded text-sm w-24 focus:outline-none focus:ring-1 focus:ring-green-300" />
                    ) : (
                      <span className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => setInlineEdit({ studentId: s.student_id, field: "name", value: s.name })}>
                        {s.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {inlineEdit?.studentId === s.student_id && inlineEdit.field === "class_name" ? (
                      <input list="class-datalist-table" autoFocus value={inlineEdit.value}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                        onBlur={() => saveInlineEdit(s.student_id, "class_name", inlineEdit.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit(s.student_id, "class_name", inlineEdit.value);
                          if (e.key === "Escape") setInlineEdit(null);
                        }}
                        className="px-2 py-0.5 border border-gray-300 rounded text-sm w-28 focus:outline-none focus:ring-1 focus:ring-green-300" />
                    ) : (
                      <span className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => setInlineEdit({ studentId: s.student_id, field: "class_name", value: s.class_name || "" })}>
                        {s.class_name || <span className="text-gray-400">-</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditModal(s)}
                        className="text-green-600 hover:text-green-700 text-xs font-medium">编辑</button>
                      <button onClick={() => handleDeleteSingle(s.student_id)}
                        className="text-red-500 hover:text-red-600 text-xs font-medium">删除</button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredStudents.length === 0 && (
                <tr><td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                  {students.length === 0 ? "暂无学生数据" : "无匹配结果"}
                </td></tr>
              )}
            </tbody>
          </table>
          <datalist id="class-datalist-table">
            {classList.map((c) => <option key={c} value={c} />)}
          </datalist>
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
          onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">编辑学生</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xl">×</button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">学号</label>
                <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg">{editing.student_id}</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">姓名</label>
                <input value={editName} onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">班级</label>
                <input list="class-datalist-modal" value={editClass} onChange={(e) => setEditClass(e.target.value)}
                  placeholder="输入班级"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                <datalist id="class-datalist-modal">
                  {classList.map((c) => <option key={c} value={c} />)}
                </datalist>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button onClick={() => setEditing(null)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">
                取消
              </button>
              <button onClick={saveEditModal}
                className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors">
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm: Delete single */}
      <ConfirmDialog
        open={!!confirmDelete}
        title="确认删除"
        message={`确定删除学号 ${confirmDelete?.ids[0]} 的学生？此操作不可恢复。`}
        variant="danger"
        confirmText="删除"
        onConfirm={() => { if (confirmDelete) { executeDelete(confirmDelete.ids); setConfirmDelete(null); } }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Confirm: Batch delete */}
      <ConfirmDialog
        open={confirmBatchDelete}
        title="批量删除"
        message={`确定删除选中的 ${selectedStudents.size} 名学生？此操作不可恢复。`}
        variant="danger"
        confirmText="删除"
        onConfirm={() => { executeDelete(Array.from(selectedStudents)); setConfirmBatchDelete(false); }}
        onCancel={() => setConfirmBatchDelete(false)}
      />

      {/* Confirm: Batch set class */}
      <ConfirmDialog
        open={confirmBatchClass}
        title="批量设置班级"
        message={
          <span>将选中的 {selectedStudents.size} 名学生设置为：<br />
            <input autoFocus value={batchClassName} onChange={(e) => setBatchClassName(e.target.value)}
              placeholder="输入班级名称"
              className="mt-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-green-300" />
          </span>
        }
        variant="warning"
        confirmText="确认"
        onConfirm={() => { executeBatchSetClass(); setConfirmBatchClass(false); }}
        onCancel={() => { setConfirmBatchClass(false); setBatchClassName(""); }}
      />
    </div>
  );
}
