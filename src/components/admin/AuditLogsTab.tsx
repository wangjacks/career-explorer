"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { toast } from "sonner";

/** 审计记录（与后端 AuditLogRow 对应） */
interface AuditLog {
  id: number;
  created_at: string;
  actor_id: number | null;
  actor_user_code: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string;
  method: string | null;
  path: string | null;
  resource_type: string | null;
  resource_id: string | null;
  status: string;
  error_message: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: string | null;
}

interface AuditLogsTabProps {
  /** 教师端隐藏操作者/角色筛选（后端强制仅返回本人记录） */
  mode: "admin" | "teacher";
}

const PAGE_SIZE = 20;

/** 动作词汇表（与埋点一致，#110；#95/#118/#117 新增动作同步维护） */
const ACTIONS = [
  "auth:login", "auth:login-failed", "auth:logout", "auth:activate", "auth:activate-verify",
  "student:create", "student:batch-import", "student:update", "student:delete",
  "student:reset-password", "student:batch-password",
  "teacher:create", "teacher:update", "teacher:delete",
  "class:create", "class:update", "class:delete", "class:reset-code",
  "tag:create", "tag:update", "tag:delete", "tag:batch-import", "tag:restore-defaults",
  "settings:update", "profile-config:update",
  "export:excel", "export:images",
  "backup:create", "backup:restore",
  "test-db:run", "profile:submit", "profile:restore", "profile-submission:cleanup",
  "media:query", "media:config-update", "media:cleanup", "media:thumbnail-backfill",
  "audit:query",
];

const RESOURCE_TYPES = [
  "session", "student", "teacher", "class", "tag",
  "db-config", "profile-config", "profile", "profile-submission", "media",
  "export", "backup", "db", "audit-log",
];

const ROLE_LABELS: Record<string, string> = {
  admin: "管理员",
  teacher: "教师",
  student: "学生",
};

const inputClass =
  "px-2 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-green-300";

/**
 * 操作审计页（#110）：只读查询，不提供修改/删除。
 * admin 查看全部记录；教师仅本人记录（后端强制，筛选器相应隐藏）。
 */
export default function AuditLogsTab({ mode }: AuditLogsTabProps) {
  const [rows, setRows] = useState<AuditLog[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [expanded, setExpanded] = useState<number | null>(null);

  // 筛选条件
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [action, setAction] = useState("");
  const [resourceType, setResourceType] = useState("");
  const [status, setStatus] = useState("");
  const [actorQuery, setActorQuery] = useState("");
  const [actorRole, setActorRole] = useState("");

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const load = useCallback(async (p: number) => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const params = new URLSearchParams({ page: String(p), pageSize: String(PAGE_SIZE) });
      if (dateFrom) params.set("from", dateFrom);
      // 日期型 to 补齐到当天末尾，保证包含当天记录
      if (dateTo) params.set("to", dateTo.length === 10 ? `${dateTo} 23:59:59` : dateTo);
      if (action) params.set("action", action);
      if (resourceType) params.set("resourceType", resourceType);
      if (status) params.set("status", status);
      if (mode === "admin") {
        if (actorQuery.trim()) params.set("actor", actorQuery.trim());
        if (actorRole) params.set("role", actorRole);
      }
      const res = await fetch(`/api/manage/audit-logs?${params.toString()}`);
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "查询失败");
      setRows(data.data || []);
      setTotal(data.total || 0);
      setPage(p);
    } catch (err) {
      console.error("Audit logs load failed:", err);
      setLoadFailed(true);
      toast.error(err instanceof Error ? err.message : "查询失败");
    } finally {
      setLoading(false);
    }
  }, [dateFrom, dateTo, action, resourceType, status, actorQuery, actorRole, mode]);

  /* eslint-disable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps -- 首次进入加载一次，筛选变更由「查询」按钮显式触发 */
  useEffect(() => {
    load(1);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect, react-hooks/exhaustive-deps */

  const handleSearch = () => load(1);

  return (
    <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-4">
      <div>
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">操作审计</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          {mode === "admin"
            ? "记录管理操作、认证事件与档案提交的完整审计轨迹；只读，不可修改删除。"
            : "仅展示你本人产生的操作记录；只读，不可修改删除。"}
        </p>
      </div>

      {/* 筛选栏 */}
      <div className="flex flex-wrap items-center gap-2">
        <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} className={inputClass} aria-label="开始日期" />
        <span className="text-xs text-gray-400 dark:text-gray-500">至</span>
        <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} className={inputClass} aria-label="结束日期" />
        <select value={action} onChange={(e) => setAction(e.target.value)} className={inputClass} aria-label="操作类型">
          <option value="">全部操作</option>
          {ACTIONS.map((a) => (
            <option key={a} value={a}>{a}</option>
          ))}
        </select>
        <select value={resourceType} onChange={(e) => setResourceType(e.target.value)} className={inputClass} aria-label="资源类型">
          <option value="">全部对象</option>
          {RESOURCE_TYPES.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
        <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputClass} aria-label="结果">
          <option value="">全部结果</option>
          <option value="success">成功</option>
          <option value="failed">失败</option>
        </select>
        {mode === "admin" && (
          <>
            <input
              type="text"
              value={actorQuery}
              onChange={(e) => setActorQuery(e.target.value)}
              placeholder="操作者/对象编号"
              className={`${inputClass} w-36`}
              aria-label="操作者搜索"
            />
            <select value={actorRole} onChange={(e) => setActorRole(e.target.value)} className={inputClass} aria-label="角色">
              <option value="">全部角色</option>
              <option value="admin">管理员</option>
              <option value="teacher">教师</option>
              <option value="student">学生</option>
            </select>
          </>
        )}
        <button
          onClick={handleSearch}
          disabled={loading}
          className="px-4 py-1.5 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
        >
          {loading ? "查询中..." : "查询"}
        </button>
      </div>

      {loadFailed && rows.length === 0 && (
        <div className="text-center py-6 space-y-2">
          <p className="text-sm text-red-500">审计记录加载失败</p>
          <button onClick={() => load(page)} className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg">
            重试
          </button>
        </div>
      )}

      {/* 记录表 */}
      <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 dark:bg-gray-800">
            <tr className="text-left text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-700">
              <th className="px-3 py-2 font-medium whitespace-nowrap">时间</th>
              <th className="px-3 py-2 font-medium">操作者</th>
              <th className="px-3 py-2 font-medium">动作</th>
              <th className="px-3 py-2 font-medium">对象</th>
              <th className="px-3 py-2 font-medium">结果</th>
              <th className="px-3 py-2 font-medium w-10"></th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                  <td className="px-3 py-2 whitespace-nowrap font-mono text-xs">{r.created_at}</td>
                  <td className="px-3 py-2">
                    <div className="flex items-center gap-1.5">
                      <span>{r.actor_name || r.actor_user_code || "-"}</span>
                      {r.actor_role && (
                        <span className="px-1.5 py-0.5 text-[10px] rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
                          {ROLE_LABELS[r.actor_role] || r.actor_role}
                        </span>
                      )}
                    </div>
                  </td>
                  <td className="px-3 py-2 font-mono text-xs">{r.action}</td>
                  <td className="px-3 py-2 font-mono text-xs">
                    {r.resource_type ? `${r.resource_type}${r.resource_id ? `:${r.resource_id}` : ""}` : "-"}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`px-1.5 py-0.5 text-[10px] rounded-full font-medium ${
                        r.status === "success"
                          ? "bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300"
                          : "bg-red-100 dark:bg-red-900/40 text-red-700 dark:text-red-300"
                      }`}
                    >
                      {r.status === "success" ? "成功" : "失败"}
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button
                      onClick={() => setExpanded(expanded === r.id ? null : r.id)}
                      className="text-xs text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                      aria-label="展开详情"
                    >
                      {expanded === r.id ? "收起" : "详情"}
                    </button>
                  </td>
                </tr>
                {expanded === r.id && (
                  <tr className="bg-gray-50/60 dark:bg-gray-800/30">
                    <td colSpan={6} className="px-4 py-3">
                      <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs text-gray-600 dark:text-gray-300">
                        <p><span className="text-gray-400 dark:text-gray-500">编号：</span>{r.actor_user_code || "-"}</p>
                        <p><span className="text-gray-400 dark:text-gray-500">IP：</span>{r.ip || "-"}</p>
                        <p><span className="text-gray-400 dark:text-gray-500">请求：</span>{r.method} {r.path}</p>
                        <p className="sm:col-span-2 break-all"><span className="text-gray-400 dark:text-gray-500">UA：</span>{r.user_agent || "-"}</p>
                        {r.error_message && (
                          <p className="sm:col-span-2 text-red-500"><span className="text-gray-400 dark:text-gray-500">错误：</span>{r.error_message}</p>
                        )}
                        {r.metadata && (
                          <pre className="sm:col-span-2 bg-card border border-gray-100 dark:border-gray-700 rounded p-2 overflow-x-auto">
                            {(() => {
                              try {
                                return JSON.stringify(JSON.parse(r.metadata), null, 2);
                              } catch {
                                return r.metadata;
                              }
                            })()}
                          </pre>
                        )}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
            {!loading && rows.length === 0 && (
              <tr>
                <td colSpan={6} className="px-3 py-8 text-center text-sm text-gray-400 dark:text-gray-500">
                  暂无审计记录
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* 分页 */}
      <div className="flex items-center justify-between text-sm">
        <p className="text-xs text-gray-400 dark:text-gray-500">
          共 {total} 条，第 {page}/{totalPages} 页
        </p>
        <div className="flex gap-2">
          <button
            onClick={() => load(page - 1)}
            disabled={page <= 1 || loading}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            上一页
          </button>
          <button
            onClick={() => load(page + 1)}
            disabled={page >= totalPages || loading}
            className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 rounded-lg disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
          >
            下一页
          </button>
        </div>
      </div>
    </div>
  );
}
