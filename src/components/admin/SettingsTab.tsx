"use client";

import { useState, useRef } from "react";
import { toast } from "sonner";
import { Field } from "./AdminUI";
import type { DbConfig } from "@/hooks/useAdminAuth";

interface Props {
  dbConfig: DbConfig | null;
  loadError?: boolean;
  onRetry?: () => void;
  onConfigSaved: () => void;
}

export default function SettingsTab({ dbConfig, loadError, onRetry, onConfigSaved }: Props) {
  const [config, setConfig] = useState<DbConfig | null>(dbConfig);
  const [testingDb, setTestingDb] = useState(false);
  const [savingDb, setSavingDb] = useState(false);
  const [switchType, setSwitchType] = useState<"mysql" | "sqlite" | null>(null);
  const [switchConfig, setSwitchConfig] = useState({ mysql: { host: "", port: 3306, user: "", password: "", database: "" }, sqlite: { path: "./data/career.db" } });
  const [switching, setSwitching] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [restoring, setRestoring] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Sync with parent when dbConfig changes
  if (dbConfig && config === null) {
    setConfig(dbConfig);
  }

  const currentType = config?.type || "mysql";

  const handleTestDb = async () => {
    if (!config) return;
    setTestingDb(true);
    try {
      const res = await fetch("/api/manage/test-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: currentType, mysql: config.mysql, sqlite: config.sqlite }),
      });
      const data = await res.json();
      if (data.ok) toast.success(data.message || "连接成功");
      else toast.error(data.error);
    } catch {
      toast.error("测试失败");
    } finally {
      setTestingDb(false);
    }
  };

  const handleSaveDb = async () => {
    if (!config) return;
    setSavingDb(true);
    try {
      const res = await fetch("/api/manage/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error);
        return;
      }
      toast.success(data.message);
      onConfigSaved();
    } catch {
      toast.error("保存失败");
    } finally {
      setSavingDb(false);
    }
  };

  const handleSwitch = async () => {
    if (!switchType) return;
    setSwitching(true);
    try {
      const newConfig: DbConfig = {
        ...config!,
        type: switchType,
        ...(switchType === "mysql" ? { mysql: switchConfig.mysql } : { sqlite: switchConfig.sqlite }),
      };
      const res = await fetch("/api/manage/settings", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newConfig),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error);
        return;
      }
      toast.success("数据源已切换");
      if (data.emptyBucket) {
        toast.info("新数据源为空，可通过备份恢复迁移数据");
      }
      setSwitchType(null);
      onConfigSaved();
    } catch {
      toast.error("切换失败");
    } finally {
      setSwitching(false);
    }
  };

  const handleBackup = async () => {
    setBackingUp(true);
    try {
      const res = await fetch("/api/manage/backup");
      if (!res.ok) {
        toast.error("备份失败");
        return;
      }
      const data = await res.json();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `career-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("备份已下载");
    } catch {
      toast.error("备份失败");
    } finally {
      setBackingUp(false);
    }
  };

  const handleRestore = async (file: File) => {
    if (!confirm("恢复将清空现有数据并替换为备份内容，确定继续？")) return;
    setRestoring(true);
    try {
      const text = await file.text();
      const data = JSON.parse(text);
      const res = await fetch("/api/manage/backup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
      const result = await res.json();
      if (!res.ok) {
        toast.error(result.error);
        return;
      }
      toast.success("恢复成功");
      onConfigSaved();
    } catch {
      toast.error("恢复失败，请检查文件格式");
    } finally {
      setRestoring(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  if (loadError && !config) {
    return (
      <div className="bg-white rounded-xl border border-gray-100 p-8 text-center space-y-3">
        <p className="text-red-500">配置加载失败</p>
        <button onClick={onRetry}
          className="px-4 py-1.5 bg-red-500 hover:bg-red-600 text-white text-sm rounded-lg transition-colors">重试</button>
      </div>
    );
  }

  if (!config) return null;

  return (
    <div className="space-y-6">
      {/* Section 1: Current data source */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="font-semibold text-gray-800">当前数据源</h2>
          <span className="px-2 py-0.5 text-xs font-medium rounded-full bg-green-100 text-green-700">
            {currentType.toUpperCase()}
          </span>
        </div>
        {currentType === "mysql" ? (
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
            <Field label="主机" value={config.mysql.host}
              onChange={(v) => setConfig({ ...config, mysql: { ...config.mysql, host: v } })} />
            <Field label="端口" value={String(config.mysql.port)} type="number"
              onChange={(v) => setConfig({ ...config, mysql: { ...config.mysql, port: parseInt(v) || 3306 } })} />
            <Field label="用户名" value={config.mysql.user}
              onChange={(v) => setConfig({ ...config, mysql: { ...config.mysql, user: v } })} />
            <Field label="密码" value={config.mysql.password} type="password"
              onChange={(v) => setConfig({ ...config, mysql: { ...config.mysql, password: v } })} />
            <Field label="数据库名" value={config.mysql.database}
              onChange={(v) => setConfig({ ...config, mysql: { ...config.mysql, database: v } })} />
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4">
            <Field label="数据库文件路径" value={config.sqlite?.path || "./data/career.db"}
              onChange={(v) => setConfig({ ...config, sqlite: { path: v } })} />
          </div>
        )}
        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleTestDb} disabled={testingDb}
            className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {testingDb ? "测试中..." : "测试连接"}
          </button>
          <button onClick={handleSaveDb} disabled={savingDb}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {savingDb ? "保存中..." : "保存配置"}
          </button>
        </div>
      </div>

      {/* Section 2: Switch data source */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-800">切换数据源</h2>
        <p className="text-sm text-gray-500">
          当前使用 {currentType.toUpperCase()}，可切换到{currentType === "mysql" ? "SQLite" : "MySQL"}
        </p>
        {switchType === null ? (
          <button
            onClick={() => setSwitchType(currentType === "mysql" ? "sqlite" : "mysql")}
            className="px-4 py-2 bg-blue-50 hover:bg-blue-100 text-blue-700 text-sm font-medium rounded-lg transition-colors"
          >
            切换到 {currentType === "mysql" ? "SQLite" : "MySQL"}
          </button>
        ) : (
          <div className="space-y-3 p-4 bg-gray-50 rounded-lg">
            <p className="text-sm text-amber-600 font-medium">
              切换后新数据源为空，现有数据保留在原数据库中，可通过备份恢复迁移
            </p>
            {switchType === "mysql" ? (
              <div className="grid grid-cols-2 gap-3">
                <Field label="主机" value={switchConfig.mysql.host}
                  onChange={(v) => setSwitchConfig({ ...switchConfig, mysql: { ...switchConfig.mysql, host: v } })} />
                <Field label="端口" value={String(switchConfig.mysql.port)} type="number"
                  onChange={(v) => setSwitchConfig({ ...switchConfig, mysql: { ...switchConfig.mysql, port: parseInt(v) || 3306 } })} />
                <Field label="用户名" value={switchConfig.mysql.user}
                  onChange={(v) => setSwitchConfig({ ...switchConfig, mysql: { ...switchConfig.mysql, user: v } })} />
                <Field label="密码" value={switchConfig.mysql.password} type="password"
                  onChange={(v) => setSwitchConfig({ ...switchConfig, mysql: { ...switchConfig.mysql, password: v } })} />
                <Field label="数据库名" value={switchConfig.mysql.database}
                  onChange={(v) => setSwitchConfig({ ...switchConfig, mysql: { ...switchConfig.mysql, database: v } })} />
              </div>
            ) : (
              <Field label="数据库文件路径" value={switchConfig.sqlite.path}
                onChange={(v) => setSwitchConfig({ ...switchConfig, sqlite: { path: v } })} />
            )}
            <div className="flex gap-2">
              <button onClick={handleSwitch} disabled={switching}
                className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
                {switching ? "切换中..." : "确认切换"}
              </button>
              <button onClick={() => setSwitchType(null)}
                className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors">
                取消
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Section 3: Backup & Restore */}
      <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-4">
        <h2 className="font-semibold text-gray-800">备份与恢复</h2>
        <p className="text-sm text-gray-500">导出或导入 JSON 格式数据备份，支持跨数据库类型迁移</p>
        <div className="flex items-center gap-3">
          <button onClick={handleBackup} disabled={backingUp}
            className="px-4 py-2 bg-green-50 hover:bg-green-100 text-green-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {backingUp ? "导出中..." : "导出备份"}
          </button>
          <label className="px-4 py-2 bg-orange-50 hover:bg-orange-100 text-orange-700 text-sm font-medium rounded-lg transition-colors cursor-pointer">
            {restoring ? "导入中..." : "导入恢复"}
            <input
              ref={fileInputRef}
              type="file"
              accept=".json"
              className="hidden"
              disabled={restoring}
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) handleRestore(file);
              }}
            />
          </label>
        </div>
      </div>
    </div>
  );
}
