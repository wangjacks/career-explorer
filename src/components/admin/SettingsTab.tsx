"use client";

import { useState } from "react";
import { toast } from "sonner";
import { Field } from "./AdminUI";
import type { DbConfig } from "@/hooks/useAdminAuth";

interface Props {
  dbConfig: DbConfig | null;
  onConfigSaved: () => void;
}

export default function SettingsTab({ dbConfig, onConfigSaved }: Props) {
  const [config, setConfig] = useState<DbConfig | null>(dbConfig);
  const [testingDb, setTestingDb] = useState(false);
  const [savingDb, setSavingDb] = useState(false);

  // Sync with parent when dbConfig changes
  if (dbConfig && config === null) {
    setConfig(dbConfig);
  }

  const handleTestDb = async () => {
    if (!config) return;
    setTestingDb(true);
    try {
      const res = await fetch("/api/admin/test-db", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config.mysql),
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
    if (!config) return;
    setSavingDb(true);
    try {
      const res = await fetch("/api/admin/settings", {
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

  if (!config) return null;

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
      <h2 className="font-semibold text-gray-800">数据库配置</h2>
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
  );
}
