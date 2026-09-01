"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import { HardDrive, Cloud, Plus, Pencil, Trash2, Star, PlugZap, ArrowRightLeft } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";

/**
 * 存储管理（#111，仅管理员可见——仅注册在管理面板）：
 * - 多存储后端注册表：本地（内置）+ 多个 S3 兼容实例（腾讯云 COS / 阿里云 OSS / MinIO…）
 * - 凭据不入库：环境变量 `S3_{id}_ACCESS_KEY` / `S3_{id}_SECRET_KEY`，页面仅展示配置状态
 * - 切换默认后端不影响存量文件（文件级路由 users.storage_id）
 */

interface StorageBackend {
  id: number;
  name: string;
  type: "local" | "s3";
  endpoint: string;
  internal_endpoint: string | null;
  region: string | null;
  bucket: string | null;
  path_prefix: string | null;
  is_default: number;
  credentialsConfigured: boolean;
}

interface BackendForm {
  name: string;
  endpoint: string;
  internal_endpoint: string;
  region: string;
  bucket: string;
  path_prefix: string;
}

const EMPTY_FORM: BackendForm = {
  name: "",
  endpoint: "",
  internal_endpoint: "",
  region: "",
  bucket: "",
  path_prefix: "",
};

/** 输入框（与功能设置页同款样式） */
function FieldInput({
  label, value, onChange, placeholder, hint, optional,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
  hint?: string;
  optional?: boolean;
}) {
  return (
    <div>
      <label className="block text-xs text-muted mb-1">
        {label}
        {optional && <span className="ml-1 text-gray-400 dark:text-gray-500">（可选）</span>}
      </label>
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
      />
      {hint && <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">{hint}</p>}
    </div>
  );
}

export default function StorageTab() {
  const [backends, setBackends] = useState<StorageBackend[]>([]);
  const [loadFailed, setLoadFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);

  // 新增/编辑对话框
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [form, setForm] = useState<BackendForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  // 删除确认
  const [deleteTarget, setDeleteTarget] = useState<StorageBackend | null>(null);

  // 测试连接 / 迁移的 loading 标记
  const [testingId, setTestingId] = useState<number | null>(null);
  const [migrateTargetId, setMigrateTargetId] = useState<number | "">("");
  const [migrating, setMigrating] = useState(false);
  const [migrateResult, setMigrateResult] = useState<string | null>(null);

  const load = async () => {
    setLoadFailed(false);
    try {
      const res = await fetch("/api/manage/storage");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "获取存储后端失败");
      setBackends(data.backends ?? []);
      setLoaded(true);
    } catch (err) {
      console.error("Storage backends load failed:", err);
      setLoadFailed(true);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- load backends on mount */
  useEffect(() => {
    load();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const openCreate = () => {
    setEditingId(null);
    setForm(EMPTY_FORM);
    setDialogOpen(true);
  };

  const openEdit = (b: StorageBackend) => {
    setEditingId(b.id);
    setForm({
      name: b.name,
      endpoint: b.endpoint,
      internal_endpoint: b.internal_endpoint ?? "",
      region: b.region ?? "",
      bucket: b.bucket ?? "",
      path_prefix: b.path_prefix ?? "",
    });
    setDialogOpen(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) {
      toast.warning("请填写后端名称");
      return;
    }
    if (!editingId && (!form.endpoint.trim() || !form.region.trim() || !form.bucket.trim())) {
      toast.warning("endpoint / region / bucket 为必填项");
      return;
    }
    setSaving(true);
    try {
      const payload: Record<string, unknown> = {
        name: form.name.trim(),
        endpoint: form.endpoint.trim(),
        internal_endpoint: form.internal_endpoint.trim() || null,
        region: form.region.trim(),
        bucket: form.bucket.trim(),
        path_prefix: form.path_prefix.trim() || null,
      };
      const res = await fetch("/api/manage/storage", {
        method: editingId ? "PUT" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editingId ? { id: editingId, ...payload } : { type: "s3", ...payload }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      toast.success(editingId ? "已更新" : data?.message || "创建成功");
      setDialogOpen(false);
      await load();
    } catch (err) {
      console.error("Storage backend save failed:", err);
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  const handleSetDefault = async (b: StorageBackend) => {
    try {
      const res = await fetch("/api/manage/storage", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: b.id }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "设置失败");
      toast.success(`默认后端已切换为「${b.name}」，新上传将写入该后端`);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "设置失败");
    }
  };

  const handleTest = async (b: StorageBackend) => {
    setTestingId(b.id);
    try {
      const res = await fetch("/api/manage/storage/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: b.id }),
      });
      const data = await res.json();
      if (data?.ok) toast.success(`「${b.name}」连通正常`);
      else toast.error(`「${b.name}」连通失败：${data?.error || "未知错误"}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "测试失败");
    } finally {
      setTestingId(null);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    try {
      const res = await fetch(`/api/manage/storage?id=${deleteTarget.id}`, { method: "DELETE" });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "删除失败");
      toast.success("已删除");
      setDeleteTarget(null);
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const handleMigrate = async () => {
    if (migrateTargetId === "") return;
    setMigrating(true);
    setMigrateResult(null);
    try {
      const res = await fetch("/api/manage/storage/migrate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targetId: migrateTargetId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "迁移失败");
      setMigrateResult(
        `迁移完成：成功 ${data.migrated} 人，跳过已存在对象 ${data.skippedObjects} 个，失败 ${data.failed} 人` +
          (data.errors?.length ? `（首批失败：${data.errors.map((e: { userCode: string }) => e.userCode).join("、")}）` : "")
      );
      if (data.failed > 0) toast.warning("部分用户迁移失败，可重新执行（已存在的对象会自动跳过）");
      else toast.success("迁移完成");
      await load();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "迁移失败");
    } finally {
      setMigrating(false);
    }
  };

  const s3Backends = backends.filter((b) => b.type === "s3");
  const localBackend = backends.find((b) => b.type === "local");

  return (
    <div className="space-y-6">
      <div className="bg-card rounded-xl border border-border-soft p-6 space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-foreground">存储管理</h2>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              本地存储为内置后端；S3 兼容后端支持腾讯云 COS、阿里云 OSS、MinIO 等。凭据通过环境变量配置，不入库。
            </p>
          </div>
          <button
            onClick={openCreate}
            disabled={!loaded}
            className="flex items-center gap-1.5 px-4 py-2 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
          >
            <Plus size={16} />
            新增后端
          </button>
        </div>

        {loadFailed && (
          <div className="text-center py-6 space-y-2">
            <p className="text-sm text-red-500">存储后端加载失败</p>
            <button onClick={load} className="px-4 py-1.5 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg">
              重试
            </button>
          </div>
        )}

        {!loadFailed && !loaded && (
          <p className="text-sm text-gray-400 dark:text-gray-500 py-4 text-center">加载中...</p>
        )}

        {/* 后端卡片列表 */}
        {loaded && !loadFailed && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {backends.map((b) => (
              <div
                key={b.id}
                className={`rounded-xl border p-4 space-y-2 ${
                  b.is_default === 1
                    ? "border-green-300 dark:border-green-700 bg-green-50/50 dark:bg-green-900/20"
                    : "border-gray-200 dark:border-gray-700"
                }`}
              >
                <div className="flex items-center gap-2">
                  {b.type === "local" ? (
                    <HardDrive size={16} className="text-muted" />
                  ) : (
                    <Cloud size={16} className="text-blue-500" />
                  )}
                  <span className="font-medium text-foreground text-sm">{b.name}</span>
                  <span className="px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-muted rounded text-[10px]">
                    {b.type === "local" ? "本地" : "S3 兼容"}
                  </span>
                  {b.is_default === 1 && (
                    <span className="px-1.5 py-0.5 bg-green-100 dark:bg-green-900/40 text-green-700 dark:text-green-300 rounded text-[10px]">
                      默认
                    </span>
                  )}
                </div>

                {b.type === "s3" ? (
                  <div className="text-xs text-muted space-y-0.5">
                    <p className="truncate">公网端点：{b.endpoint || "-"}</p>
                    <p className="truncate">内网端点：{b.internal_endpoint || "（未配置，走公网）"}</p>
                    <p className="truncate">桶：{b.bucket || "-"}{b.path_prefix ? ` / ${b.path_prefix}` : ""}</p>
                    <p>
                      凭据：
                      {b.credentialsConfigured ? (
                        <span className="text-green-600 dark:text-green-400">已配置</span>
                      ) : (
                        <span className="text-amber-600 dark:text-amber-400">
                          未配置（S3_{b.id}_ACCESS_KEY / S3_{b.id}_SECRET_KEY）
                        </span>
                      )}
                    </p>
                  </div>
                ) : (
                  <p className="text-xs text-muted">
                    文件保存在应用服务器 uploads/ 目录，行为与现版本一致。
                  </p>
                )}

                <div className="flex flex-wrap gap-2 pt-1">
                  {b.is_default !== 1 && (
                    <button
                      onClick={() => handleSetDefault(b)}
                      className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                    >
                      <Star size={12} />
                      设为默认
                    </button>
                  )}
                  <button
                    onClick={() => handleTest(b)}
                    disabled={testingId === b.id}
                    className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 disabled:opacity-50 transition-colors"
                  >
                    <PlugZap size={12} />
                    {testingId === b.id ? "测试中..." : "测试连接"}
                  </button>
                  {b.type === "s3" && (
                    <>
                      <button
                        onClick={() => openEdit(b)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-gray-200 dark:border-gray-700 text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors"
                      >
                        <Pencil size={12} />
                        编辑
                      </button>
                      <button
                        onClick={() => setDeleteTarget(b)}
                        className="flex items-center gap-1 px-2.5 py-1 text-xs rounded-lg border border-red-200 dark:border-red-800 text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 transition-colors"
                      >
                        <Trash2 size={12} />
                        删除
                      </button>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 迁移本地文件区块 */}
      {loaded && localBackend && s3Backends.length > 0 && (
        <div className="bg-card rounded-xl border border-border-soft p-6 space-y-3">
          <div>
            <h3 className="font-semibold text-foreground text-sm">迁移本地文件到云后端</h3>
            <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
              将归属本地后端的头像与评价词云批量上传到目标云后端。可重复执行，已存在的对象自动跳过；单用户失败不影响整体。
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ArrowRightLeft size={16} className="text-gray-400 dark:text-gray-500" />
            <select
              value={migrateTargetId}
              onChange={(e) => setMigrateTargetId(e.target.value === "" ? "" : Number(e.target.value))}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
            >
              <option value="">选择目标后端...</option>
              {s3Backends.map((b) => (
                <option key={b.id} value={b.id} disabled={!b.credentialsConfigured}>
                  {b.name}{b.credentialsConfigured ? "" : "（凭据未配置）"}
                </option>
              ))}
            </select>
            <button
              onClick={handleMigrate}
              disabled={migrating || migrateTargetId === ""}
              className="px-4 py-2 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {migrating ? "迁移中..." : "开始迁移"}
            </button>
          </div>
          {migrateResult && (
            <p className="text-xs text-muted">{migrateResult}</p>
          )}
        </div>
      )}

      {/* 新增/编辑对话框 */}
      {dialogOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => !saving && setDialogOpen(false)}
        >
          <div
            className="bg-card rounded-2xl shadow-xl max-w-md w-full p-6 space-y-4 max-h-[85vh] overflow-y-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-foreground">
              {editingId ? "编辑存储后端" : "新增 S3 兼容后端"}
            </h3>
            <FieldInput
              label="后端名称"
              value={form.name}
              onChange={(v) => setForm((f) => ({ ...f, name: v }))}
              placeholder="如：腾讯云-正式桶"
            />
            <FieldInput
              label="公网端点（endpoint）"
              value={form.endpoint}
              onChange={(v) => setForm((f) => ({ ...f, endpoint: v }))}
              placeholder="https://cos.ap-shanghai.myqcloud.com"
              hint="签名 URL 基于此端点签发，浏览器必须可达"
            />
            <FieldInput
              label="内网端点"
              value={form.internal_endpoint}
              onChange={(v) => setForm((f) => ({ ...f, internal_endpoint: v }))}
              placeholder="https://cos-internal.ap-shanghai.myqcloud.com"
              optional
              hint="应用服务器与存储同云时配置，上传/迁移/导出走内网省流量"
            />
            <FieldInput
              label="区域（region）"
              value={form.region}
              onChange={(v) => setForm((f) => ({ ...f, region: v }))}
              placeholder="ap-shanghai"
            />
            <FieldInput
              label="存储桶（bucket）"
              value={form.bucket}
              onChange={(v) => setForm((f) => ({ ...f, bucket: v }))}
              placeholder="career-explorer-1300000000"
              hint="须预先创建且设为私有读写"
            />
            <FieldInput
              label="根目录前缀"
              value={form.path_prefix}
              onChange={(v) => setForm((f) => ({ ...f, path_prefix: v }))}
              placeholder="career/2026"
              optional
              hint="桶内对象将存放于该目录下，便于多应用共用桶或按学年归档"
            />
            {!editingId && (
              <p className="text-xs text-amber-600 dark:text-amber-400 bg-amber-50 dark:bg-amber-900/30 rounded-lg p-2">
                创建后请在 .env.local 中配置 S3_&#123;新ID&#125;_ACCESS_KEY / S3_&#123;新ID&#125;_SECRET_KEY 并重启服务，凭据不入库。
              </p>
            )}
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setDialogOpen(false)}
                disabled={saving}
                className="flex-1 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors"
              >
                取消
              </button>
              <button
                onClick={handleSave}
                disabled={saving}
                className="flex-1 py-2 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
              >
                {saving ? "保存中..." : "保存"}
              </button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={deleteTarget !== null}
        title="删除存储后端"
        message={
          deleteTarget
            ? `确定删除「${deleteTarget.name}」吗？删除前请确认没有用户文件仍归属该后端（有引用时会被拒绝）。云存储中的对象不会被删除。`
            : ""
        }
        confirmText="删除"
        variant="danger"
        onConfirm={handleDelete}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
