"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import { ImageIcon, RefreshCw, TriangleAlert, Wrench } from "lucide-react";

interface ThumbnailStatus {
  total: number;
  existing: number;
  missing: number;
}

interface BackfillResult {
  total: number;
  generated: number;
  skipped: number;
  failed: number;
}

/**
 * 缩略图维护面板（#118）：检测被引用文件的缩略图覆盖情况，一键补生成缺失缩略图（仅 admin）。
 */
export default function ThumbnailTab() {
  const [status, setStatus] = useState<ThumbnailStatus | null>(null);
  const [loading, setLoading] = useState(false);
  const [running, setRunning] = useState(false);
  const [result, setResult] = useState<BackfillResult | null>(null);

  const scan = useCallback(async (opts?: { clearResult?: boolean }) => {
    setLoading(true);
    try {
      const res = await fetch("/api/manage/media/generate-thumbnails/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "检测失败");
      setStatus(data);
      // 默认清空上次结果；补生成后重新检测时保留统计展示（review 修复）
      if (opts?.clearResult !== false) setResult(null);
    } catch (err) {
      console.error("Thumbnail status load failed:", err);
      toast.error(err instanceof Error ? err.message : "检测失败");
    } finally {
      setLoading(false);
    }
  }, []);

   
  useEffect(() => {
    // 初始不自动扫描：由「检测」按钮显式触发（每次扫描需枚举全部文件）
  }, []);
   

  const runBackfill = async () => {
    setRunning(true);
    try {
      const res = await fetch("/api/manage/media/generate-thumbnails", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "补生成失败");
      setResult(data);
      toast.success(`已生成 ${data.generated} 张缩略图`);
      await scan({ clearResult: false });
    } catch (err) {
      console.error("Thumbnail backfill failed:", err);
      toast.error(err instanceof Error ? err.message : "补生成失败");
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-5">
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <ImageIcon size={16} className="text-gray-400 dark:text-gray-500" aria-hidden />
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">缩略图维护</h2>
          <button
            onClick={() => scan()}
            disabled={loading}
            className="ml-auto px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-300 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? "animate-spin" : ""}`} aria-hidden />
            {status === null ? "检测" : "重新检测"}
          </button>
        </div>
        <p className="text-xs text-gray-400 dark:text-gray-500">
          扫描全部被引用图片（当前档案 + 历史版本快照），统计缩略图覆盖情况；缩略图由原图 key 派生（`_thumb` 后缀），不影响原图与详情展示。
        </p>

        {status === null ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">点击上方「检测」按钮扫描缩略图覆盖情况</p>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
              <p className="text-xs text-gray-500 dark:text-gray-400">被引用图片</p>
              <p className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 mt-1">{status.total}</p>
            </div>
            <div className="bg-green-50 dark:bg-green-900/20 rounded-lg p-4">
              <p className="text-xs text-green-600 dark:text-green-400">已有缩略图</p>
              <p className="text-2xl font-extrabold text-green-700 dark:text-green-300 mt-1">{status.existing}</p>
            </div>
            <div className={`rounded-lg p-4 ${status.missing > 0 ? "bg-amber-50 dark:bg-amber-900/20" : "bg-gray-50 dark:bg-gray-800"}`}>
              <p className={`text-xs ${status.missing > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}>
                缺失缩略图
              </p>
              <p className={`text-2xl font-extrabold mt-1 ${status.missing > 0 ? "text-amber-700 dark:text-amber-300" : "text-gray-900 dark:text-gray-100"}`}>
                {status.missing}
              </p>
            </div>
          </div>
        )}

        {status && status.missing > 0 && (
          <div className="flex items-center gap-3 flex-wrap">
            <button
              onClick={runBackfill}
              disabled={running}
              className="px-4 py-2 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
            >
              <Wrench className="w-4 h-4" aria-hidden />
              {running ? "补生成中..." : `补生成缺失缩略图（${status.missing} 张）`}
            </button>
            <span className="text-xs text-gray-400 dark:text-gray-500">仅生成缺失项，已存在的不重复处理；单张失败不影响其余</span>
          </div>
        )}

        {status && status.missing === 0 && (
          <p className="text-sm text-green-600 dark:text-green-400 flex items-center gap-1.5">
            <TriangleAlert className="w-4 h-4" aria-hidden />
            缩略图覆盖完整，无需补生成
          </p>
        )}

        {result && (
          <div className="text-xs text-gray-500 dark:text-gray-400 border-t border-gray-100 dark:border-gray-700 pt-3">
            本次结果：共 {result.total} 张 · 新生成 <span className="text-green-600 dark:text-green-400">{result.generated}</span> ·
            已存在跳过 {result.skipped} · 失败 <span className={result.failed > 0 ? "text-red-500" : ""}>{result.failed}</span>
          </div>
        )}
      </div>
    </div>
  );
}
