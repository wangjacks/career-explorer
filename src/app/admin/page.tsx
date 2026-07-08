"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { Toaster, toast } from "sonner";

interface Profile {
  studentId: string;
  studentName: string;
  tags: string[];
  avatarUrl: string;
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
  const [stats, setStats] = useState<Stats | null>(null);
  const [paged, setPaged] = useState<PagedData | null>(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [showSettings, setShowSettings] = useState(false);
  const [testingDb, setTestingDb] = useState(false);
  const [savingDb, setSavingDb] = useState(false);

  // Student management
  const [students, setStudents] = useState<Student[]>([]);
  const [showStudents, setShowStudents] = useState(false);
  const [newStudentId, setNewStudentId] = useState("");
  const [newStudentName, setNewStudentName] = useState("");
  const [selectedStudents, setSelectedStudents] = useState<Set<string>>(new Set());
  const batchInputRef = useRef<HTMLTextAreaElement>(null);

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

  const handleExport = async () => {
    try {
      const res = await fetch("/api/admin/export", { headers: authHeaders() });
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `profiles_${Date.now()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch {
      toast.error("导出失败");
    }
  };

  // Profile delete
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

  // Student management
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

    const students = dataLines.map((line) => {
      const cells = line.split(/[,，\t]/).map((s) => s.trim());
      return { studentId: cells[idCol] || "", name: cells[nameCol] || "" };
    });
    try {
      const res = await fetch("/api/admin/students", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
        body: JSON.stringify({ students }),
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

  // DB settings
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

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />

      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">后台管理</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={handleExport}
              className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
              导出 CSV
            </button>
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

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Data Source Settings */}
        <Collapsible
          title="数据源设置"
          badge={dbConfig ? (dbConfig.type === "sqlite" ? "SQLite" : "MySQL") : undefined}
          badgeColor={dbConfig?.type === "sqlite" ? "amber" : "blue"}
          open={showSettings}
          onToggle={() => setShowSettings(!showSettings)}
        >
          {dbConfig && (
            <div className="space-y-4">
              <div className="flex items-center gap-4">
                <label className="text-sm text-gray-600">数据源类型</label>
                <select
                  value={dbConfig.type}
                  onChange={(e) =>
                    setDbConfig({ ...dbConfig, type: e.target.value as "sqlite" | "mysql" })
                  }
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
        </Collapsible>

        {/* Student Management */}
        <Collapsible
          title="学生管理"
          badge={`${students.length} 名`}
          badgeColor="blue"
          open={showStudents}
          onToggle={() => setShowStudents(!showStudents)}
        >
          <div className="space-y-4">
            {/* Add single student */}
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

            {/* Batch import */}
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

            {/* Student list */}
            <div className="border border-gray-100 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-4 py-2 bg-gray-50 text-sm">
                <span className="text-gray-600">学生列表</span>
                {selectedStudents.size > 0 && (
                  <button onClick={() => handleDeleteStudents(Array.from(selectedStudents))}
                    className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg">
                    删除选中（{selectedStudents.size}）
                  </button>
                )}
              </div>
              <div className="max-h-64 overflow-y-auto">
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
        </Collapsible>

        {/* Stats */}
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

        {/* Profiles Table */}
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
                    <td colSpan={7} className="px-5 py-12 text-center text-gray-400">暂无数据</td>
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

function Collapsible({
  title, badge, badgeColor, open, onToggle, children,
}: {
  title: string; badge?: string; badgeColor?: string;
  open: boolean; onToggle: () => void; children: React.ReactNode;
}) {
  const colorMap: Record<string, string> = {
    amber: "bg-amber-50 text-amber-700",
    blue: "bg-blue-50 text-blue-700",
  };
  return (
    <div className="bg-white rounded-xl border border-gray-100 overflow-hidden">
      <button onClick={onToggle} className="w-full px-5 py-4 flex items-center justify-between text-left hover:bg-gray-50/50 transition-colors">
        <div className="flex items-center gap-3">
          <span className="text-sm font-semibold text-gray-800">{title}</span>
          {badge && <span className={`px-2 py-0.5 rounded text-xs font-medium ${colorMap[badgeColor || "blue"]}`}>{badge}</span>}
        </div>
        <svg className={`w-5 h-5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && <div className="px-5 pb-5 border-t border-gray-100 pt-4">{children}</div>}
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
