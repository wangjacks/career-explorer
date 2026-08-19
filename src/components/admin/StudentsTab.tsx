"use client";

import { useState, useRef, useEffect, useMemo } from "react";
import { toast } from "sonner";
import { Field } from "./AdminUI";
import ConfirmDialog from "./ConfirmDialog";
import type { Student } from "@/hooks/useAdminAuth";
import { generatePassword } from "@/lib/password";

interface Props {
  students: Student[];
  loadError?: boolean;
  onRetry?: () => void;
  onStudentsChanged: () => void;
  /** 预留：步骤 11 按角色差异化学生管理能力 */
  role?: "admin" | "teacher";
}

type SortKey = "user_code" | "name" | "class_name";
type SortDir = "asc" | "desc";

interface ClassItem {
  id: number;
  name: string;
}

interface ParsedRow {
  studentId: string;
  name: string;
  className: string;
}

interface CredentialRow {
  user_code: string;
  name: string;
  password: string;
}

const ID_KEYWORDS = ["学号", "student_id", "studentid", "学籍号", "编号", "id"];
const NAME_KEYWORDS = ["姓名", "name", "名字", "学生姓名", "student_name"];
const CLASS_KEYWORDS = ["班级", "class", "classname", "班"];

/** 导入预览状态：原始单元格矩阵 + 列映射（可在预览弹窗中手动调整） */
interface PreviewState {
  rawRows: string[][];
  hasHeader: boolean;
  idCol: number;
  nameCol: number;
  classCol: number; // -1 = 不导入班级
}

/** 将文本行切分为单元格矩阵（支持逗号、全角逗号、制表符） */
function splitToCells(lines: string[]): string[][] {
  return lines.map((line) => line.split(/[,，\t]/).map((s) => s.trim()));
}

/** 识别标题行与默认列映射；无表头且存在第 3 列时默认其为班级列 */
function detectMapping(rawRows: string[][]): Pick<PreviewState, "hasHeader" | "idCol" | "nameCol" | "classCol"> {
  const colCount = rawRows.length > 0 ? Math.max(...rawRows.map((r) => r.length)) : 0;
  const first = (rawRows[0] || []).map((s) => s.toLowerCase());
  let idCol = -1,
    nameCol = -1,
    classCol = -1;
  for (let i = 0; i < first.length; i++) {
    if (idCol === -1 && ID_KEYWORDS.some((k) => first[i] === k)) idCol = i;
    if (nameCol === -1 && NAME_KEYWORDS.some((k) => first[i] === k)) nameCol = i;
    if (classCol === -1 && CLASS_KEYWORDS.some((k) => first[i] === k)) classCol = i;
  }
  const hasHeader = idCol !== -1 || nameCol !== -1 || classCol !== -1;
  if (idCol === -1) idCol = 0;
  if (nameCol === -1) nameCol = 1;
  if (classCol === -1 && !hasHeader && colCount >= 3) classCol = 2;
  return { hasHeader, idCol, nameCol, classCol };
}

/** 按当前列映射推导解析行 */
function deriveParsedRows(preview: PreviewState): ParsedRow[] {
  const dataRows = preview.hasHeader ? preview.rawRows.slice(1) : preview.rawRows;
  return dataRows.map((cells) => ({
    studentId: cells[preview.idCol] || "",
    name: cells[preview.nameCol] || "",
    className: preview.classCol >= 0 ? cells[preview.classCol] || "" : "",
  }));
}

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
  const [classList, setClassList] = useState<ClassItem[]>([]);
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());

  // Search & sort
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("user_code");
  const [sortDir, setSortDir] = useState<SortDir>("asc");

  // 班级筛选（多选下拉）：未勾选任何项 = 不过滤（默认）；勾选后只显示选中班级，-1 = 未分班
  const [selectedClasses, setSelectedClasses] = useState<Set<number>>(new Set());
  const [classDropdownOpen, setClassDropdownOpen] = useState(false);
  const [classSearch, setClassSearch] = useState("");
  const classDropdownRef = useRef<HTMLDivElement>(null);

  // Import preview (raw matrix + adjustable column mapping)
  const [preview, setPreview] = useState<PreviewState | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Single password reset + credentials display
  const [resettingStudent, setResettingStudent] = useState<Student | null>(null);
  const [resetPwd, setResetPwd] = useState("");
  const [credential, setCredential] = useState<CredentialRow | null>(null);

  // Batch password reset
  const [confirmBatchPwd, setConfirmBatchPwd] = useState(false);
  const [batchPwdResults, setBatchPwdResults] = useState<CredentialRow[] | null>(null);
  const [batchPwdLoading, setBatchPwdLoading] = useState(false);

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
      const res = await fetch("/api/admin/classes");
      if (res.ok) {
        const data = await res.json();
        setClassList(data.data || []);
      }
    } catch {
      /* ignore */
    }
  };

  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => { refreshClasses(); }, []);

  // 点击外部关闭班级筛选下拉
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (classDropdownRef.current && !classDropdownRef.current.contains(e.target as Node)) {
        setClassDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const classNameOf = (s: Student): string =>
    s.class_id != null ? classList.find((c) => c.id === s.class_id)?.name || "" : "";

  // 班级筛选选项（各班 + 未分班），支持搜索
  const classFilterOptions = useMemo(() => {
    const opts = classList.map((c) => ({ id: c.id, name: c.name }));
    opts.push({ id: -1, name: "未分班" });
    const q = classSearch.trim().toLowerCase();
    return q ? opts.filter((o) => o.name.toLowerCase().includes(q)) : opts;
  }, [classList, classSearch]);

  const toggleClassFilter = (id: number) => {
    setSelectedClasses((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Filtered + sorted students
  const filteredStudents = useMemo(() => {
    const q = search.trim().toLowerCase();
    let list = students;
    if (selectedClasses.size > 0) {
      list = list.filter((s) => selectedClasses.has(s.class_id == null ? -1 : s.class_id));
    }
    if (q) {
      list = list.filter(
        (s) =>
          s.user_code.toLowerCase().includes(q) ||
          s.name.toLowerCase().includes(q) ||
          classNameOf(s).toLowerCase().includes(q)
      );
    }
    return [...list].sort((a, b) => {
      const va = sortKey === "class_name" ? classNameOf(a) : a[sortKey] || "";
      const vb = sortKey === "class_name" ? classNameOf(b) : b[sortKey] || "";
      const cmp = va.localeCompare(vb, "zh-CN");
      return sortDir === "asc" ? cmp : -cmp;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [students, search, sortKey, sortDir, classList, selectedClasses]);

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

  // 粘贴导入：解析后进入预览弹窗二次核对（列映射可调整）
  const handleBatchImport = () => {
    const text = batchInputRef.current?.value || "";
    const lines = text.split("\n").filter((l) => l.trim());
    if (lines.length === 0) {
      toast.warning("请输入学生数据");
      return;
    }
    const rawRows = splitToCells(lines);
    setPreview({ rawRows, ...detectMapping(rawRows) });
  };

  // 文件导入：xlsx 用 exceljs 解析，csv 用文本读取，均进入预览弹窗
  const handleFileImport = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      let lines: string[] = [];
      if (/\.(csv|txt)$/i.test(file.name)) {
        const text = await file.text();
        lines = text.split(/\r?\n/).filter((l) => l.trim());
      } else {
        const mod = await import("exceljs");
        const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(await file.arrayBuffer());
        const sheet = workbook.worksheets[0];
        if (!sheet) throw new Error("文件没有工作表");
        sheet.eachRow((row) => {
          const cells: string[] = [];
          row.eachCell({ includeEmpty: true }, (cell) => {
            cells.push(cell.value == null ? "" : String(cell.value).trim());
          });
          if (cells.some((c) => c)) lines.push(cells.join(","));
        });
      }
      if (lines.length === 0) {
        toast.warning("文件没有有效数据");
        return;
      }
      const rawRows = splitToCells(lines);
      setPreview({ rawRows, ...detectMapping(rawRows) });
    } catch (err) {
      console.error("File import parse error:", err);
      toast.error(err instanceof Error ? err.message : "文件解析失败");
    }
  };

  // 按当前列映射推导解析行 + 校验统计
  const parsedRows = useMemo(() => (preview ? deriveParsedRows(preview) : []), [preview]);
  const previewInvalid = useMemo(
    () => parsedRows.filter((r) => !/^\d{12}$/.test(r.studentId) || !r.name.trim()).length,
    [parsedRows]
  );
  const columnCount = preview ? Math.max(...preview.rawRows.map((r) => r.length)) : 0;
  const columnLabel = (i: number) => {
    const headerText = preview?.hasHeader ? preview.rawRows[0]?.[i] : "";
    return headerText ? `第 ${i + 1} 列（${headerText}）` : `第 ${i + 1} 列`;
  };

  // 预览确认后才真正调 API 导入
  const confirmImport = async () => {
    if (!preview) return;
    const validRows = parsedRows.filter((r) => /^\d{12}$/.test(r.studentId) && r.name.trim());
    if (validRows.length === 0) {
      toast.warning("没有可导入的有效数据");
      return;
    }
    try {
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ students: validRows }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
      setPreview(null);
      if (batchInputRef.current) batchInputRef.current.value = "";
      onStudentsChanged();
      refreshClasses();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    }
  };

  // 单生重置密码
  const submitResetPassword = async () => {
    if (!resettingStudent) return;
    if (resetPwd.length < 8) {
      toast.warning("密码须至少 8 位（可点「自动生成」）");
      return;
    }
    try {
      const res = await fetch("/api/admin/students", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: resettingStudent.user_code, password: resetPwd }),
      });
      if (!res.ok) throw new Error("重置失败");
      setCredential({ user_code: resettingStudent.user_code, name: resettingStudent.name, password: resetPwd });
      setResettingStudent(null);
      setResetPwd("");
    } catch {
      toast.error("重置失败");
    }
  };

  // 批量重置密码：服务端为每人生成不同随机密码
  const executeBatchPassword = async () => {
    const ids = Array.from(selectedStudents);
    setBatchPwdLoading(true);
    try {
      const res = await fetch("/api/admin/students/batch-password", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentIds: ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      setBatchPwdResults(data.data);
      setSelectedStudents(new Set());
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "批量重置失败");
    } finally {
      setBatchPwdLoading(false);
      setConfirmBatchPwd(false);
    }
  };

  const copyAllCredentials = async () => {
    if (!batchPwdResults) return;
    const text = batchPwdResults.map((r) => `${r.user_code}\t${r.name}\t${r.password}`).join("\n");
    try {
      await navigator.clipboard.writeText(text);
      toast.success("已复制全部凭据");
    } catch {
      toast.error("复制失败，请手动记录");
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
    setEditClass(classNameOf(s));
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
        body: JSON.stringify({ studentId: editing.user_code, name: editName.trim(), className: editClass.trim() }),
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
          <button
            onClick={onRetry}
            className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg transition-colors"
          >
            重试
          </button>
        </div>
      )}

      {/* Add student form */}
      <div className="flex flex-wrap gap-2 items-end">
        <Field label="学号" value={newStudentId} onChange={(v) => setNewStudentId(v.replace(/\D/g, "").slice(0, 12))} />
        <Field label="姓名" value={newStudentName} onChange={(v) => setNewStudentName(v)} />
        <div className="space-y-1">
          <label className="text-xs text-gray-500">班级</label>
          <input
            list="class-datalist-add"
            value={newClassName}
            onChange={(e) => setNewClassName(e.target.value)}
            placeholder="可选"
            className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
          />
          <datalist id="class-datalist-add">
            {classList.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </div>
        <button
          onClick={handleAddStudent}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
        >
          添加
        </button>
      </div>

      {/* Batch import: paste + file */}
      <div className="space-y-2">
        <label className="text-xs text-gray-500">批量导入（支持标题行自动识别，如：学号,姓名,班级；导入前可预览核对）</label>
        <textarea
          ref={batchInputRef}
          rows={3}
          placeholder={"学号,姓名,班级\n202505050101,张三,2025级1班"}
          className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300"
        />
        <div className="flex flex-wrap gap-2">
          <button
            onClick={handleBatchImport}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            粘贴导入
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            选择文件导入（.xlsx/.csv）
          </button>
          <input ref={fileInputRef} type="file" accept=".xlsx,.csv,.txt" onChange={handleFileImport} className="hidden" />
        </div>
      </div>

      {/* Student list with search + class filter（外层不用 overflow-hidden，避免裁剪班级筛选下拉） */}
      <div className="border border-gray-100 rounded-lg">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between px-4 py-3 bg-gray-50 gap-2 rounded-t-lg">
          <span className="text-sm text-gray-600">
            学生列表（{filteredStudents.length} / {students.length} 名）
          </span>
          <div className="flex items-center gap-2 flex-wrap">
            {/* 班级筛选多选下拉（默认全选） */}
            <div className="relative" ref={classDropdownRef}>
              <button
                onClick={() => setClassDropdownOpen((v) => !v)}
                className={`px-3 py-1.5 rounded-lg text-sm font-medium border transition-colors flex items-center gap-1.5 ${
                  selectedClasses.size > 0
                    ? "bg-green-50 text-green-700 border-green-200"
                    : "bg-white text-gray-600 border-gray-200 hover:border-gray-300"
                }`}
              >
                班级筛选
                {selectedClasses.size > 0 && (
                  <span className="ml-0.5 px-1.5 py-0.5 bg-green-500 text-white text-xs rounded-full leading-none">
                    {selectedClasses.size}
                  </span>
                )}
                <svg
                  className={`w-3 h-3 transition-transform ${classDropdownOpen ? "rotate-180" : ""}`}
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>
              {classDropdownOpen && (
                <div className="absolute top-full left-0 mt-1 w-64 bg-white rounded-xl border border-gray-200 shadow-lg z-30">
                  <div className="p-2 border-b border-gray-100">
                    <input
                      type="text"
                      value={classSearch}
                      onChange={(e) => setClassSearch(e.target.value)}
                      placeholder="搜索班级..."
                      className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                      autoFocus
                    />
                  </div>
                  <div className="max-h-52 overflow-y-auto py-1">
                    {classFilterOptions.map((o) => {
                      const isSelected = selectedClasses.has(o.id);
                      return (
                        <button
                          key={o.id}
                          onClick={() => toggleClassFilter(o.id)}
                          className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                            isSelected ? "bg-green-50 text-green-700" : "hover:bg-gray-50 text-gray-700"
                          }`}
                        >
                          <span
                            className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-xs ${
                              isSelected ? "bg-green-500 border-green-500 text-white" : "border-gray-300"
                            }`}
                          >
                            {isSelected && "✓"}
                          </span>
                          <span className="truncate">{o.name}</span>
                        </button>
                      );
                    })}
                    {classFilterOptions.length === 0 && (
                      <div className="px-3 py-4 text-center text-sm text-gray-400">无匹配班级</div>
                    )}
                  </div>
                </div>
              )}
            </div>
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索学号/姓名/班级..."
              className="px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-48 focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            {selectedClasses.size > 0 && (
              <button
                onClick={() => setSelectedClasses(new Set())}
                className="text-xs text-gray-400 hover:text-gray-600 transition-colors"
              >
                清除筛选
              </button>
            )}
            {selectedStudents.size > 0 && (
              <>
                <button
                  onClick={() => setConfirmBatchClass(true)}
                  className="px-3 py-1.5 bg-blue-500 hover:bg-blue-600 text-white text-xs rounded-lg transition-colors"
                >
                  批量设班（{selectedStudents.size}）
                </button>
                <button
                  onClick={() => setConfirmBatchPwd(true)}
                  className="px-3 py-1.5 bg-amber-500 hover:bg-amber-600 text-white text-xs rounded-lg transition-colors"
                >
                  批量重置密码（{selectedStudents.size}）
                </button>
                <button
                  onClick={handleDeleteSelected}
                  className="px-3 py-1.5 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg transition-colors"
                >
                  删除选中（{selectedStudents.size}）
                </button>
              </>
            )}
          </div>
        </div>

        <div className="max-h-[500px] overflow-y-auto rounded-b-lg bg-white">
          <table className="w-full text-sm">
            <thead className="sticky top-0 bg-gray-50 z-10">
              <tr className="text-left text-gray-500 border-b border-gray-100">
                <th className="px-4 py-2 w-10">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300"
                    checked={filteredStudents.length > 0 && selectedStudents.size === filteredStudents.length}
                    onChange={() => {
                      if (selectedStudents.size === filteredStudents.length) setSelectedStudents(new Set());
                      else setSelectedStudents(new Set(filteredStudents.map((s) => s.user_code)));
                    }}
                  />
                </th>
                <th className="px-4 py-2 cursor-pointer select-none" onClick={() => handleSort("user_code")}>
                  学号<SortIcon active={sortKey === "user_code"} dir={sortDir} />
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
                <tr key={s.user_code} className="hover:bg-gray-50/50 group">
                  <td className="px-4 py-2">
                    <input
                      type="checkbox"
                      className="rounded border-gray-300"
                      checked={selectedStudents.has(s.user_code)}
                      onChange={() => {
                        const next = new Set(selectedStudents);
                        if (next.has(s.user_code)) next.delete(s.user_code);
                        else next.add(s.user_code);
                        setSelectedStudents(next);
                      }}
                    />
                  </td>
                  <td className="px-4 py-2 font-mono text-xs text-gray-600">{s.user_code}</td>
                  <td className="px-4 py-2">
                    {inlineEdit?.studentId === s.user_code && inlineEdit.field === "name" ? (
                      <input
                        autoFocus
                        value={inlineEdit.value}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                        onBlur={() => saveInlineEdit(s.user_code, "name", inlineEdit.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit(s.user_code, "name", inlineEdit.value);
                          if (e.key === "Escape") setInlineEdit(null);
                        }}
                        className="px-2 py-0.5 border border-gray-300 rounded text-sm w-24 focus:outline-none focus:ring-1 focus:ring-green-300"
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => setInlineEdit({ studentId: s.user_code, field: "name", value: s.name })}
                      >
                        {s.name}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    {inlineEdit?.studentId === s.user_code && inlineEdit.field === "class_name" ? (
                      <input
                        list="class-datalist-table"
                        autoFocus
                        value={inlineEdit.value}
                        onChange={(e) => setInlineEdit({ ...inlineEdit, value: e.target.value })}
                        onBlur={() => saveInlineEdit(s.user_code, "class_name", inlineEdit.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") saveInlineEdit(s.user_code, "class_name", inlineEdit.value);
                          if (e.key === "Escape") setInlineEdit(null);
                        }}
                        className="px-2 py-0.5 border border-gray-300 rounded text-sm w-28 focus:outline-none focus:ring-1 focus:ring-green-300"
                      />
                    ) : (
                      <span
                        className="cursor-pointer hover:bg-gray-100 px-1 rounded"
                        onClick={() => setInlineEdit({ studentId: s.user_code, field: "class_name", value: classNameOf(s) })}
                      >
                        {classNameOf(s) || <span className="text-gray-400">-</span>}
                      </span>
                    )}
                  </td>
                  <td className="px-4 py-2">
                    <div className="flex items-center gap-2 opacity-60 group-hover:opacity-100 transition-opacity">
                      <button onClick={() => openEditModal(s)} className="text-green-600 hover:text-green-700 text-xs font-medium">
                        编辑
                      </button>
                      <button
                        onClick={() => {
                          setResettingStudent(s);
                          setResetPwd("");
                        }}
                        className="text-amber-600 hover:text-amber-700 text-xs font-medium"
                      >
                        重置密码
                      </button>
                      <button onClick={() => handleDeleteSingle(s.user_code)} className="text-red-500 hover:text-red-600 text-xs font-medium">
                        删除
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
              {filteredStudents.length === 0 && (
                <tr>
                  <td colSpan={5} className="px-4 py-8 text-center text-gray-400 text-sm">
                    {students.length === 0 ? "暂无学生数据" : "无匹配结果"}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
          <datalist id="class-datalist-table">
            {classList.map((c) => (
              <option key={c.id} value={c.name} />
            ))}
          </datalist>
        </div>
      </div>

      {/* Edit Modal */}
      {editing && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setEditing(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">编辑学生</h3>
              <button onClick={() => setEditing(null)} className="text-gray-400 hover:text-gray-600 text-xl">
                ×
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">学号</label>
                <p className="font-mono text-sm text-gray-700 bg-gray-50 px-3 py-2 rounded-lg">{editing.user_code}</p>
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">姓名</label>
                <input
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
              <div className="space-y-1">
                <label className="text-xs text-gray-500">班级</label>
                <input
                  list="class-datalist-modal"
                  value={editClass}
                  onChange={(e) => setEditClass(e.target.value)}
                  placeholder="输入班级"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
                <datalist id="class-datalist-modal">
                  {classList.map((c) => (
                    <option key={c.id} value={c.name} />
                  ))}
                </datalist>
              </div>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setEditing(null)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={saveEditModal}
                className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                保存
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import preview modal */}
      {preview && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setPreview(null)}>
          <div
            className="bg-white rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 text-lg">导入预览</h3>
              <button onClick={() => setPreview(null)} className="text-gray-400 hover:text-gray-600 text-xl">
                ×
              </button>
            </div>
            {/* 列映射调整 */}
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                学号列
                <select
                  value={preview.idCol}
                  onChange={(e) => setPreview({ ...preview, idCol: Number(e.target.value) })}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-300"
                >
                  {Array.from({ length: columnCount }, (_, i) => (
                    <option key={i} value={i}>
                      {columnLabel(i)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                姓名列
                <select
                  value={preview.nameCol}
                  onChange={(e) => setPreview({ ...preview, nameCol: Number(e.target.value) })}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-300"
                >
                  {Array.from({ length: columnCount }, (_, i) => (
                    <option key={i} value={i}>
                      {columnLabel(i)}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex items-center gap-1.5 text-sm text-gray-600">
                班级列
                <select
                  value={preview.classCol}
                  onChange={(e) => setPreview({ ...preview, classCol: Number(e.target.value) })}
                  className="px-2 py-1 border border-gray-200 rounded-lg text-sm bg-white focus:outline-none focus:ring-2 focus:ring-green-300"
                >
                  <option value={-1}>不导入</option>
                  {Array.from({ length: columnCount }, (_, i) => (
                    <option key={i} value={i}>
                      {columnLabel(i)}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <p className="text-sm text-gray-500">
              共 {parsedRows.length} 条
              {previewInvalid > 0 && <span className="text-red-500">，其中 {previewInvalid} 条学号/姓名无效（红色，不会导入）</span>}
              。黄色表示班级不存在，导入后将留未分班。
            </p>
            <div className="overflow-y-auto border border-gray-100 rounded-lg flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-4 py-2 font-medium">学号</th>
                    <th className="px-4 py-2 font-medium">姓名</th>
                    <th className="px-4 py-2 font-medium">班级</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {parsedRows.map((r, i) => {
                    const invalid = !/^\d{12}$/.test(r.studentId) || !r.name.trim();
                    const classMissing = !!r.className.trim() && !classList.some((c) => c.name === r.className.trim());
                    return (
                      <tr key={i} className={invalid ? "bg-red-50" : classMissing ? "bg-amber-50" : ""}>
                        <td className="px-4 py-1.5 font-mono text-xs">{r.studentId || "-"}</td>
                        <td className="px-4 py-1.5">{r.name || "-"}</td>
                        <td className="px-4 py-1.5">{r.className || <span className="text-gray-400">-</span>}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={() => setPreview(null)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={confirmImport}
                className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                确认导入（{parsedRows.length - previewInvalid} 条）
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single reset password modal */}
      {resettingStudent && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setResettingStudent(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 text-lg">重置密码 — {resettingStudent.name}</h3>
            <div className="flex gap-2">
              <input
                type="text"
                value={resetPwd}
                onChange={(e) => setResetPwd(e.target.value)}
                placeholder="至少 8 位密码"
                className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300"
              />
              <button
                type="button"
                onClick={() => setResetPwd(generatePassword())}
                className="px-3 py-2 bg-gray-100 hover:bg-gray-200 text-gray-600 text-sm rounded-lg transition-colors whitespace-nowrap"
              >
                自动生成
              </button>
            </div>
            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setResettingStudent(null)}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={submitResetPassword}
                className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                重置
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Single credentials dialog (one-time) */}
      {credential && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setCredential(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <h3 className="font-semibold text-gray-800 text-lg">密码已重置</h3>
            <p className="text-xs text-amber-600">请立即记录并告知学生，关闭后将无法再次查看密码。</p>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-gray-500">学号</span>
                <code className="font-mono font-medium text-gray-800">{credential.user_code}</code>
              </div>
              <div className="flex justify-between items-center bg-gray-50 rounded-lg px-3 py-2">
                <span className="text-gray-500">新密码</span>
                <code className="font-mono font-medium text-gray-800">{credential.password}</code>
              </div>
            </div>
            <button
              onClick={() => setCredential(null)}
              className="w-full py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              我已记录
            </button>
          </div>
        </div>
      )}

      {/* Batch password results dialog */}
      {batchPwdResults && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setBatchPwdResults(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-gray-800 text-lg">批量重置完成（{batchPwdResults.length} 人）</h3>
            <p className="text-xs text-amber-600">请立即记录或复制，关闭后将无法再次查看密码。</p>
            <div className="overflow-y-auto border border-gray-100 rounded-lg flex-1">
              <table className="w-full text-sm">
                <thead className="sticky top-0 bg-gray-50">
                  <tr className="text-left text-gray-500">
                    <th className="px-4 py-2 font-medium">学号</th>
                    <th className="px-4 py-2 font-medium">姓名</th>
                    <th className="px-4 py-2 font-medium">新密码</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {batchPwdResults.map((r) => (
                    <tr key={r.user_code}>
                      <td className="px-4 py-1.5 font-mono text-xs">{r.user_code}</td>
                      <td className="px-4 py-1.5">{r.name}</td>
                      <td className="px-4 py-1.5 font-mono text-xs">{r.password}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="flex gap-2 pt-1">
              <button
                onClick={copyAllCredentials}
                className="flex-1 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                复制全部
              </button>
              <button
                onClick={() => setBatchPwdResults(null)}
                className="flex-1 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
              >
                我已记录
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
        onConfirm={() => {
          if (confirmDelete) {
            executeDelete(confirmDelete.ids);
            setConfirmDelete(null);
          }
        }}
        onCancel={() => setConfirmDelete(null)}
      />

      {/* Confirm: Batch delete */}
      <ConfirmDialog
        open={confirmBatchDelete}
        title="批量删除"
        message={`确定删除选中的 ${selectedStudents.size} 名学生？此操作不可恢复。`}
        variant="danger"
        confirmText="删除"
        onConfirm={() => {
          executeDelete(Array.from(selectedStudents));
          setConfirmBatchDelete(false);
        }}
        onCancel={() => setConfirmBatchDelete(false)}
      />

      {/* Confirm: Batch set class */}
      <ConfirmDialog
        open={confirmBatchClass}
        title="批量设置班级"
        message={
          <span>
            将选中的 {selectedStudents.size} 名学生设置为：
            <br />
            <input
              autoFocus
              value={batchClassName}
              onChange={(e) => setBatchClassName(e.target.value)}
              placeholder="输入班级名称"
              className="mt-2 px-3 py-1.5 border border-gray-200 rounded-lg text-sm w-full focus:outline-none focus:ring-2 focus:ring-green-300"
            />
          </span>
        }
        variant="warning"
        confirmText="确认"
        onConfirm={() => {
          executeBatchSetClass();
          setConfirmBatchClass(false);
        }}
        onCancel={() => {
          setConfirmBatchClass(false);
          setBatchClassName("");
        }}
      />

      {/* Confirm: Batch reset password */}
      <ConfirmDialog
        open={confirmBatchPwd}
        title="批量重置密码"
        message={`将为选中的 ${selectedStudents.size} 名学生各生成一个不同的随机密码，确认继续？`}
        variant="warning"
        confirmText={batchPwdLoading ? "重置中..." : "确认重置"}
        onConfirm={executeBatchPassword}
        onCancel={() => setConfirmBatchPwd(false)}
      />
    </div>
  );
}
