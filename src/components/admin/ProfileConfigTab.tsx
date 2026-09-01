"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";

/**
 * 档案功能设置（#94/#96/#111/#95）：承载「自定义标签数量上限」「档案提交截止时间」「上传大小上限」与「历史版本上限」，
 * 保存后即时生效。
 */
export default function ProfileConfigTab() {
  const [maxCustomTags, setMaxCustomTags] = useState(6);
  /** datetime-local 输入值（`YYYY-MM-DDTHH:mm`）；空串 = 不限制 */
  const [deadline, setDeadline] = useState("");
  /** 上传大小上限（#111，单位 MB，按资源类型分设） */
  const [maxAvatarSizeMb, setMaxAvatarSizeMb] = useState(5);
  const [maxEvaluationSizeMb, setMaxEvaluationSizeMb] = useState(10);
  /** 档案提交历史版本上限（#95）：超出后自动清理最旧记录 */
  const [maxProfileSubmissions, setMaxProfileSubmissions] = useState(10);
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
      setMaxAvatarSizeMb(typeof data.maxAvatarSizeMb === "number" ? data.maxAvatarSizeMb : 5);
      setMaxEvaluationSizeMb(typeof data.maxEvaluationSizeMb === "number" ? data.maxEvaluationSizeMb : 10);
      setMaxProfileSubmissions(typeof data.maxProfileSubmissions === "number" ? data.maxProfileSubmissions : 10);
      // 存储格式 `YYYY-MM-DD HH:mm` → datetime-local 值（空格换 T）；null/空 = 不限制
      setDeadline(typeof data.submissionDeadline === "string" && data.submissionDeadline
        ? data.submissionDeadline.slice(0, 16).replace(" ", "T")
        : "");
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

  const handleSave = async (deadlineOverride?: string) => {
    if (!Number.isInteger(maxCustomTags) || maxCustomTags < 1 || maxCustomTags > 20) {
      toast.warning("标签上限须为 1-20 的整数");
      return;
    }
    const sizeValid = (v: number) => Number.isInteger(v) && v >= 1 && v <= 20;
    if (!sizeValid(maxAvatarSizeMb) || !sizeValid(maxEvaluationSizeMb)) {
      toast.warning("上传大小上限须为 1-20 的整数（MB）");
      return;
    }
    if (!Number.isInteger(maxProfileSubmissions) || maxProfileSubmissions < 1 || maxProfileSubmissions > 100) {
      toast.warning("版本上限须为 1-100 的整数");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch("/api/manage/profile-config", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        // 一次提交全部项；空串由后端解释为清除截止限制（#96）
        body: JSON.stringify({
          maxCustomTags,
          submissionDeadline: deadlineOverride ?? deadline,
          maxAvatarSizeMb,
          maxEvaluationSizeMb,
          maxProfileSubmissions,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "保存失败");
      if (deadlineOverride !== undefined) setDeadline(deadlineOverride);
      toast.success("已保存");
    } catch (err) {
      console.error("Profile config save failed:", err);
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-border-soft p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-foreground">功能设置</h2>
        <p className="text-xs text-muted mt-1">
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
              className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <span className="text-xs text-muted">1-20，预设标签不受此限制</span>
          </div>

          {/* 档案提交截止时间（#96）：超过该时间后学生无法提交或修改档案 */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="submission-deadline">
              档案提交截止时间
            </label>
            <input
              id="submission-deadline"
              type="datetime-local"
              value={deadline}
              disabled={!loaded}
              onChange={(e) => setDeadline(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            {deadline && (
              <button
                onClick={() => handleSave("")}
                disabled={saving || !loaded}
                className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-300 text-xs rounded-lg transition-colors"
              >
                清除限制
              </button>
            )}
            <span className="text-xs text-muted">
              超过该时间后学生无法提交或修改档案；留空表示不限制
            </span>
          </div>

          {/* 上传大小上限（#111）：按资源类型分设，超限上传被拒绝 */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="max-avatar-size">
              头像上传大小上限
            </label>
            <input
              id="max-avatar-size"
              type="number"
              min={1}
              max={20}
              value={maxAvatarSizeMb}
              disabled={!loaded}
              onChange={(e) => setMaxAvatarSizeMb(Number(e.target.value))}
              className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <span className="text-xs text-muted">1-20 MB</span>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="max-evaluation-size">
              评价词云上传大小上限
            </label>
            <input
              id="max-evaluation-size"
              type="number"
              min={1}
              max={20}
              value={maxEvaluationSizeMb}
              disabled={!loaded}
              onChange={(e) => setMaxEvaluationSizeMb(Number(e.target.value))}
              className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <span className="text-xs text-muted">1-20 MB</span>
          </div>

          {/* 档案提交历史版本上限（#95）：超出后自动清理最旧记录（文件保留） */}
          <div className="flex flex-wrap items-center gap-3">
            <label className="text-sm text-gray-600 dark:text-gray-300" htmlFor="max-profile-submissions">
              档案提交历史版本上限
            </label>
            <input
              id="max-profile-submissions"
              type="number"
              min={1}
              max={100}
              value={maxProfileSubmissions}
              disabled={!loaded}
              onChange={(e) => setMaxProfileSubmissions(Number(e.target.value))}
              className="w-24 px-3 py-2 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <span className="text-xs text-muted">1-100，超出后自动保留最近版本</span>
          </div>

          <div>
            <button
              onClick={() => handleSave()}
              disabled={saving || !loaded}
              className="px-6 py-2 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors"
            >
              {saving ? "保存中..." : "保存"}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
