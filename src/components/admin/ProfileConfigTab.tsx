"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * 档案功能设置（#94）：当前承载「自定义标签数量上限」，
 * 后续提交时限等档案相关配置（#96）也将放入本页。
 */
export default function ProfileConfigTab() {
  const [maxCustomTags, setMaxCustomTags] = useState(6);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    setLoadFailed(false);
    try {
      const res = await fetch("/api/manage/profile-config");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "获取配置失败");
      setMaxCustomTags(data.maxCustomTags);
      setLoaded(true);
    } catch (err) {
      console.error("Profile config load failed:", err);
      setLoadFailed(true);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- load config on mount */
  useEffect(() => {
    load();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSave = async () => {
    if (!Number.isInteger(maxCustomTags) || maxCustomTags < 1 || maxCustomTags > 20) {
      toast.warning("上限须为 1-20 的整数");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/manage/profile-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxCustomTags }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      toast.success("已保存");
    } catch (err) {
      console.error("Profile config save failed:", err);
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-gray-800 dark:text-gray-100">功能设置</h2>
        <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">
          档案创建相关的功能配置，保存后即时生效。
        </p>
      </div>

      {loadFailed && (
        <div className="text-center py-6 space-y-2">
          <p className="text-sm text-red-500">配置加载失败</p>
          <button onClick={load} className="px-4 py-1.5 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg">
            重试
          </button>
        </div>
      )}

      {!loadFailed && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="max-custom-tags">
              学生自定义标签数量上限
            </label>
            <input
              id="max-custom-tags"
              type="number"
              min={1}
              max={20}
              value={maxCustomTags}
              disabled={!loaded}
              onChange={(e) => setMaxCustomTags(Number(e.target.value))}
              className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-green-300"
            />
            <span className="text-xs text-gray-400 dark:text-gray-500">1-20，预设标签不受此限制</span>
          </div>
          <div>
            <button
              onClick={handleSave}
              disabled={saving || !loaded}
              className="px-6 py-2 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
          <p className="text-xs text-gray-400 dark:text-gray-500">
            后续将在此页增加提交时限等档案配置。
          </p>
        </div>
      )}
    </div>
  );
}
