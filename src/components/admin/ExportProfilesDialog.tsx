"use client";

import { useMemo, useState } from "react";
import { ChevronDown, Download, Lock } from "lucide-react";
import { toast } from "sonner";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { EXPORT_COLUMNS } from "@/lib/export-columns";
import { hasActiveProfileFilters, type ProfileListQuery } from "@/lib/profile-query";
import {
  ROSTER_DEFAULT_COLUMN_KEYS,
  ROSTER_LOCKED_COLUMN_KEYS,
  ROSTER_MORE_COLUMN_CHOICES,
  ROSTER_PRIMARY_COLUMN_CHOICES,
  buildExportSearchParams,
  downloadExportFile,
  isChoiceSelected,
  type ExportColumnChoice,
  type ExportFormat,
} from "@/lib/export-request";

interface Props {
  onClose: () => void;
  /** 列表当前筛选状态（不含分页）；导出时原样下推，保证「看到什么就导出什么」 */
  filters: ProfileListQuery;
  /** 列表当前筛选后的总条数（含所有页）；0 时禁用导出 */
  total: number;
}

function formatDescription(format: ExportFormat): string {
  return format === "xlsx"
    ? "图片嵌入单元格，适合直接发给老师或存档"
    : "图片列输出链接，适合再导入其他系统";
}

export default function ExportProfilesDialog({ onClose, filters, total }: Props) {
  const [format, setFormat] = useState<ExportFormat>("xlsx");
  const [selected, setSelected] = useState<Set<string>>(() => new Set(ROSTER_DEFAULT_COLUMN_KEYS));
  const [moreOpen, setMoreOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  useEscapeKey(!exporting, onClose);

  const filtered = hasActiveProfileFilters(filters);
  const moreSelectedCount = useMemo(
    () => ROSTER_MORE_COLUMN_CHOICES.reduce(
      (count, choice) => count + (isChoiceSelected(choice, selected) ? 1 : 0),
      0
    ),
    [selected]
  );

  const toggleChoice = (choice: ExportColumnChoice) => {
    setSelected((prev) => {
      const next = new Set(prev);
      const allSelected = choice.keys.every((key) => next.has(key));
      for (const key of choice.keys) {
        if (allSelected) next.delete(key);
        else next.add(key);
      }
      return next;
    });
  };

  const handleExport = async () => {
    if (total === 0 || exporting) return;
    setExporting(true);
    try {
      // 列顺序由 EXPORT_COLUMNS 决定，与勾选顺序无关；姓名始终带上
      const chosen = new Set(selected);
      for (const key of ROSTER_LOCKED_COLUMN_KEYS) chosen.add(key);
      const columns = EXPORT_COLUMNS.filter((column) => chosen.has(column.key)).map((column) => column.key);
      const params = buildExportSearchParams({ format, columns, filters });
      await downloadExportFile(params, format);
      toast.success("导出成功");
      onClose();
    } catch (err) {
      console.error("Roster export failed:", err);
      toast.error(err instanceof Error ? err.message : "导出失败");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 px-4 backdrop-blur-sm"
      onClick={() => { if (!exporting) onClose(); }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="export-profiles-title"
        className="max-h-[88vh] w-full max-w-xl overflow-y-auto rounded-2xl border border-border-soft bg-card p-5 shadow-xl sm:p-6"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 id="export-profiles-title" className="text-lg font-semibold text-foreground">导出名单</h3>
            <p className="mt-1 text-sm leading-6 text-muted">
              {total === 0
                ? "当前筛选结果为空，暂无可导出的数据。"
                : filtered
                  ? `将导出当前筛选结果，共 ${total} 条（含所有页）。`
                  : `未筛选，将导出全部已提交档案，共 ${total} 条（含所有页）。`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="text-xl text-gray-400 hover:text-gray-600 disabled:opacity-40 dark:hover:text-gray-300"
            aria-label="关闭"
          >
            ×
          </button>
        </div>

        <div className="mt-5 space-y-4">
          <div>
            <p className="text-sm font-medium text-foreground">导出列</p>
            <p className="mt-0.5 text-xs text-muted">姓名固定导出；列顺序以系统定义为序，与勾选顺序无关。</p>
            <div className="mt-2 space-y-1.5">
              <div className="flex items-center gap-2 rounded-lg border border-border-soft bg-gray-50 px-3 py-2 dark:bg-gray-800/60">
                <input type="checkbox" checked disabled aria-label="姓名（固定导出）" className="rounded border-gray-300" />
                <span className="text-sm text-foreground">姓名</span>
                <span className="inline-flex items-center gap-1 rounded-full bg-gray-200 px-2 py-0.5 text-[10px] font-medium text-gray-600 dark:bg-gray-700 dark:text-gray-300">
                  <Lock className="h-3 w-3" aria-hidden="true" /> 固定
                </span>
              </div>
              {ROSTER_PRIMARY_COLUMN_CHOICES.map((choice) => (
                <label
                  key={choice.label}
                  className="flex cursor-pointer items-start gap-2.5 rounded-lg border border-border-soft px-3 py-2 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60"
                >
                  <input
                    type="checkbox"
                    checked={isChoiceSelected(choice, selected)}
                    onChange={() => toggleChoice(choice)}
                    disabled={exporting}
                    className="mt-0.5 rounded border-gray-300"
                  />
                  <span className="min-w-0">
                    <span className="block text-sm text-foreground">{choice.label}</span>
                    {choice.hint && <span className="mt-0.5 block text-xs leading-5 text-muted">{choice.hint}</span>}
                  </span>
                </label>
              ))}
            </div>
          </div>

          <div className="rounded-lg border border-border-soft">
            <button
              type="button"
              onClick={() => setMoreOpen((value) => !value)}
              aria-expanded={moreOpen}
              aria-controls="export-more-columns"
              className="flex w-full items-center justify-between gap-2 px-3 py-2.5 text-left"
            >
              <span className="text-sm font-medium text-foreground">
                更多列
                {moreSelectedCount > 0 && (
                  <span className="ml-1.5 text-xs font-normal text-muted">已选 {moreSelectedCount} 项</span>
                )}
              </span>
              <ChevronDown className={`h-4 w-4 text-muted transition-transform ${moreOpen ? "rotate-180" : ""}`} />
            </button>
            {moreOpen && (
              <div id="export-more-columns" className="space-y-1.5 border-t border-border-soft p-2">
                {ROSTER_MORE_COLUMN_CHOICES.map((choice) => (
                  <label
                    key={choice.label}
                    className="flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-1.5 transition-colors hover:bg-gray-50 dark:hover:bg-gray-800/60"
                  >
                    <input
                      type="checkbox"
                      checked={isChoiceSelected(choice, selected)}
                      onChange={() => toggleChoice(choice)}
                      disabled={exporting}
                      className="mt-0.5 rounded border-gray-300"
                    />
                    <span className="min-w-0">
                      <span className="block text-sm text-foreground">{choice.label}</span>
                      {choice.hint && <span className="mt-0.5 block text-xs leading-5 text-muted">{choice.hint}</span>}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          <fieldset>
            <legend className="text-sm font-medium text-foreground">格式</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {(["xlsx", "csv"] as const).map((value) => (
                <button
                  key={value}
                  type="button"
                  role="radio"
                  aria-checked={format === value}
                  onClick={() => setFormat(value)}
                  disabled={exporting}
                  className={`rounded-lg border p-3 text-left transition-colors focus:outline-none focus:ring-2 focus:ring-focus-ring ${
                    format === value
                      ? "border-primary bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
                      : "border-gray-200 bg-card text-gray-700 hover:border-green-300 dark:border-gray-700 dark:text-gray-200"
                  }`}
                >
                  <span className="block text-sm font-medium">{value === "xlsx" ? "Excel（.xlsx）" : "CSV"}</span>
                  <span className="mt-1 block text-xs text-muted">{formatDescription(value)}</span>
                </button>
              ))}
            </div>
          </fieldset>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <button
            type="button"
            onClick={onClose}
            disabled={exporting}
            className="rounded-lg border border-gray-200 px-4 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-50 disabled:opacity-50 dark:border-gray-700 dark:text-gray-200 dark:hover:bg-gray-800"
          >
            取消
          </button>
          <button
            type="button"
            onClick={handleExport}
            disabled={total === 0 || exporting}
            className="inline-flex items-center justify-center gap-1.5 rounded-lg bg-primary px-4 py-2 text-sm font-medium text-white transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50"
          >
            <Download className="h-4 w-4" aria-hidden="true" />
            {exporting ? "导出中..." : `导出（${total} 条）`}
          </button>
        </div>
      </div>
    </div>
  );
}
