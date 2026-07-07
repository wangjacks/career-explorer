"use client";

import { useState, useEffect, useCallback } from "react";
import { Toaster, toast } from "sonner";

interface Profile {
  id: number;
  tags: string[];
  avatarUrl: string;
  createdAt: string;
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

export default function AdminPage() {
  const [password, setPassword] = useState("");
  const [loggedIn, setLoggedIn] = useState(false);
  const [stats, setStats] = useState<Stats | null>(null);
  const [paged, setPaged] = useState<PagedData | null>(null);
  const [page, setPage] = useState(1);
  const [detail, setDetail] = useState<Profile | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const authHeaders = useCallback(
    () => ({ Authorization: `Bearer ${password}` }),
    [password]
  );

  const loadStats = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/stats", {
        headers: authHeaders(),
      });
      if (res.ok) setStats(await res.json());
    } catch {}
  }, [authHeaders]);

  const loadProfiles = useCallback(
    async (p: number) => {
      try {
        const res = await fetch(`/api/admin/profiles?page=${p}`, {
          headers: authHeaders(),
        });
        if (res.ok) setPaged(await res.json());
      } catch {}
    },
    [authHeaders]
  );

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
    }
  }, [loggedIn, page, loadStats, loadProfiles]);

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
      const res = await fetch("/api/admin/export", {
        headers: authHeaders(),
      });
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

  const handleDelete = async (ids: number[]) => {
    if (!confirm(`确定删除 ${ids.length} 条记录？`)) return;
    try {
      const res = await fetch("/api/admin/profiles", {
        method: "DELETE",
        headers: {
          ...authHeaders(),
          "Content-Type": "application/json",
        },
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

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleSelectAll = () => {
    if (!paged) return;
    if (selected.size === paged.data.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(paged.data.map((p) => p.id)));
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
                onClick={() => handleDelete(Array.from(selected))}
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
                      onChange={toggleSelectAll}
                      className="rounded border-gray-300"
                    />
                  </th>
                  <th className="px-5 py-3 font-medium">ID</th>
                  <th className="px-5 py-3 font-medium">标签</th>
                  <th className="px-5 py-3 font-medium">头像</th>
                  <th className="px-5 py-3 font-medium">提交时间</th>
                  <th className="px-5 py-3 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {paged?.data.map((p) => (
                  <tr
                    key={p.id}
                    className={`hover:bg-gray-50/50 ${
                      selected.has(p.id) ? "bg-blue-50/30" : ""
                    }`}
                  >
                    <td className="px-5 py-3">
                      <input
                        type="checkbox"
                        checked={selected.has(p.id)}
                        onChange={() => toggleSelect(p.id)}
                        className="rounded border-gray-300"
                      />
                    </td>
                    <td className="px-5 py-3 text-gray-600">{p.id}</td>
                    <td className="px-5 py-3">
                      <div className="flex flex-wrap gap-1">
                        {p.tags.slice(0, 3).map((t) => (
                          <span
                            key={t}
                            className="px-2 py-0.5 bg-green-50 text-green-700 rounded text-xs"
                          >
                            {t}
                          </span>
                        ))}
                        {p.tags.length > 3 && (
                          <span className="text-xs text-gray-400">
                            +{p.tags.length - 3}
                          </span>
                        )}
                      </div>
                    </td>
                    <td className="px-5 py-3">
                      {p.avatarUrl ? (
                        <img
                          src={p.avatarUrl}
                          alt=""
                          className="w-8 h-8 rounded-full object-cover"
                        />
                      ) : (
                        <span className="text-gray-400 text-xs">无</span>
                      )}
                    </td>
                    <td className="px-5 py-3 text-gray-500 text-xs">
                      {p.createdAt}
                    </td>
                    <td className="px-5 py-3">
                      <div className="flex items-center gap-2">
                        <button
                          onClick={() => setDetail(p)}
                          className="text-green-600 hover:text-green-700 text-xs font-medium"
                        >
                          查看
                        </button>
                        <button
                          onClick={() => handleDelete([p.id])}
                          className="text-red-500 hover:text-red-600 text-xs font-medium"
                        >
                          删除
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
                {paged?.data.length === 0 && (
                  <tr>
                    <td
                      colSpan={6}
                      className="px-5 py-12 text-center text-gray-400"
                    >
                      暂无数据
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>

          {paged && paged.totalPages > 1 && (
            <div className="px-5 py-3 border-t border-gray-100 flex items-center justify-between text-sm">
              <span className="text-gray-500">
                第 {paged.page}/{paged.totalPages} 页
              </span>
              <div className="flex gap-2">
                <button
                  onClick={() => setPage((p) => Math.max(1, p - 1))}
                  disabled={page <= 1}
                  className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                >
                  上一页
                </button>
                <button
                  onClick={() =>
                    setPage((p) => Math.min(paged.totalPages, p + 1))
                  }
                  disabled={page >= paged.totalPages}
                  className="px-3 py-1 rounded-lg border border-gray-200 disabled:opacity-40 hover:bg-gray-50"
                >
                  下一页
                </button>
              </div>
            </div>
          )}
        </div>
      </main>

      {detail && (
        <div
          className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4"
          onClick={() => setDetail(null)}
        >
          <div
            className="bg-white rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800">
                档案详情 #{detail.id}
              </h3>
              <button
                onClick={() => setDetail(null)}
                className="text-gray-400 hover:text-gray-600"
              >
                ×
              </button>
            </div>
            <div className="flex items-center gap-4">
              {detail.avatarUrl ? (
                <img
                  src={detail.avatarUrl}
                  alt=""
                  className="w-16 h-16 rounded-full object-cover"
                />
              ) : (
                <div className="w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center text-gray-400 text-xs">
                  无头像
                </div>
              )}
              <div>
                <p className="text-xs text-gray-500">提交时间</p>
                <p className="text-sm text-gray-700">{detail.createdAt}</p>
              </div>
            </div>
            <div>
              <p className="text-xs text-gray-500 mb-2">
                标签（{detail.tags.length}个）
              </p>
              <div className="flex flex-wrap gap-1">
                {detail.tags.map((t) => (
                  <span
                    key={t}
                    className="px-2 py-1 bg-green-50 text-green-700 rounded text-xs"
                  >
                    {t}
                  </span>
                ))}
              </div>
            </div>
            <button
              onClick={() => {
                handleDelete([detail.id]);
                setDetail(null);
              }}
              className="w-full py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors"
            >
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
