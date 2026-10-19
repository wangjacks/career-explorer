"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import {
  DEFAULT_EXPORT_COLUMN_KEYS,
  EXPORT_COLUMNS,
  SCORE_COLUMN_KEYS,
} from "@/lib/export-columns";

/** 六型得分的两种输出形态（#233）：合成一列，或拆成 R/I/A/S/E/C 六列 */
type ScoreMode = "composite" | "split";

const BASE_COLUMNS = EXPORT_COLUMNS.filter((column) => column.group === "base");
/** 测评组里由「六型得分」子选项统一控制的列，不单独出按钮 */
const SCORE_COLUMN_SET = new Set(["assessment_scores", ...SCORE_COLUMN_KEYS]);
/** 推荐职业排在「六型得分」之后（按钮顺序：状态 / 完成时间 / 三字码 / 六型得分 / 推荐职业） */
const ASSESSMENT_COLUMNS = EXPORT_COLUMNS.filter(
  (column) => column.group === "assessment" && !SCORE_COLUMN_SET.has(column.key) && column.key !== "careers"
);
const CAREER_COLUMNS = EXPORT_COLUMNS.filter(
  (column) => column.group === "assessment" && column.key === "careers"
);

export default function ExportTab() {
  const [exportScope, setExportScope] = useState<"all" | "students" | "byIds" | "date">("all");
  const [exportIds, setExportIds] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [imagePlacement, setImagePlacement] = useState<"in-cell" | "floating">("in-cell");
  const [rowHeight, setRowHeight] = useState(45);
  const [selectedColumns, setSelectedColumns] = useState<string[]>([...DEFAULT_EXPORT_COLUMN_KEYS]);
  const [scoreMode, setScoreMode] = useState<ScoreMode>("composite");
  /** 推荐职业列依赖 O*NET 职业库（#226）：`null` 表示还在探测 */
  const [recommendationsReady, setRecommendationsReady] = useState<boolean | null>(null);
  const [previewData, setPreviewData] = useState<Record<string, string>[]>([]);
  const [previewColumns, setPreviewColumns] = useState<{ key: string; header: string }[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);

  // 能力探测：职业库没就绪时「推荐职业 Top3」按钮置灰（悬停说明），不隐藏
  useEffect(() => {
    let cancelled = false;
    fetch("/api/manage/export?capabilities=1")
      .then((res) => (res.ok ? res.json() : { recommendations: false }))
      .then((data: { recommendations?: unknown }) => {
        if (!cancelled) setRecommendationsReady(Boolean(data?.recommendations));
      })
      .catch((err) => {
        console.error("Failed to detect export capabilities:", err);
        if (!cancelled) setRecommendationsReady(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const hasScoreColumns = selectedColumns.some((key) => SCORE_COLUMN_SET.has(key));

  const toggleColumn = (key: string) => {
    setSelectedColumns((prev) =>
      prev.includes(key) ? prev.filter((item) => item !== key) : [...prev, key]
    );
  };

  const setScoresEnabled = (enabled: boolean) => {
    setSelectedColumns((prev) => {
      const withoutScores = prev.filter((key) => !SCORE_COLUMN_SET.has(key));
      if (!enabled) return withoutScores;
      return [...withoutScores, ...(scoreMode === "composite" ? ["assessment_scores"] : SCORE_COLUMN_KEYS)];
    });
  };

  const changeScoreMode = (mode: ScoreMode) => {
    setScoreMode(mode);
    // 已勾选六型得分时切换到新形态；未勾选时只记住选择
    if (!hasScoreColumns) return;
    setSelectedColumns((prev) => [
      ...prev.filter((key) => !SCORE_COLUMN_SET.has(key)),
      ...(mode === "composite" ? ["assessment_scores"] : SCORE_COLUMN_KEYS),
    ]);
  };

  const getExportColumns = () => selectedColumns.join(",");

  const getExportParams = () => {
    const params = new URLSearchParams({
      scope: exportScope,
      columns: getExportColumns(),
    });
    if (exportScope === "byIds" && exportIds) params.set("ids", exportIds);
    if (exportScope === "date") {
      if (dateFrom) params.set("dateFrom", dateFrom);
      if (dateTo) params.set("dateTo", dateTo);
    }
    return params;
  };

  const handlePreview = async () => {
    setPreviewing(true);
    try {
      const res = await fetch("/api/manage/export", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scope: exportScope,
          ids: exportIds,
          dateFrom,
          dateTo,
          columns: getExportColumns(),
        }),
      });
      if (!res.ok) throw new Error("预览失败");
      const data = await res.json();
      setPreviewData(data.preview ?? []);
      setPreviewColumns(data.columns ?? []);
      setPreviewTotal(data.total ?? 0);
    } catch (err) {
      console.error("Export preview failed:", err);
      toast.error("预览失败");
    } finally {
      setPreviewing(false);
    }
  };

  const handleExportFile = async () => {
    setExporting(true);
    try {
      const params = getExportParams();
      params.set("format", exportFormat);
      if (exportFormat === "xlsx") {
        params.set("imagePlacement", imagePlacement);
        params.set("rowHeight", String(rowHeight));
      }
      const res = await fetch(`/api/manage/export?${params}`);
      if (!res.ok) throw new Error("导出失败");
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `export_${Date.now()}.${exportFormat === "xlsx" ? "xlsx" : "csv"}`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("导出成功");
    } catch (err) {
      console.error("Export failed:", err);
      toast.error("导出失败");
    } finally {
      setExporting(false);
    }
  };

  const handleExportImages = async () => {
    setExporting(true);
    try {
      const params = getExportParams();
      const res = await fetch(`/api/manage/export-images?${params}`);
      if (!res.ok) {
        const data = await res.json();
        throw new Error(data.error || "导出失败");
      }
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `images_${Date.now()}.zip`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success("图片包下载成功");
    } catch (e) {
      console.error("Export images failed:", e);
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  const columnButtonClass = (active: boolean) =>
    `px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
      active
        ? "bg-primary text-white border-primary"
        : "bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-green-300"
    }`;

  return (
    <div className="bg-card rounded-xl border border-border-soft p-6 space-y-6">
      <h2 className="font-semibold text-foreground">数据导出</h2>

      {/* Scope */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">导出范围</label>
        <div className="flex flex-wrap gap-2">
          {([
            ["all", "全部档案"],
            ["students", "学生名单"],
            ["byIds", "按学号筛选"],
            ["date", "按时间筛选"],
          ] as const).map(([val, label]) => (
            <button
              key={val}
              onClick={() => setExportScope(val)}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                exportScope === val
                  ? "bg-primary text-white border-primary"
                  : "bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-green-300"
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* Filter conditions */}
      {exportScope === "byIds" && (
        <div>
          <label className="block text-xs text-muted mb-1">学号列表（逗号分隔）</label>
          <input type="text" value={exportIds} onChange={(e) => setExportIds(e.target.value)}
            placeholder="202505050101,202505050102"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-focus-ring" />
        </div>
      )}
      {exportScope === "date" && (
        <div className="flex gap-4 items-end">
          <div>
            <label className="block text-xs text-muted mb-1">开始日期</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring" />
          </div>
          <div>
            <label className="block text-xs text-muted mb-1">结束日期</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring" />
          </div>
        </div>
      )}

      {/* Format */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">导出格式</label>
        <div className="flex flex-wrap gap-2">
          <button
            onClick={() => setExportFormat("csv")}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              exportFormat === "csv"
                ? "bg-primary text-white border-primary"
                : "bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-green-300"
            }`}
          >
            CSV
          </button>
          <button
            onClick={() => setExportFormat("xlsx")}
            className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
              exportFormat === "xlsx"
                ? "bg-primary text-white border-primary"
                : "bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-green-300"
            }`}
          >
            Excel (.xlsx)
          </button>
        </div>
      </div>

      {exportFormat === "xlsx" && (selectedColumns.includes("avatar_url") || selectedColumns.includes("evaluation_url")) && (
        <fieldset className="space-y-2">
          <legend className="text-sm font-medium text-gray-700 dark:text-gray-200">图片放置方式</legend>
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="图片放置方式">
            {([
              ["in-cell", "放置在单元格中", "图片随单元格参与排序和筛选（推荐）"],
              ["floating", "浮动图片", "兼容性更广，图片位于工作表上方"],
            ] as const).map(([value, label, description]) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={imagePlacement === value}
                onClick={() => setImagePlacement(value)}
                className={`rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-focus-ring ${
                  imagePlacement === value
                    ? "border-primary bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
                    : "border-gray-200 bg-card text-gray-700 hover:border-green-300 dark:border-gray-700 dark:text-gray-200"
                }`}
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-1 block text-xs text-muted">{description}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {exportFormat === "xlsx" && (
        <div className="space-y-2">
          <label className="text-sm font-medium text-gray-700 dark:text-gray-200" htmlFor="export-row-height">
            数据行高度（像素）
          </label>
          <div className="flex items-center gap-2">
            <input
              id="export-row-height"
              type="number"
              min={10}
              max={200}
              value={rowHeight}
              onChange={(e) => {
                const value = Number(e.target.value);
                setRowHeight(Number.isFinite(value) ? value : 45);
              }}
              className="w-28 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring"
            />
            <span className="text-xs text-muted">适用于标题行下方的每一行数据，范围 10-200</span>
          </div>
        </div>
      )}

      {/* Columns：分两组（基础信息 / 职业兴趣测评），中间细分隔线 */}
      <div className="space-y-3">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">自定义列</label>

        <div className="space-y-2">
          <span className="block text-xs font-medium text-muted">基础信息</span>
          <div className="flex flex-wrap gap-2">
            {BASE_COLUMNS.map((column) => (
              <button
                key={column.key}
                onClick={() => toggleColumn(column.key)}
                aria-pressed={selectedColumns.includes(column.key)}
                className={columnButtonClass(selectedColumns.includes(column.key))}
              >
                {column.label}
              </button>
            ))}
          </div>
        </div>

        <hr className="border-gray-100 dark:border-gray-800" />

        <div className="space-y-2">
          <span className="block text-xs font-medium text-muted">职业兴趣测评</span>
          <div className="flex flex-wrap gap-2">
            {ASSESSMENT_COLUMNS.map((column) => (
              <button
                key={column.key}
                onClick={() => toggleColumn(column.key)}
                aria-pressed={selectedColumns.includes(column.key)}
                className={columnButtonClass(selectedColumns.includes(column.key))}
              >
                {column.label}
              </button>
            ))}
            <button
              onClick={() => setScoresEnabled(!hasScoreColumns)}
              aria-pressed={hasScoreColumns}
              className={columnButtonClass(hasScoreColumns)}
            >
              六型得分
            </button>
            {CAREER_COLUMNS.map((column) => {
              const isUnavailable = recommendationsReady === false;
              return (
                <button
                  key={column.key}
                  onClick={() => toggleColumn(column.key)}
                  disabled={isUnavailable}
                  aria-pressed={selectedColumns.includes(column.key)}
                  title={
                    isUnavailable
                      ? "职业库尚未就绪：请先在数据库中导入 O*NET 职业库后重试"
                      : undefined
                  }
                  className={`${columnButtonClass(selectedColumns.includes(column.key))} ${
                    isUnavailable ? "cursor-not-allowed opacity-50" : ""
                  }`}
                >
                  {column.label}
                </button>
              );
            })}
          </div>

          {hasScoreColumns && (
            <div className="flex flex-wrap items-center gap-2 rounded-lg border border-border-soft px-3 py-2">
              <span className="text-xs text-muted">六型得分输出方式</span>
              {([
                ["composite", "合成一列", "例如：R42 I38 A20 S74 E31 C25"],
                ["split", "拆成六列", "R/I/A/S/E/C 各一列，便于在 Excel 里排序与画图"],
              ] as const).map(([mode, label, description]) => (
                <button
                  key={mode}
                  type="button"
                  role="radio"
                  aria-checked={scoreMode === mode}
                  title={description}
                  onClick={() => changeScoreMode(mode)}
                  className={`px-3 py-1 rounded-md text-xs font-medium border transition-colors ${
                    scoreMode === mode
                      ? "border-primary bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
                      : "border-gray-200 bg-card text-gray-600 hover:border-green-300 dark:border-gray-700 dark:text-gray-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={handlePreview} disabled={previewing}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
          {previewing ? "加载中..." : "预览数据"}
        </button>
        <button onClick={handleExportFile} disabled={exporting}
          className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
          {exporting ? "导出中..." : "导出文件"}
        </button>
        {exportScope !== "students" && (
          <button onClick={handleExportImages} disabled={exporting}
            className="px-4 py-2 bg-info hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {exporting ? "打包中..." : "下载图片包"}
          </button>
        )}
      </div>

      {/* Preview */}
      {previewData.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-muted">
            预览（前 {previewData.length} 条，共 {previewTotal} 条）
          </p>
          <div className="overflow-x-auto border border-border-soft rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-muted">
                  {previewColumns.map((column) => (
                    <th key={column.key} className="px-3 py-2 font-medium whitespace-nowrap">{column.header}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {previewData.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                    {previewColumns.map((column) => (
                      <td key={column.key} className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{String(row[column.key] ?? "")}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
