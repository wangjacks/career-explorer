"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Field } from "./AdminUI";
import type { Student } from "@/hooks/useAdminAuth";

interface Props {
  students: Student[];
  loadError?: boolean;
  onRetry?: () => void;
  onStudentsChanged: () => void;
}

export default function StudentsTab({ students, loadError, onRetry, onStudentsChanged }: Props) {
  const [newStudentId, setNewStudentId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const batchInputRef = useRef<HTMLTextAreaElement>(null);

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
        body: JSON.stringify({ studentId: newStudentId, name: newStudentName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success("添加成功");
      setNewStudentId("");
      setNewStudentName("");
      onStudentsChanged();
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

    const firstCells = lines[0].split(/[,，\t]/).map((s) => s.trim().toLowerCase());
    let idCol = -1;
    let nameCol = -1;
    for (let i = 0; i < firstCells.length; i++) {
      if (idCol === -1 && idKeywords.some((k) => firstCells[i] === k)) idCol = i;
      if (nameCol === -1 && nameKeywords.some((k) => firstCells[i] === k)) nameCol = i;
    }

    const hasHeader = idCol !== -1 || nameCol !== -1;
    const dataLines = hasHeader ? lines.slice(1) : lines;

    if (idCol === -1) idCol = 0;
    if (nameCol === -1) nameCol = 1;

    const parsed = dataLines.map((line) => {
      const cells = line.split(/[,，\t]/).map((s) => s.trim());
      return { studentId: cells[idCol] || "", name: cells[nameCol] || "" };
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
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    }
  };

  const handleDeleteStudents = async (ids: string[]) => {
    if (!confirm(`确定删除 ${ids.length} 名学生？`)) return;
    try {
      const res = await fetch("/api/admin/students", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("删除失败");
      toast.success("删除成功");
      setSelectedStudents(new Set());
      onStudentsChanged();
    } catch {
      toast.error("删除失败");
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

      <div className="flex gap-2 items-end">
        <Field label="学号" value={newStudentId}
          onChange={(v) => setNewStudentId(v.replace(/\D/g, "").slice(0, 12))} />
        <Field label="姓名" value={newStudentName}
          onChange={(v) => setNewStudentName(v)} />
        <button onClick={handleAddStudent}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap">
          添加
        </button>
      </div>

      <div className="space-y-2">
        <label className="text-xs text-gray-500">批量导入（支持标题行自动识别，如：学号,姓名）</label>
        <textarea
          ref={batchInputRef}
          rows={3}
          placeholder={"学号,姓名\n202505050101,张三\n202505050102,李四"}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300"
        />
        <button onClick={handleBatchImport}
          className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors">
          批量导入
        </button>
      </div>

      <div className="border border-gray-100 rounded-lg overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2 bg-gray-50 text-sm">
          <span className="text-gray-600">学生列表（{students.length} 名）</span>
          {selectedStudents.size > 0 && (
            <button onClick={() => handleDeleteStudents(Array.from(selectedStudents))}
              className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg">
              删除选中（{selectedStudents.size}）
            </button>
          )}
        </div>
        <div className="max-h-96 overflow-y-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 w-10">
                  <input type="checkbox" className="rounded border-gray-300"
                    checked={selectedStudents.size === students.length && students.length > 0}
                    onChange={() => {
                      if (selectedStudents.size === students.length) setSelectedStudents(new Set());
                      else setSelectedStudents(new Set(students.map((s) => s.student_id)));
                    }} />
                </th>
                <th className="px-4 py-2">学号</th>
                <th className="px-4 py-2">姓名</th>
                <th className="px-4 py-2">操作</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-50">
              {students.map((s) => (
                <tr key={s.student_id} className="hover:bg-gray-50/50">
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
                  <td className="px-4 py-2 font-mono text-xs">{s.student_id}</td>
                  <td className="px-4 py-2">{s.name}</td>
                  <td className="px-4 py-2">
                    <button onClick={() => handleDeleteStudents([s.student_id])}
                      className="text-red-500 hover:text-red-600 text-xs">删除</button>
                  </td>
                </tr>
              ))}
              {students.length === 0 && (
                <tr><td colSpan={4} className="px-4 py-8 text-center text-gray-400 text-sm">暂无学生数据</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
