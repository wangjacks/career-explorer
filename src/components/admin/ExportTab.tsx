"use client";

import { useState } from "react";
import { toast } from "sonner";

export default function ExportTab() {
  const [exportScope, setExportScope] = useState<"all" | "students" | "byIds" | "date">("all");
  const [exportIds, setExportIds] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [imagePlacement, setImagePlacement] = useState<"in-cell" | "floating">("in-cell");
  const [exportColumns, setExportColumns] = useState({
    studentId: true, name: true, tags: true,
    avatarUrl: true, evaluationUrl: true,
    avatarLink: false, evaluationLink: false, createdAt: true,
  });
  const [previewData, setPreviewData] = useState<Record<string, string>[]>([]);
  const [previewTotal, setPreviewTotal] = useState(0);
  const [previewing, setPreviewing] = useState(false);
  const [exporting, setExporting] = useState(false);

  const getExportColumns = () => {
    const cols: string[] = [];
    if (exportColumns.studentId) cols.push("student_id");
    if (exportColumns.name) cols.push("name");
    if (exportColumns.tags) cols.push("tags");
    if (exportColumns.avatarUrl) cols.push("avatar_url");
    if (exportColumns.evaluationUrl) cols.push("evaluation_url");
    if (exportColumns.avatarLink) cols.push("avatar_link");
    if (exportColumns.evaluationLink) cols.push("evaluation_link");
    if (exportColumns.createdAt) cols.push("created_at");
    return cols.join(",");
  };

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
      setPreviewData(data.preview);
      setPreviewTotal(data.total);
    } catch {
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
      if (exportFormat === "xlsx") params.set("imagePlacement", imagePlacement);
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
    } catch {
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
      toast.error(e instanceof Error ? e.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-6">
      <h2 className="font-semibold text-gray-800 dark:text-gray-100">数据导出</h2>

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
          <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">学号列表（逗号分隔）</label>
          <input type="text" value={exportIds} onChange={(e) => setExportIds(e.target.value)}
            placeholder="202505050101,202505050102"
            className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300" />
        </div>
      )}
      {exportScope === "date" && (
        <div className="flex gap-4 items-end">
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">开始日期</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 dark:text-gray-400 mb-1">结束日期</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
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

      {exportFormat === "xlsx" && (exportColumns.avatarUrl || exportColumns.evaluationUrl) && (
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
                className={`rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-green-300 ${
                  imagePlacement === value
                    ? "border-primary bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
                    : "border-gray-200 bg-card text-gray-700 hover:border-green-300 dark:border-gray-700 dark:text-gray-200"
                }`}
              >
                <span className="block text-sm font-medium">{label}</span>
                <span className="mt-1 block text-xs text-gray-500 dark:text-gray-400">{description}</span>
              </button>
            ))}
          </div>
        </fieldset>
      )}

      {/* Columns */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700 dark:text-gray-200">自定义列</label>
        <div className="flex flex-wrap gap-2">
          {([
            ["studentId", "学号"],
            ["name", "姓名"],
            ["tags", "标签"],
            ["avatarUrl", "学生头像"],
            ["evaluationUrl", "评价词云"],
            ["avatarLink", "头像 URL"],
            ["evaluationLink", "评价词云 URL"],
            ["createdAt", "提交时间"],
          ] as const).map(([key, label]) => (
            <button
              key={key}
              onClick={() => setExportColumns({ ...exportColumns, [key]: !exportColumns[key] })}
              className={`px-3.5 py-1.5 rounded-lg text-sm font-medium border transition-colors ${
                exportColumns[key]
                  ? "bg-primary text-white border-primary"
                  : "bg-card text-gray-600 dark:text-gray-300 border-gray-200 dark:border-gray-700 hover:border-green-300"
              }`}
            >
              {label}
            </button>
          ))}
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
            className="px-4 py-2 bg-blue-500 hover:bg-blue-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
            {exporting ? "打包中..." : "下载图片包"}
          </button>
        )}
      </div>

      {/* Preview */}
      {previewData.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm text-gray-500 dark:text-gray-400">
            预览（前 {previewData.length} 条，共 {previewTotal} 条）
          </p>
          <div className="overflow-x-auto border border-gray-100 dark:border-gray-700 rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500 dark:text-gray-400">
                  {Object.keys(previewData[0]).map((key) => (
                    <th key={key} className="px-3 py-2 font-medium">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                {previewData.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/50">
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="px-3 py-2 text-gray-600 dark:text-gray-300 max-w-[200px] truncate">{String(val)}</td>
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
