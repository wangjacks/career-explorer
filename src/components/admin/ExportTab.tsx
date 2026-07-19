"use client";

import { useState } from "react";
import { toast } from "sonner";

interface Props {
  authHeaders: () => Record<string, string>;
}

export default function ExportTab({ authHeaders }: Props) {
  const [exportScope, setExportScope] = useState<"all" | "students" | "byIds" | "date">("all");
  const [exportIds, setExportIds] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [exportFormat, setExportFormat] = useState<"csv" | "xlsx">("csv");
  const [embedImages, setEmbedImages] = useState(false);
  const [exportColumns, setExportColumns] = useState({
    studentId: true, name: true, tags: true,
    avatarUrl: true, evaluationUrl: true, createdAt: true,
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
      const res = await fetch("/api/admin/export", {
        method: "POST",
        headers: { ...authHeaders(), "Content-Type": "application/json" },
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
      if (exportFormat === "xlsx") params.set("embedImages", String(embedImages));
      const res = await fetch(`/api/admin/export?${params}`, { headers: authHeaders() });
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
      const res = await fetch(`/api/admin/export-images?${params}`, { headers: authHeaders() });
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
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
      <h2 className="font-semibold text-gray-800">数据导出</h2>

      {/* Scope */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">导出范围</label>
        <div className="flex flex-wrap gap-4">
          {([
            ["all", "全部档案"],
            ["students", "学生名单"],
            ["byIds", "按学号筛选"],
            ["date", "按时间筛选"],
          ] as const).map(([val, label]) => (
            <label key={val} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="radio" name="exportScope" checked={exportScope === val}
                onChange={() => setExportScope(val)}
                className="text-green-500 focus:ring-green-300" />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Filter conditions */}
      {exportScope === "byIds" && (
        <div>
          <label className="block text-xs text-gray-500 mb-1">学号列表（逗号分隔）</label>
          <input type="text" value={exportIds} onChange={(e) => setExportIds(e.target.value)}
            placeholder="202505050101,202505050102"
            className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300" />
        </div>
      )}
      {exportScope === "date" && (
        <div className="flex gap-4 items-end">
          <div>
            <label className="block text-xs text-gray-500 mb-1">开始日期</label>
            <input type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
          </div>
          <div>
            <label className="block text-xs text-gray-500 mb-1">结束日期</label>
            <input type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)}
              className="px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
          </div>
        </div>
      )}

      {/* Format */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">导出格式</label>
        <div className="flex gap-4">
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="radio" name="exportFormat" checked={exportFormat === "csv"}
              onChange={() => setExportFormat("csv")} className="text-green-500 focus:ring-green-300" />
            CSV
          </label>
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
            <input type="radio" name="exportFormat" checked={exportFormat === "xlsx"}
              onChange={() => setExportFormat("xlsx")} className="text-green-500 focus:ring-green-300" />
            Excel (.xlsx)
          </label>
        </div>
        {exportFormat === "xlsx" && (
          <label className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer ml-1">
            <input type="checkbox" checked={embedImages} onChange={(e) => setEmbedImages(e.target.checked)}
              className="rounded border-gray-300 text-green-500 focus:ring-green-300" />
            将图片资源插入到表格中
          </label>
        )}
      </div>

      {/* Columns */}
      <div className="space-y-2">
        <label className="text-sm font-medium text-gray-700">自定义列</label>
        <div className="flex flex-wrap gap-4">
          {([
            ["studentId", "学号"],
            ["name", "姓名"],
            ["tags", "标签"],
            ["avatarUrl", "虚拟形象URL"],
            ["evaluationUrl", "评价词云URL"],
            ["createdAt", "提交时间"],
          ] as const).map(([key, label]) => (
            <label key={key} className="flex items-center gap-2 text-sm text-gray-600 cursor-pointer">
              <input type="checkbox" checked={exportColumns[key]}
                onChange={(e) => setExportColumns({ ...exportColumns, [key]: e.target.checked })}
                className="rounded border-gray-300 text-green-500 focus:ring-green-300" />
              {label}
            </label>
          ))}
        </div>
      </div>

      {/* Actions */}
      <div className="flex gap-3">
        <button onClick={handlePreview} disabled={previewing}
          className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
          {previewing ? "加载中..." : "预览数据"}
        </button>
        <button onClick={handleExportFile} disabled={exporting}
          className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors disabled:opacity-50">
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
          <p className="text-sm text-gray-500">
            预览（前 {previewData.length} 条，共 {previewTotal} 条）
          </p>
          <div className="overflow-x-auto border border-gray-100 rounded-lg">
            <table className="w-full text-xs">
              <thead>
                <tr className="bg-gray-50 text-left text-gray-500">
                  {Object.keys(previewData[0]).map((key) => (
                    <th key={key} className="px-3 py-2 font-medium">{key}</th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-50">
                {previewData.map((row, i) => (
                  <tr key={i} className="hover:bg-gray-50/50">
                    {Object.values(row).map((val, j) => (
                      <td key={j} className="px-3 py-2 text-gray-600 max-w-[200px] truncate">{String(val)}</td>
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
