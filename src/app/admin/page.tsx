"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Toaster, toast } from "sonner";

type Tab = "overview" | "settings" | "students" | "export";

interface Profile {
  studentId: string;
  studentName: string;
  tags: string[];
  avatarUrl: string;
  evaluationUrl: string;
  createdAt: string;
}

interface Student {
  student_id: string;
  name: string;
  created_at: string;
}

interface Stats {
  total: number;
  today: number;
  uniqueTags: number;
  topTags: { tag: string; count: number }[];
}

interface PagedData {
  data: Profile[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

interface DbConfig {
  type: "sqlite" | "mysql";
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [activeTab, setActiveTab] = useState<Tab>("overview");

  const [stats, setStats] = useState<Stats | null>(null);
  const [paged, setPaged] = useState<PagedData | null>(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [testingDb, setTestingDb] = useState(false);
  const [savingDb, setSavingDb] = useState(false);

  const [students, setStudents] = useState<Student[]>([]);
  const [newStudentId, setNewStudentId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const batchInputRef = useRef<HTMLTextAreaElement>(null);

  // Export state
  const [exportScope, setExportScope] = useState<"all" | "students" | "byIds" | "date">("all");
  const [exportIds, setExportIds] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [embedImages, setEmbedImages] = useState(false);
  const [exportColumns, setExportColumns] = useState({
    studentId: true, name: true, tags: true,
    avatarUrl: true, evaluationUrl: true, createdAt: true,
  });
  const [previewData, setPreviewData] = useState<Record<string, string>[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${password}` }),
    [password]
  );

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats", { headers: authHeaders() });
      if (res.ok) setStats(await res.json());
    } catch {}
  }, [authHeaders]);

  const loadProfiles = useCallback(
    async (p: number) => {
      try {
        const res = await fetch(`/api/admin/profiles?page=${p}`, { headers: authHeaders() });
        if (res.ok) setPaged(await res.json());
      } catch {}
    },
    [authHeaders]
  );

  const loadSettings = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/settings", { headers: authHeaders() });
      if (res.ok) setDbConfig(await res.json());
    } catch {}
  }, [authHeaders]);

  const loadStudents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/students", { headers: authHeaders() });
      if (res.ok) {
        const data = await res.json();
        setStudents(data.data);
      }
    } catch {}
  }, [authHeaders]);

  useEffect(() => {
    const saved = sessionStorage.getItem("admin_password");
    if (saved) {
      setPassword(saved);
      setLoggedIn(true);
    }
  }, []);

  useEffect(() => {
    if (loggedIn) {
      loadStats();
      loadProfiles(page);
      loadSettings();
      loadStudents();
    }
  }, [loggedIn, page, loadStats, loadProfiles, loadSettings, loadStudents]);

  useEffect(() => {
    setSelected(new Set());
  }, [page]);

  const handleLogin = async () => {
    try {
      const res = await fetch("/api/admin/stats", {
        headers: { Authorization: `Bearer ${password}` },
      });
      if (res.ok) {
        sessionStorage.setItem("admin_password", password);
        setLoggedIn(true);
      } else {
        toast.error("密码错误");
      }
    } catch {
      toast.error("登录失败");
    }
  };

  const handleDeleteProfiles = async (ids: string[]) => {
    if (!confirm(`确定删除 ${ids.length} 条记录？`)) return;
    try {
      const res = await fetch("/api/admin/profiles", {
        method: "DELETE",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("删除失败");
      const { deleted } = await res.json();
      toast.success(`已删除 ${deleted} 条记录`);
      setSelected(new Set());
      loadStats();
      loadProfiles(page);
    } catch {
      toast.error("删除失败");
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
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: newStudentId, name: newStudentName.trim() }),
      });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error);
      }
      toast.success("添加成功");
      setNewStudentId("");
      setNewStudentName("");
      loadStudents();
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
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ students: parsed }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error);
      toast.success(data.message);
      if (batchInputRef.current) batchInputRef.current.value = "";
      loadStudents();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导入失败");
    }
  };

  const handleDeleteStudents = async (ids: string[]) => {
    if (!confirm(`确定删除 ${ids.length} 名学生？`)) return;
    try {
      const res = await fetch("/api/admin/students", {
        method: "DELETE",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      if (!res.ok) throw new Error("删除失败");
      toast.success("删除成功");
      setSelectedStudents(new Set());
      loadStudents();
    } catch {
      toast.error("删除失败");
    }
  };

  const handleTestDb = async () => {
    if (!dbConfig || dbConfig.type !== "mysql") return;
    setTestingDb(true);
    try {
      const res = await fetch("/api/admin/test-db", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(dbConfig.mysql),
      });
      const data = await res.json();
      if (data.ok) toast.success("连接成功");
      else toast.error(data.error);
    } catch {
      toast.error("测试失败");
    } finally {
      setTestingDb(false);
    }
  };

  const handleSaveDb = async () => {
    if (!dbConfig) return;
    setSavingDb(true);
    try {
      const res = await fetch("/api/admin/settings", {
        method: "PUT",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify(dbConfig),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error);
        return;
      }
      toast.success(data.message);
      loadSettings();
      loadStats();
      loadProfiles(1);
      setPage(1);
    } catch {
      toast.error("保存失败");
    } finally {
      setSavingDb(false);
    }
  };

  const toggleProfileSelect = (studentId: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(studentId)) next.delete(studentId);
      else next.add(studentId);
      return next;
    });
  };

  const toggleProfileSelectAll = () => {
    if (!paged) return;
    if (selected.size === paged.data.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(paged.data.map((p) => p.studentId)));
    }
  };

  // Export functions
  const getExportColumns = () => {
    const cols: string[] = [];
    if (exportColumns.studentId) cols.push("student_id");
    if (exportColumns.name) cols.push("name");
    if (exportColumns.tags) cols.push("tags");
    if (exportColumns.avatarUrl) cols.push("avatar_url");
    if (exportColumns.evaluationUrl) cols.push("evaluation_url");
    if (exportColumns.createdAt) cols.push("created_at");
    return cols.join(",");
  };

  const getExportParams = () => {
    const params = new URLSearchParams({
      scope: exportScope,
      columns: getExportColumns(),
    });
    if (exportScope === "byIds" && exportIds) params.set("ids", exportIds);
    if (exportScope === "date") {
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
    }
    return params;
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch("/api/admin/export", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: exportScope,
          ids: exportIds,
          dateFrom,
          dateTo,
          columns: getExportColumns(),
        }),
      });
      if (!res.ok) throw new Error("预览失败");
      const data = await res.json();
      setPreviewData(data.preview);
      setPreviewTotal(data.total);
    } catch {
      toast.error("预览失败");
    } finally {
      setPreviewing(false);
    }
  };

  const handleExportFile = async () => {
    setExporting(true);
    try {
      const params = getExportParams();
      params.set("format", exportFormat);
      if (exportFormat === "xlsx") params.set("embedImages", String(embedImages));
      const res = await fetch(`/api/admin/export?${params}`, { headers: authHeaders() });
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export_${Date.now()}.${exportFormat === "xlsx" ? "xlsx" : "csv"}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch {
      toast.error("导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleExportImages = async () => {
    setExporting(true);
    try {
      const params = getExportParams();
      const res = await fetch(`/api/admin/export-images?${params}`, { headers: authHeaders() });
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导出失败");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `images_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("图片包下载成功");
    } catch (e) {
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <Toaster position="top-center" />
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">后台管理</h1>
            <p className="text-sm text-gray-500 mt-1">请输入密码登录</p>
          </div>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && handleLogin()}
            placeholder="请输入密码"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent"
          />
          <button
            onClick={handleLogin}
            className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
          >
            登录
          </button>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: "overview", label: "数据概览" },
    { key: "settings", label: "数据源设置", badge: dbConfig ? (dbConfig.type === "sqlite" ? "SQLite" : "MySQL") : undefined },
    { key: "students", label: "学生管理", badge: `${students.length} 名` },
    { key: "export", label: "数据导出" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />

      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">后台管理</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                sessionStorage.removeItem("admin_password");
                setLoggedIn(false);
                setPassword("");
              }}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-green-500 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
                {tab.badge && (
                  <span className="ml-2 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Overview Tab */}
        {activeTab === "overview" && (
          <>
            {stats && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <StatCard label="总提交数" value={stats.total} />
                <StatCard label="今日新增" value={stats.today} />
                <StatCard label="标签种类" value={stats.uniqueTags} />
                <div className="bg-white rounded-xl border border-gray-100 p-5">
                  <p className="text-xs text-gray-500 mb-2">热门标签</p>
                  <div className="space-y-1">
                    {stats.topTags.map((t) => (
                      <div key={t.tag} className="flex justify-between text-sm">
                        <span className="text-gray-700">{t.tag}</span>
                        <span className="text-gray-400">{t.count}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
              <div className="px-5 py-4 border-b border-gray-100 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">
                  数据列表 {paged && `(${paged.total} 条)`}
                </h2>
                {selected.size > 0 && (
                  <button
                    onClick={() => handleDeleteProfiles(Array.from(selected))}
                    className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    删除选中（{selected.size}）
                  </button>
                )}
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 text-left text-gray-500">
                      <th className="px-5 py-3 font-medium w-10">
                        <input
                          type="checkbox"
                          checked={paged ? selected.size === paged.data.length && paged.data.length > 0 : false}
                          onChange={toggleProfileSelectAll}
                          className="rounded border-gray-300"
                        />
                      </th>
                      <th className="px-5 py-3 font-medium">学号</th>
                      <th className="px-5 py-3 font-medium">姓名</th>
                      <th className="px-5 py-3 font-medium">虚拟形象</th>
                      <th className="px-5 py-3 font-medium">评价词云</th>
                      <th className="px-5 py-3 font-medium">标签</th>
                      <th className="px-5 py-3 font-medium">提交时间</th>
                      <th className="px-5 py-3 font-medium">操作</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50">
                    {paged?.data.map((p) => (
                      <tr
                        key={p.studentId}
                        className={`hover:bg-gray-50/50 ${selected.has(p.studentId) ? "bg-blue-50/30" : ""}`}
                      >
                        <td className="px-5 py-3">
                          <input
                            type="checkbox"
                            checked={selected.has(p.studentId)}
                            onChange={() => toggleProfileSelect(p.studentId)}
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
                            <button onClick={() => handleDeleteProfiles([p.studentId])}
                              className="text-red-500 hover:text-red-600 text-xs font-medium">删除</button>
                          </div>
                        </td>
                      </tr>
                    ))}
                    {paged?.data.length === 0 && (
                      <tr>
                        <td colSpan={8} className="px-5 py-12 text-center text-gray-400">暂无数据</td>
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
          </>
        )}

        {/* Settings Tab */}
        {activeTab === "settings" && dbConfig && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
            <h2 className="font-semibold text-gray-800">数据源配置</h2>
            <div className="flex items-center gap-4">
              <label className="text-sm text-gray-600">数据源类型</label>
              <select
                value={dbConfig.type}
                onChange={(e) => setDbConfig({ ...dbConfig, type: e.target.value as "sqlite" | "mysql" })}
                className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              >
                <option value="sqlite">SQLite（本地文件）</option>
                <option value="mysql">MySQL（远程数据库）</option>
              </select>
            </div>
            {dbConfig.type === "mysql" && (
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <Field label="主机" value={dbConfig.mysql.host}
                  onChange={(v) => setDbConfig({ ...dbConfig, mysql: { ...dbConfig.mysql, host: v } })} />
                <Field label="端口" value={String(dbConfig.mysql.port)} type="number"
                  onChange={(v) => setDbConfig({ ...dbConfig, mysql: { ...dbConfig.mysql, port: parseInt(v) || 3306 } })} />
                <Field label="用户名" value={dbConfig.mysql.user}
                  onChange={(v) => setDbConfig({ ...dbConfig, mysql: { ...dbConfig.mysql, user: v } })} />
                <Field label="密码" value={dbConfig.mysql.password} type="password"
                  onChange={(v) => setDbConfig({ ...dbConfig, mysql: { ...dbConfig.mysql, password: v } })} />
                <Field label="数据库名" value={dbConfig.mysql.database}
                  onChange={(v) => setDbConfig({ ...dbConfig, mysql: { ...dbConfig.mysql, database: v } })} />
              </div>
            )}
            <div className="flex items-center gap-3 pt-2">
              {dbConfig.type === "mysql" && (
                <button onClick={handleTestDb} disabled={testingDb}
                  className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                  {testingDb ? "测试中..." : "测试连接"}
                </button>
              )}
              <button onClick={handleSaveDb} disabled={savingDb}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {savingDb ? "保存中..." : "保存并切换"}
              </button>
              <span className="text-xs text-gray-400">
                {dbConfig.type === "sqlite" ? "数据存储在本地 data.db 文件" : "切换时会自动迁移已有数据"}
              </span>
            </div>
          </div>
        )}

        {/* Students Tab */}
        {activeTab === "students" && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
            <h2 className="font-semibold text-gray-800">学生管理</h2>

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
        )}

        {/* Export Tab */}
        {activeTab === "export" && (
          <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
            <h2 className="font-semibold text-gray-800">数据导出</h2>

            {/* Scope */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">导出范围</label>
              <div className="flex flex-wrap gap-4">
                {([
                  ["all", "全部档案"],
                  ["students", "学生名单"],
                  ["byIds", "按学号筛选"],
                  ["date", "按时间筛选"],
                ] as const).map(([val, label]) => (
                  <label key={val} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="radio" name="exportScope" checked={exportScope === val}
                      onChange={() => setExportScope(val)}
                      className="text-green-500 focus:ring-green-300" />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Filter conditions */}
            {exportScope === "byIds" && (
              <div>
                <label className="block text-xs text-gray-500 mb-1">学号列表（逗号分隔）</label>
                <input type="text" value={exportIds} onChange={(e) => setExportIds(e.target.value)}
                  placeholder="202505050101,202505050102"
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300" />
              </div>
            )}
            {exportScope === "date" && (
              <div className="flex gap-4 items-end">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">开始日期</label>
                  <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">结束日期</label>
                  <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
                    className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
                </div>
              </div>
            )}

            {/* Format */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">导出格式</label>
              <div className="flex gap-4">
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="radio" name="exportFormat" checked={exportFormat === "csv"}
                    onChange={() => setExportFormat("csv")} className="text-green-500 focus:ring-green-300" />
                  CSV
                </label>
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                  <input type="radio" name="exportFormat" checked={exportFormat === "xlsx"}
                    onChange={() => setExportFormat("xlsx")} className="text-green-500 focus:ring-green-300" />
                  Excel (.xlsx)
                </label>
              </div>
              {exportFormat === "xlsx" && (
                <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer ml-1">
                  <input type="checkbox" checked={embedImages} onChange={(e) => setEmbedImages(e.target.checked)}
                    className="rounded border-gray-300 text-green-500 focus:ring-green-300" />
                  将图片资源插入到表格中
                </label>
              )}
            </div>

            {/* Columns */}
            <div className="space-y-2">
              <label className="text-sm font-medium text-gray-700">自定义列</label>
              <div className="flex flex-wrap gap-4">
                {([
                  ["studentId", "学号"],
                  ["name", "姓名"],
                  ["tags", "标签"],
                  ["avatarUrl", "虚拟形象URL"],
                  ["evaluationUrl", "评价词云URL"],
                  ["createdAt", "提交时间"],
                ] as const).map(([key, label]) => (
                  <label key={key} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
                    <input type="checkbox" checked={exportColumns[key]}
                      onChange={(e) => setExportColumns({ ...exportColumns, [key]: e.target.checked })}
                      className="rounded border-gray-300 text-green-500 focus:ring-green-300" />
                    {label}
                  </label>
                ))}
              </div>
            </div>

            {/* Actions */}
            <div className="flex gap-3">
              <button onClick={handlePreview} disabled={previewing}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {previewing ? "加载中..." : "预览数据"}
              </button>
              <button onClick={handleExportFile} disabled={exporting}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {exporting ? "导出中..." : "导出文件"}
              </button>
              {exportScope !== "students" && (
                <button onClick={handleExportImages} disabled={exporting}
                  className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                  {exporting ? "打包中..." : "下载图片包"}
                </button>
              )}
            </div>

            {/* Preview */}
            {previewData.length > 0 && (
              <div className="space-y-2">
                <p className="text-sm text-gray-500">
                  预览（前 {previewData.length} 条，共 {previewTotal} 条）
                </p>
                <div className="overflow-x-auto border border-gray-100 rounded-lg">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-gray-50 text-left text-gray-500">
                        {Object.keys(previewData[0]).map((key) => (
                          <th key={key} className="px-3 py-2 font-medium">{key}</th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {previewData.map((row, i) => (
                        <tr key={i} className="hover:bg-gray-50/50">
                          {Object.values(row).map((val, j) => (
                            <td key={j} className="px-3 py-2 text-gray-600 max-w-[200px] truncate">{String(val)}</td>
                          ))}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}
      </main>

      {/* Detail Modal */}
      {detail && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4" onClick={() => setDetail(null)}>
          <div className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">档案详情</h3>
              <button onClick={() => setDetail(null)} className="text-gray-400 hover:text-gray-600">×</button>
            </div>
            <div className="space-y-2 text-sm">
              <div className="flex justify-between"><span className="text-gray-500">学号</span><span className="font-mono">{detail.studentId}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">姓名</span><span>{detail.studentName || "-"}</span></div>
              <div className="flex justify-between"><span className="text-gray-500">提交时间</span><span>{detail.createdAt}</span></div>
            </div>
            {detail.avatarUrl && (
              <img src={detail.avatarUrl} alt="" className="w-16 h-16 rounded-full object-cover" />
            )}
            <div>
              <p className="text-xs text-gray-500 mb-2">标签（{detail.tags.length}个）</p>
              <div className="flex flex-wrap gap-1">
                {detail.tags.map((t) => (
                  <span key={t} className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs">{t}</span>
                ))}
              </div>
            </div>
            {detail.evaluationUrl && (
              <div>
                <p className="text-xs text-gray-500 mb-2">评价词云</p>
                <img src={detail.evaluationUrl} alt="" className="w-full rounded-lg border border-gray-100" />
              </div>
            )}
            <button onClick={() => { handleDeleteProfiles([detail.studentId]); setDetail(null); }}
              className="w-full py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors">
              删除此记录
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="bg-white rounded-xl border border-gray-100 p-5">
      <p className="text-xs text-gray-500">{label}</p>
      <p className="text-2xl font-bold text-gray-900 mt-1">{value}</p>
    </div>
  );
}

function Field({ label, value, onChange, type = "text" }: {
  label: string; value: string; onChange: (v: string) => void; type?: string;
}) {
  return (
    <div>
      <label className="block text-xs text-gray-500 mb-1">{label}</label>
      <input type={type} value={value} onChange={(e) => onChange(e.target.value)}
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
    </div>
  );
}
