"use client";

import { useCallback, useEffect, useId, useState } from "react";
import { toast } from "sonner";
import ConfirmDialog from "./ConfirmDialog";
import { StatCard } from "./AdminUI";
import { generatePassword } from "@/lib/password";
import { pickName, DEMO_NAME_MAX } from "@/lib/demo-names";
import { ROLE_LABELS } from "@/lib/role-labels";
import {
  DEMO_STATUS_CARDS,
  demoCreateAccountBody,
  demoCredentialCopyText,
  demoCredentialRows,
  type DemoAccountCodes,
  type DemoResetReport,
  type DemoStatus,
  type DemoVisitorAccount,
} from "@/lib/demo-admin";

type Phase = "loading" | "disabled" | "ready" | "error";

type PendingKind = "disable" | "enable" | "regenerate-password" | "delete";

interface PendingAction {
  kind: PendingKind;
  account: DemoVisitorAccount;
}

interface CredentialsState {
  title: string;
  name?: string;
  codes: DemoAccountCodes;
  password: string;
}

const REPORT_FIELDS: { key: keyof Omit<DemoResetReport, "classId">; label: string }[] = [
  { key: "students", label: "学生" },
  { key: "submitted", label: "已提交" },
  { key: "assessed", label: "已测评" },
  { key: "drafts", label: "进行中草稿" },
  { key: "groups", label: "分组" },
  { key: "images", label: "占位图" },
];

function errorMessage(err: unknown, fallback: string): string {
  return err instanceof Error && err.message ? err.message : fallback;
}

async function copyDemoCredentials(data: CredentialsState): Promise<void> {
  try {
    await navigator.clipboard.writeText(demoCredentialCopyText(data));
    toast.success("已复制到剪贴板");
  } catch (err) {
    console.error("复制演示凭据失败:", err);
    toast.error("复制失败，请手动选择文本");
  }
}

function DisabledGuide() {
  return (
    <div className="bg-card rounded-xl border border-border-soft p-6 space-y-3">
      <h3 className="text-sm font-semibold text-foreground">演示模式未启用</h3>
      <p className="text-sm text-muted">
        当前实例没有开启演示环境。请在服务端环境变量中设置后重启进程：
      </p>
      <pre className="rounded-lg bg-gray-50 dark:bg-gray-800 px-4 py-3 text-xs font-mono text-foreground overflow-x-auto">{`DEMO_ENABLED=true
# 可选，默认 ./data/career-demo.db
DEMO_DB_PATH=./data/career-demo.db`}</pre>
      <p className="text-xs text-muted">
        演示库始终是独立 SQLite，不会写入生产库；演示上传文件固定落在
        <code className="mx-1 font-mono">UPLOADS_DIR/demo</code>
        下。修改环境变量后需重启应用生效。
      </p>
    </div>
  );
}

/** 一次性凭据弹窗：关闭后密码不可再查看，因此不允许点遮罩或 Escape 关闭 */
function DemoCredentialsDialog({ data, onClose }: { data: CredentialsState; onClose: () => void }) {
  const titleId = useId();
  const rows = demoCredentialRows(data);

  return (
    <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4"
      >
        <h3 id={titleId} className="font-semibold text-foreground text-lg">
          {data.title}
        </h3>
        <p className="text-xs text-amber-600 dark:text-amber-400">
          密码仅此一次显示，关闭后无法再次查看，请立即复制并妥善交付。
        </p>
        <div className="space-y-2 text-sm">
          {rows.map((row) => (
            <div
              key={row.label}
              className="flex items-center justify-between gap-3 bg-gray-50 dark:bg-gray-800 rounded-lg px-3 py-2"
            >
              <span className="text-muted text-xs flex-shrink-0">{row.label}</span>
              <code className="font-mono text-xs font-medium text-foreground break-all text-right">
                {row.value}
              </code>
            </div>
          ))}
        </div>
        <div className="flex gap-2 pt-2">
          <button
            type="button"
            onClick={() => void copyDemoCredentials(data)}
            className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
          >
            复制全部
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex-1 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
          >
            我已记录
          </button>
        </div>
      </div>
    </div>
  );
}

export default function DemoTab() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [loadError, setLoadError] = useState("");
  const [refreshing, setRefreshing] = useState(false);
  const [status, setStatus] = useState<DemoStatus | null>(null);
  const [accounts, setAccounts] = useState<DemoVisitorAccount[]>([]);
  const [accountsLoading, setAccountsLoading] = useState(false);
  const [resetResult, setResetResult] = useState<DemoResetReport | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const [resetting, setResetting] = useState(false);
  const [newName, setNewName] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [creating, setCreating] = useState(false);
  const [busySeq, setBusySeq] = useState<number | null>(null);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [credentials, setCredentials] = useState<CredentialsState | null>(null);

  const loadAccounts = useCallback(async () => {
    setAccountsLoading(true);
    try {
      const res = await fetch("/api/manage/demo/accounts");
      const data = (await res.json().catch(() => null)) as
        | { accounts?: DemoVisitorAccount[]; error?: string }
        | null;
      if (!res.ok) throw new Error(data?.error || "加载访客账户失败");
      setAccounts(Array.isArray(data?.accounts) ? data.accounts : []);
    } catch (err) {
      console.error("Failed to load demo accounts:", err);
      toast.error(errorMessage(err, "加载访客账户失败"));
    } finally {
      setAccountsLoading(false);
    }
  }, []);

  const loadStatus = useCallback(
    async (silent = false) => {
      if (silent) setRefreshing(true);
      else setPhase("loading");
      try {
        const res = await fetch("/api/manage/demo/status");
        // 404 是「演示模式未启用」的正常语义，不是加载失败
        if (res.status === 404) {
          setStatus(null);
          setAccounts([]);
          setPhase("disabled");
          return;
        }
        const data = (await res.json().catch(() => null)) as (DemoStatus & { error?: string }) | null;
        if (!res.ok || !data) throw new Error(data?.error || "加载演示状态失败");
        setStatus(data);
        setPhase("ready");
        await loadAccounts();
      } catch (err) {
        const message = errorMessage(err, "加载演示状态失败");
        console.error("Failed to load demo status:", err);
        if (silent) {
          toast.error(message);
        } else {
          setLoadError(message);
          setPhase("error");
        }
      } finally {
        if (silent) setRefreshing(false);
      }
    },
    [loadAccounts]
  );

  /* eslint-disable react-hooks/set-state-in-effect -- load on mount */
  useEffect(() => {
    void loadStatus();
  }, [loadStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const doReset = async () => {
    setConfirmReset(false);
    setResetting(true);
    try {
      const res = await fetch("/api/manage/demo/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all" }),
      });
      const data = (await res.json().catch(() => null)) as
        | { ok?: boolean; report?: DemoResetReport; error?: string }
        | null;
      if (!res.ok || !data?.ok || !data.report) {
        throw new Error(data?.error || "重置失败");
      }
      setResetResult(data.report);
      setAccounts([]);
      toast.success(status?.initialized ? "演示数据已重置" : "演示数据已生成");
      await loadStatus(true);
    } catch (err) {
      console.error("Demo reset error:", err);
      toast.error(errorMessage(err, "重置失败"));
    } finally {
      setResetting(false);
    }
  };

  const createAccount = async () => {
    const parsed = demoCreateAccountBody({ rawName: newName, rawPassword: newPassword });
    if (!parsed.ok) {
      toast.warning(parsed.error);
      return;
    }
    setCreating(true);
    try {
      const res = await fetch("/api/manage/demo/accounts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(parsed.body),
      });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            seq?: number;
            name?: string;
            password?: string;
            codes?: DemoAccountCodes;
            error?: string;
          }
        | null;
      if (!res.ok || !data?.ok || !data.password || !data.codes) {
        if (res.status === 409) void loadStatus(true);
        throw new Error(data?.error || "创建失败");
      }
      setCredentials({
        title: "访客账户已创建",
        name: data.name,
        codes: data.codes,
        password: data.password,
      });
      setNewName("");
      setNewPassword("");
      toast.success("访客账户已创建");
      await loadStatus(true);
    } catch (err) {
      console.error("Demo account create error:", err);
      toast.error(errorMessage(err, "创建失败"));
    } finally {
      setCreating(false);
    }
  };

  const runPendingAction = async () => {
    if (!pending) return;
    const { kind, account } = pending;
    setPending(null);
    setBusySeq(account.seq);
    try {
      const res =
        kind === "delete"
          ? await fetch(`/api/manage/demo/accounts/${account.seq}`, { method: "DELETE" })
          : await fetch(`/api/manage/demo/accounts/${account.seq}`, {
              method: "PATCH",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({
                action: kind === "regenerate-password" ? "regenerate-password" : kind,
              }),
            });
      const data = (await res.json().catch(() => null)) as
        | {
            ok?: boolean;
            password?: string;
            codes?: DemoAccountCodes;
            error?: string;
          }
        | null;
      if (!res.ok || !data?.ok) throw new Error(data?.error || "操作失败");

      if (kind === "delete") {
        toast.success(`访客账户 #${account.seq} 已删除`);
      } else if (kind === "disable") {
        toast.success(`访客账户 #${account.seq} 已禁用`);
      } else {
        if (!data.password || !data.codes) throw new Error("服务端未返回新密码");
        setCredentials({
          title: kind === "enable" ? "账户已启用，新密码如下" : "密码已重置",
          name: account.name,
          codes: data.codes,
          password: data.password,
        });
        toast.success(kind === "enable" ? "账户已启用" : "密码已重置");
      }
      await loadStatus(true);
    } catch (err) {
      console.error("Demo account action error:", err);
      toast.error(errorMessage(err, "操作失败"));
    } finally {
      setBusySeq(null);
    }
  };

  if (phase === "loading") {
    return <p className="p-5 text-sm text-muted">加载中...</p>;
  }

  if (phase === "disabled") {
    return <DisabledGuide />;
  }

  if (phase === "error") {
    return (
      <div className="bg-card rounded-xl border border-border-soft p-6 space-y-3">
        <p className="text-sm text-red-500">{loadError}</p>
        <button
          type="button"
          onClick={() => void loadStatus()}
          className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
        >
          重试
        </button>
      </div>
    );
  }

  if (!status) return null;

  const pendingCopy = (() => {
    if (!pending) return null;
    const { kind, account } = pending;
    const name = account.name || `#${account.seq}`;
    if (kind === "delete") {
      return {
        title: "删除访客账户",
        variant: "danger" as const,
        confirmText: "删除",
        message: `确定删除访客账户「${name}」？将级联清除其档案版本、分组成员、测评结果与演示上传文件，此操作不可恢复。`,
      };
    }
    if (kind === "disable") {
      return {
        title: "禁用访客账户",
        variant: "warning" as const,
        confirmText: "禁用",
        message: `确定禁用「${name}」？管理员 / 教师 / 学生三个身份都将无法再次登录；已签发的会话在过期前（最长 24 小时）仍然有效。`,
      };
    }
    if (kind === "enable") {
      return {
        title: "启用访客账户",
        variant: "default" as const,
        confirmText: "启用",
        message: `确定启用「${name}」？服务端会生成一个新密码并使旧密码失效，新密码仅显示一次。`,
      };
    }
    return {
      title: "重置访客密码",
      variant: "warning" as const,
      confirmText: "重置密码",
      message: `确定为「${name}」重置密码？三个身份共用新密码，旧密码立即失效，新密码仅显示一次。`,
    };
  })();

  return (
    <div className="space-y-6">
      {/* 状态 */}
      <div className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-sm font-semibold text-foreground">演示库状态</h3>
            <p className="text-xs text-muted mt-1 break-all font-mono">{status.dbPath}</p>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`text-xs px-2 py-1 rounded-full ${
                status.initialized
                  ? "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                  : "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
              }`}
            >
              {status.initialized ? "已初始化" : "未初始化"}
            </span>
            <button
              type="button"
              onClick={() => void loadStatus(true)}
              disabled={refreshing}
              className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-xs rounded-lg transition-colors disabled:opacity-40"
            >
              {refreshing ? "刷新中..." : "刷新"}
            </button>
          </div>
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {DEMO_STATUS_CARDS.map((card) => (
            <StatCard
              key={card.key}
              label={card.label}
              value={status.counts[card.key]}
              color={card.color}
            />
          ))}
        </div>
      </div>

      {/* 生成 / 重置 */}
      <div className="bg-card rounded-xl border border-amber-200 dark:border-amber-800 p-5 space-y-3">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-foreground">演示数据</h3>
            <p className="text-xs text-muted mt-1">
              生成一套随机演示数据；当前仅支持全量重置，重置会清空全部访客账户。
            </p>
          </div>
          <button
            type="button"
            onClick={() => setConfirmReset(true)}
            disabled={resetting}
            className="px-4 py-2 bg-danger hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            {resetting ? "处理中..." : status.initialized ? "重置演示数据" : "生成演示数据"}
          </button>
        </div>
        {resetResult && (
          <div>
            <p className="text-xs text-muted mb-2">本次生成结果</p>
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              {REPORT_FIELDS.map((field) => (
                <div
                  key={field.key}
                  className="rounded-lg bg-gray-50 dark:bg-gray-800 px-3 py-2"
                >
                  <p className="text-xs text-muted">{field.label}</p>
                  <p className="text-lg font-semibold text-foreground">{resetResult[field.key]}</p>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* 访客账户 */}
      <div className="bg-card rounded-xl border border-border-soft overflow-hidden">
        <div className="px-5 py-4 border-b border-border-soft flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">访客账户</h3>
          <span className="text-xs text-muted">{accounts.length} 个</span>
        </div>

        <div className="p-5 border-b border-border-soft space-y-3">
          <p className="text-xs text-muted">
            一个访客账户包含管理员 / 教师 / 学生三个身份，共用一个姓名与密码；姓名可自定义，留空则随机生成；创建后密码仅显示一次。
          </p>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder={`姓名（留空随机生成，最多 ${DEMO_NAME_MAX} 字）`}
              disabled={creating || !status.initialized}
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setNewName(pickName(Math.random))}
              disabled={creating || !status.initialized}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm rounded-lg transition-colors whitespace-nowrap disabled:opacity-40"
            >
              填入随机名称
            </button>
          </div>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="text"
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="初始密码（留空由服务端生成，至少 8 位）"
              disabled={creating || !status.initialized}
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-focus-ring disabled:opacity-50"
            />
            <button
              type="button"
              onClick={() => setNewPassword(generatePassword())}
              disabled={creating || !status.initialized}
              className="px-3 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-600 dark:text-gray-300 text-sm rounded-lg transition-colors whitespace-nowrap disabled:opacity-40"
            >
              自动生成
            </button>
            <button
              type="button"
              onClick={() => void createAccount()}
              disabled={creating || !status.initialized}
              className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap disabled:opacity-40 disabled:cursor-not-allowed"
            >
              {creating ? "创建中..." : "发放账户"}
            </button>
          </div>
          {!status.initialized && (
            <p className="text-xs text-amber-600 dark:text-amber-400">
              请先点「生成演示数据」，再发放访客账户。
            </p>
          )}
        </div>

        {accountsLoading ? (
          <p className="p-5 text-sm text-muted">加载中...</p>
        ) : accounts.length === 0 ? (
          <p className="p-5 text-sm text-muted">还没有访客账户，发放后即可交付演示凭据。</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs text-muted border-b border-border-soft">
                  <th className="px-5 py-2.5 font-medium">序号</th>
                  <th className="px-3 py-2.5 font-medium">姓名</th>
                  <th className="px-3 py-2.5 font-medium">三身份编号</th>
                  <th className="px-3 py-2.5 font-medium hidden md:table-cell">状态</th>
                  <th className="px-3 py-2.5 font-medium hidden lg:table-cell">学生档案</th>
                  <th className="px-5 py-2.5 font-medium text-right">操作</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((account) => {
                  const incomplete =
                    !account.identities.admin ||
                    !account.identities.teacher ||
                    !account.identities.student;
                  const busy = busySeq === account.seq;
                  return (
                    <tr
                      key={account.seq}
                      className="border-b border-gray-50 dark:border-gray-700/50 hover:bg-gray-50/60 dark:hover:bg-gray-800/40"
                    >
                      <td className="px-5 py-3 font-mono text-gray-700 dark:text-gray-300">
                        #{account.seq}
                      </td>
                      <td className="px-3 py-3 font-medium text-foreground">{account.name}</td>
                      <td className="px-3 py-3">
                        <div className="font-mono text-xs text-gray-700 dark:text-gray-300 space-y-0.5">
                          <div>
                            <span className="text-muted mr-1">{ROLE_LABELS.admin}</span>
                            {account.codes.admin}
                          </div>
                          <div>
                            <span className="text-muted mr-1">{ROLE_LABELS.teacher}</span>
                            {account.codes.teacher}
                          </div>
                          <div>
                            <span className="text-muted mr-1">{ROLE_LABELS.student}</span>
                            {account.codes.student}
                          </div>
                        </div>
                      </td>
                      <td className="px-3 py-3 hidden md:table-cell">
                        <span
                          className={`text-xs px-2 py-1 rounded-full ${
                            incomplete
                              ? "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                              : account.disabled
                                ? "bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300"
                                : "bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
                          }`}
                        >
                          {incomplete ? "身份不完整" : account.disabled ? "已禁用" : "启用中"}
                        </span>
                      </td>
                      <td className="px-3 py-3 text-xs text-muted hidden lg:table-cell">
                        {account.submittedAt ? "已提交" : "未提交"}
                      </td>
                      <td className="px-5 py-3 text-right whitespace-nowrap">
                        {account.disabled ? (
                          <button
                            type="button"
                            onClick={() => setPending({ kind: "enable", account })}
                            disabled={busy}
                            className="text-xs text-green-600 hover:underline mr-3 disabled:opacity-40"
                          >
                            启用并重置密码
                          </button>
                        ) : (
                          <>
                            <button
                              type="button"
                              onClick={() =>
                                setPending({ kind: "regenerate-password", account })
                              }
                              disabled={busy}
                              className="text-xs text-amber-600 hover:underline mr-3 disabled:opacity-40"
                            >
                              重置密码
                            </button>
                            <button
                              type="button"
                              onClick={() => setPending({ kind: "disable", account })}
                              disabled={busy}
                              className="text-xs text-amber-600 hover:underline mr-3 disabled:opacity-40"
                            >
                              禁用
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          onClick={() => setPending({ kind: "delete", account })}
                          disabled={busy}
                          className="text-xs text-red-500 hover:underline disabled:opacity-40"
                        >
                          {busy ? "处理中..." : "删除"}
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={confirmReset}
        title={status.initialized ? "重置演示数据" : "生成演示数据"}
        variant="danger"
        confirmText={status.initialized ? "确认重置" : "确认生成"}
        message={
          <>
            <p>
              将删除演示库并清空 <code className="font-mono">uploads/demo</code>
              ，然后重新生成一套随机演示数据。
            </p>
            <ul className="list-disc pl-5 mt-2 space-y-1">
              <li>
                <strong>全部访客账户与密码会被清除</strong>，重置后需要重新发放。
              </li>
              <li>正在使用演示环境的会话会失去对应数据。</li>
              <li>此操作不可撤销。</li>
            </ul>
          </>
        }
        onConfirm={() => void doReset()}
        onCancel={() => setConfirmReset(false)}
      />

      <ConfirmDialog
        open={pending !== null}
        title={pendingCopy?.title ?? ""}
        variant={pendingCopy?.variant ?? "default"}
        confirmText={pendingCopy?.confirmText}
        message={pendingCopy?.message ?? ""}
        onConfirm={() => void runPendingAction()}
        onCancel={() => setPending(null)}
      />

      {credentials && (
        <DemoCredentialsDialog data={credentials} onClose={() => setCredentials(null)} />
      )}
    </div>
  );
}
