"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, FolderOpen, HardDrive, ImageIcon, RefreshCw, Search, Trash2, X } from "lucide-react";
import ConfirmDialog from "./ConfirmDialog";
import ThumbnailTab from "./ThumbnailTab";

interface MediaStatus {
  total: number;
  totalSize: number;
  orphanCount: number;
  orphanSize: number;
  deletableCount: number;
  deletableSize: number;
  retentionDays: number;
}

interface MediaFileItem {
  key: string;
  storageId: number;
  /** 存储后端名称 */
  backendName: string;
  size: number;
  lastModified: string;
  type: "avatar" | "evaluation" | "thumbnail" | "other";
  referenced: boolean;
  userCode: string | null;
  userName: string | null;
  sourceKey: string | null;
  orphanDays: number;
  deletable: boolean;
}

const TYPE_LABEL: Record<MediaFileItem["type"], string> = {
  avatar: "头像",
  evaluation: "词云",
  thumbnail: "缩略图",
  other: "其他",
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

/** 自定义下拉（#117）：按钮 + 弹出面板，样式与标签筛选/学生选择器一致（原生 select 弹出层无样式） */
function FilterSelect({
  value,
  options,
  onChange,
}: {
  value: string;
  options: { value: string; label: string }[];
  onChange: (value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const current = options.find((o) => o.value === value);
  return (
    <div className="relative" ref={ref}>
      <button
        onClick={() => setOpen((v) => !v)}
        className="px-3 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm font-medium transition-colors hover:border-gray-300 dark:hover:border-gray-600 flex items-center gap-1.5"
      >
        {current?.label ?? "全部"}
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-32 bg-card rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg z-30 py-1">
          {options.map((o) => (
            <button
              key={o.value}
              onClick={() => {
                onChange(o.value);
                setOpen(false);
              }}
              className={`w-full text-left px-3 py-1.5 text-sm transition-colors ${
                value === o.value
                  ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300"
                  : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
              }`}
            >
              {o.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * 媒体管理面板（#117）：全部存储资源列表（类型/引用状态/学生筛选，引用状态与关联学生可见）、
 * 孤儿文件按可配置保留期清理（源图删除连带缩略图）+ 缩略图维护（#118）。仅 admin。
 */
export default function MediaTab() {
  const [status, setStatus] = useState<MediaStatus | null>(null);
  const [statusLoading, setStatusLoading] = useState(false);
  const [retentionInput, setRetentionInput] = useState("7");
  const [savingRetention, setSavingRetention] = useState(false);
  const [subTab, setSubTab] = useState<"files" | "thumbnails">("files");

  // 媒体资源列表与筛选
  const [items, setItems] = useState<MediaFileItem[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [pageSize] = useState(20);
  const [listLoading, setListLoading] = useState(false);
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [studentQuery, setStudentQuery] = useState("");
  // 文件名搜索（#117）：独立维度，孤儿文件无关联学生时用此定位
  const [keywordQuery, setKeywordQuery] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  // 一键删除全部可删孤儿（#117）：列表预览 + 两段确认
  const [previewOpen, setPreviewOpen] = useState(false);
  const [previewList, setPreviewList] = useState<MediaFileItem[]>([]);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  // 请求序号守卫（CR P3-7）：快速连续「查询」/翻页时丢弃过期响应，避免旧响应覆盖新数据
  const listReqSeq = useRef(0);

  const loadStatus = useCallback(async () => {
    setStatusLoading(true);
    try {
      const res = await fetch("/api/manage/media/status");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "检测失败");
      setStatus(data);
      setRetentionInput(String(data.retentionDays));
    } catch (err) {
      console.error("Media status load failed:", err);
      toast.error(err instanceof Error ? err.message : "检测失败");
    } finally {
      setStatusLoading(false);
    }
  }, []);

  const loadFiles = useCallback(
    async (p: number) => {
      const seq = ++listReqSeq.current;
      setListLoading(true);
      try {
        const params = new URLSearchParams({ page: String(p), pageSize: String(pageSize) });
        if (typeFilter !== "all") params.set("type", typeFilter);
        if (statusFilter !== "all") params.set("status", statusFilter);
        if (studentQuery.trim()) params.set("student", studentQuery.trim());
        if (keywordQuery.trim()) params.set("keyword", keywordQuery.trim());
        const res = await fetch(`/api/manage/media/files?${params.toString()}`);
        const data = await res.json();
        if (!res.ok) throw new Error(data.error || "媒体列表加载失败");
        if (seq !== listReqSeq.current) return; // 过期响应丢弃（CR P3-7）
        setItems(data.items || []);
        setTotal(data.total || 0);
        setPage(data.page || 1);
        setSelected(new Set());
      } catch (err) {
        if (seq !== listReqSeq.current) return;
        console.error("Media files load failed:", err);
        toast.error(err instanceof Error ? err.message : "媒体列表加载失败");
      } finally {
        if (seq === listReqSeq.current) setListLoading(false);
      }
    },
    [typeFilter, statusFilter, studentQuery, keywordQuery, pageSize]
  );

  /* eslint-disable react-hooks/set-state-in-effect -- initial load on mount */
  useEffect(() => {
    loadStatus();
  }, [loadStatus]);
  /* eslint-enable react-hooks/set-state-in-effect */
  // 媒体列表不自动加载：初始置空，仅由「查询」/翻页/回车显式触发（files 端点每次全量扫描，降频）

  const saveRetention = async () => {
    const value = Number(retentionInput);
    if (!Number.isInteger(value) || value < 1 || value > 365) {
      toast.warning("保留期须为 1-365 的整数（天）");
      return;
    }
    setSavingRetention(true);
    try {
      const res = await fetch("/api/manage/media/status", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ retentionDays: value }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      toast.success(`保留期已更新为 ${data.retentionDays} 天`);
      await loadStatus();
      await loadFiles(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSavingRetention(false);
    }
  };

  const toggleSelect = (id: string, deletable: boolean) => {
    if (!deletable) return;
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectedItems = items.filter((i) => selected.has(`${i.storageId}:${i.key}`));
  const selectedSize = selectedItems.reduce((sum, i) => sum + i.size, 0);

  // 拉取全部可删孤儿（files 端点循环分页，服务端实时扫描）供预览
  const loadAllDeletable = async (): Promise<{ list: MediaFileItem[]; totalSize: number }> => {
    const list: MediaFileItem[] = [];
    let page = 1;
    for (;;) {
      const res = await fetch(`/api/manage/media/files?page=${page}&pageSize=100&status=orphan`);
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "孤儿列表加载失败");
      const deletable = (data.items as MediaFileItem[]).filter((i) => i.deletable);
      list.push(...deletable);
      if (page * 100 >= data.total) break;
      page += 1;
    }
    return { list, totalSize: list.reduce((s, i) => s + i.size, 0) };
  };

  // 第一步：加载列表并打开预览弹窗
  const openDeleteAllPreview = async () => {
    setPreviewOpen(true);
    setPreviewLoading(true);
    setPreviewList([]);
    try {
      const { list } = await loadAllDeletable();
      setPreviewList(list);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "孤儿列表加载失败");
      setPreviewOpen(false);
    } finally {
      setPreviewLoading(false);
    }
  };

  // 第二步：预览确认后弹出最终确认
  const requestFinalConfirm = () => {
    setPreviewOpen(false);
    setConfirmAll(true);
  };

  // 第三步：执行删除全部可删孤儿
  const handleDeleteAll = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/manage/media/orphans/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "all" }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "清理失败");
      toast.success(`已删除全部 ${data.deleted} 个可删孤儿文件（${formatBytes(data.deletedSizeBytes)}）`);
      setConfirmAll(false);
      setPreviewList([]);
      await loadStatus();
      await loadFiles(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清理失败");
    } finally {
      setDeleting(false);
    }
  };

  const previewSize = previewList.reduce((sum, i) => sum + i.size, 0);

  const handleDelete = async () => {
    setDeleting(true);
    try {
      const res = await fetch("/api/manage/media/orphans/cleanup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          items: selectedItems.map((i) => ({ key: i.key, storageId: i.storageId })),
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "清理失败");
      toast.success(`已删除 ${data.deleted} 个孤儿文件${data.skipped > 0 ? `，跳过 ${data.skipped} 个` : ""}`);
      setConfirmDelete(false);
      await loadStatus();
      await loadFiles(1);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "清理失败");
    } finally {
      setDeleting(false);
    }
  };

  const totalPages = Math.ceil(total / pageSize);

  return (
    <div className="space-y-5">
      {/* 存储总览与保留期配置 */}
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="flex items-center gap-2">
          <HardDrive size={16} className="text-gray-400 dark:text-gray-500" aria-hidden />
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">媒体管理</h2>
          <button
            onClick={() => { loadStatus(); }}
            disabled={statusLoading}
            className="ml-auto px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-600 dark:text-gray-300 text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${statusLoading ? "animate-spin" : ""}`} aria-hidden />
            重新检测
          </button>
        </div>

        {status === null ? (
          <p className="text-sm text-gray-400 dark:text-gray-500">{statusLoading ? "检测中..." : "检测失败，请重试"}</p>
        ) : (
          <>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">文件总数</p>
                <p className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 mt-1">{status.total}</p>
                <p className="text-xs text-gray-400 mt-0.5">{formatBytes(status.totalSize)}</p>
              </div>
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">孤儿文件</p>
                <p className="text-2xl font-extrabold text-gray-900 dark:text-gray-100 mt-1">{status.orphanCount}</p>
                <p className="text-xs text-gray-400 mt-0.5">{formatBytes(status.orphanSize)}</p>
              </div>
              <div className={`rounded-lg p-4 ${status.deletableCount > 0 ? "bg-amber-50 dark:bg-amber-900/20" : "bg-gray-50 dark:bg-gray-800"}`}>
                <p className={`text-xs ${status.deletableCount > 0 ? "text-amber-600 dark:text-amber-400" : "text-gray-500 dark:text-gray-400"}`}>
                  可清理（孤儿 ≥ {status.retentionDays} 天）
                </p>
                <p className={`text-2xl font-extrabold mt-1 ${status.deletableCount > 0 ? "text-amber-700 dark:text-amber-300" : "text-gray-900 dark:text-gray-100"}`}>
                  {status.deletableCount}
                </p>
                <p className="text-xs text-gray-400 mt-0.5">{formatBytes(status.deletableSize)}</p>
              </div>
              {status.deletableCount > 0 && (
                <button
                  onClick={openDeleteAllPreview}
                  disabled={previewLoading}
                  className="self-start sm:self-center px-4 py-2 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
                >
                  <Trash2 className="w-4 h-4" aria-hidden />
                  一键删除全部可删孤儿（{status.deletableCount} 个）
                </button>
              )}
              <div className="bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                <p className="text-xs text-gray-500 dark:text-gray-400">孤儿保留期</p>
                <div className="flex items-center gap-1.5 mt-1">
                  <input
                    type="number"
                    min={1}
                    max={365}
                    value={retentionInput}
                    disabled={savingRetention}
                    onChange={(e) => setRetentionInput(e.target.value)}
                    className="w-16 px-2 py-1 border border-gray-200 dark:border-gray-700 rounded-lg text-sm bg-card text-foreground focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                  <span className="text-xs text-gray-400">天</span>
                  <button
                    onClick={saveRetention}
                    disabled={savingRetention}
                    className="px-2.5 py-1 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
                  >
                    {savingRetention ? "保存中" : "保存"}
                  </button>
                </div>
              </div>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              展示全部存储资源（含被引用文件与关联学生）；孤儿 = 未被任何档案或历史版本引用，超过保留期才可清理（覆盖「上传→保存」宽限期），源图删除时连带其缩略图。
            </p>
          </>
        )}
      </div>

      {/* 子面板：媒体资源 / 缩略图维护 */}
      <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
        <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1 w-fit">
          <button
            onClick={() => setSubTab("files")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              subTab === "files"
                ? "bg-card text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <FolderOpen className="w-3.5 h-3.5" aria-hidden />
              媒体资源（{total}）
            </span>
          </button>
          <button
            onClick={() => setSubTab("thumbnails")}
            className={`px-4 py-1.5 rounded-lg text-sm font-medium transition-colors ${
              subTab === "thumbnails"
                ? "bg-card text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            <span className="inline-flex items-center gap-1.5">
              <ImageIcon className="w-3.5 h-3.5" aria-hidden />
              缩略图维护
            </span>
          </button>
        </div>

        {subTab === "thumbnails" ? (
          <ThumbnailTab />
        ) : (
          <div className="space-y-3">
            {/* 筛选条：条件变更仅更新状态，点「查询」才发起请求（files 端点每次全量扫描，降频） */}
            <div className="flex flex-wrap items-center gap-2">
              <FilterSelect
                value={typeFilter}
                onChange={setTypeFilter}
                options={[
                  { value: "all", label: "全部类型" },
                  { value: "avatar", label: "头像" },
                  { value: "evaluation", label: "词云" },
                  { value: "thumbnail", label: "缩略图" },
                  { value: "other", label: "其他" },
                ]}
              />
              <FilterSelect
                value={statusFilter}
                onChange={setStatusFilter}
                options={[
                  { value: "all", label: "全部状态" },
                  { value: "referenced", label: "使用中" },
                  { value: "orphan", label: "孤儿" },
                ]}
              />
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
                <input
                  type="text"
                  value={studentQuery}
                  onChange={(e) => setStudentQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") loadFiles(1); }}
                  placeholder="搜索关联学号/姓名..."
                  className="pl-8 pr-3 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
              <div className="relative">
                <Search className="w-4 h-4 text-gray-400 absolute left-2.5 top-1/2 -translate-y-1/2" aria-hidden />
                <input
                  type="text"
                  value={keywordQuery}
                  onChange={(e) => setKeywordQuery(e.target.value)}
                  onKeyDown={(e) => { if (e.key === "Enter") loadFiles(1); }}
                  placeholder="搜索文件名..."
                  className="pl-8 pr-3 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm w-56 focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
              <button
                onClick={() => loadFiles(1)}
                disabled={listLoading}
                className="px-3 py-1.5 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
              >
                <Search className="w-3.5 h-3.5" aria-hidden />
                查询
              </button>
              {(typeFilter !== "all" || statusFilter !== "all" || studentQuery.trim() || keywordQuery.trim()) && (
                <button
                  onClick={() => { setTypeFilter("all"); setStatusFilter("all"); setStudentQuery(""); setKeywordQuery(""); }}
                  className="text-xs text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
                >
                  清除筛选
                </button>
              )}
              {selected.size > 0 && (
                <button
                  onClick={() => setConfirmDelete(true)}
                  disabled={deleting}
                  className="ml-auto px-3 py-1.5 bg-red-500 hover:bg-red-600 disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors flex items-center gap-1"
                >
                  <Trash2 className="w-3.5 h-3.5" aria-hidden />
                  删除选中孤儿（{selected.size} 个，{formatBytes(selectedSize)}）
                </button>
              )}
            </div>

            {listLoading ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">加载中...</p>
            ) : items.length === 0 && total === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">点击上方「查询」按钮加载媒体资源</p>
            ) : items.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">无匹配项</p>
            ) : (
              <div className="overflow-x-auto rounded-lg border border-gray-100 dark:border-gray-700">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-gray-50 dark:bg-gray-800 text-left text-gray-500 dark:text-gray-400 text-xs">
                      <th className="px-3 py-2.5 font-medium w-10"></th>
                      <th className="px-3 py-2.5 font-medium">文件名</th>
                      <th className="px-3 py-2.5 font-medium">类型</th>
                      <th className="px-3 py-2.5 font-medium">存储后端</th>
                      <th className="px-3 py-2.5 font-medium">大小</th>
                      <th className="px-3 py-2.5 font-medium">更新时间</th>
                      <th className="px-3 py-2.5 font-medium">状态</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                    {items.map((item) => {
                      const id = `${item.storageId}:${item.key}`;
                      return (
                        <tr key={id} className="hover:bg-gray-50/50 dark:hover:bg-gray-800/40">
                          <td className="px-3 py-2.5">
                            <input
                              type="checkbox"
                              checked={selected.has(id)}
                              disabled={!item.deletable || item.type === "thumbnail"}
                              onChange={() => toggleSelect(id, item.deletable)}
                              className="rounded border-gray-300 dark:border-gray-700"
                              aria-label={`选择 ${item.key}`}
                            />
                          </td>
                          <td className="px-3 py-2.5 font-mono text-xs text-gray-600 dark:text-gray-300 break-all">{item.key}</td>
                          <td className="px-3 py-2.5">
                            <span className="px-2 py-0.5 rounded-full text-xs bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                              {TYPE_LABEL[item.type]}
                            </span>
                          </td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{item.backendName}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{formatBytes(item.size)}</td>
                          <td className="px-3 py-2.5 text-gray-500 text-xs">{item.lastModified.slice(0, 19).replace("T", " ")}</td>
                          <td className="px-3 py-2.5 text-xs">
                            {item.referenced ? (
                              <span className="text-green-600 dark:text-green-400">
                                使用中{item.userCode ? ` · ${item.userName}（${item.userCode}）` : ""}
                              </span>
                            ) : item.deletable ? (
                              <span className="text-amber-600 dark:text-amber-400">孤儿 · 可清理（孤 {item.orphanDays} 天）</span>
                            ) : (
                              <span className="text-gray-400 dark:text-gray-500">
                                孤儿 · 保留中（剩 {Math.max(0, (status?.retentionDays ?? 7) - item.orphanDays)} 天）
                              </span>
                            )}
                            {item.type === "thumbnail" && (
                              <span className="text-gray-400 dark:text-gray-500">（随源图）</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}

            {totalPages > 1 && (
              <div className="flex items-center justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">第 {page}/{totalPages} 页（共 {total} 个文件）</span>
                <div className="flex gap-2">
                  <button
                    onClick={() => loadFiles(page - 1)}
                    disabled={page <= 1 || listLoading}
                    className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    上一页
                  </button>
                  <button
                    onClick={() => loadFiles(page + 1)}
                    disabled={page >= totalPages || listLoading}
                    className="px-3 py-1 rounded-lg border border-gray-200 dark:border-gray-700 disabled:opacity-40 hover:bg-gray-50 dark:hover:bg-gray-800"
                  >
                    下一页
                  </button>
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* 一键删除全部：第一步列表预览（展示待删文件，二次确认） */}
      {previewOpen && (
        <div className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4" onClick={() => setPreviewOpen(false)}>
          <div
            className="bg-card rounded-2xl shadow-xl max-w-2xl w-full p-6 space-y-4 max-h-[85vh] flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between">
              <h3 className="font-semibold text-gray-800 dark:text-gray-100 text-lg">
                待删除的孤儿文件
              </h3>
              <button onClick={() => setPreviewOpen(false)} className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors" aria-label="关闭预览">
                <X className="w-5 h-5" />
              </button>
            </div>
            <p className="text-xs text-gray-400 dark:text-gray-500">
              以下文件当前未被任何档案或历史版本引用，且已超过保留期（{status?.retentionDays ?? 7} 天）。删除不可恢复，请核对清单。
            </p>
            {previewLoading ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">加载中...</p>
            ) : previewList.length === 0 ? (
              <p className="text-sm text-gray-400 dark:text-gray-500">没有可删除的孤儿文件</p>
            ) : (
              <>
                <div className="overflow-y-auto rounded-lg border border-gray-100 dark:border-gray-700 flex-1 min-h-0">
                  <table className="w-full text-sm">
                    <thead className="sticky top-0 bg-gray-50 dark:bg-gray-800">
                      <tr className="text-left text-gray-500 dark:text-gray-400 text-xs">
                        <th className="px-3 py-2 font-medium">文件名</th>
                        <th className="px-3 py-2 font-medium">类型</th>
                        <th className="px-3 py-2 font-medium">后端</th>
                        <th className="px-3 py-2 font-medium">大小</th>
                        <th className="px-3 py-2 font-medium">孤 N 天</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50 dark:divide-gray-700/50">
                      {previewList.map((item) => (
                        <tr key={`${item.storageId}:${item.key}`}>
                          <td className="px-3 py-1.5 font-mono text-xs text-gray-600 dark:text-gray-300 break-all">{item.key}</td>
                          <td className="px-3 py-1.5">
                            <span className="px-1.5 py-0.5 rounded-full text-[10px] bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300">
                              {TYPE_LABEL[item.type]}
                            </span>
                          </td>
                          <td className="px-3 py-1.5 text-gray-500 text-xs">{item.backendName}</td>
                          <td className="px-3 py-1.5 text-gray-500 text-xs">{formatBytes(item.size)}</td>
                          <td className="px-3 py-1.5 text-gray-500 text-xs">{item.orphanDays} 天</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <div className="flex items-center gap-3 flex-wrap">
                  <span className="text-sm text-gray-500 dark:text-gray-400">
                    共 {previewList.length} 个文件 · {formatBytes(previewSize)}
                  </span>
                  <button
                    onClick={requestFinalConfirm}
                    className="ml-auto px-4 py-2 bg-red-500 hover:bg-red-600 text-white text-sm font-medium rounded-lg transition-colors flex items-center gap-1.5"
                  >
                    <Trash2 className="w-4 h-4" aria-hidden />
                    确认删除
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* 一键删除全部：第二步最终确认 */}
      <ConfirmDialog
        open={confirmAll}
        title="最终确认：删除全部可删孤儿"
        variant="danger"
        confirmText={deleting ? "删除中..." : "确认删除"}
        message={`将删除 ${previewList.length} 个孤儿文件（${formatBytes(previewSize)}），源图删除时连带其缩略图。此操作不可恢复，确定继续吗？`}
        onConfirm={handleDeleteAll}
        onCancel={() => setConfirmAll(false)}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="确认删除孤儿文件"
        variant="danger"
        confirmText={deleting ? "删除中..." : "确认删除"}
        message={`将删除 ${selected.size} 个孤儿文件（${formatBytes(selectedSize)}），源图删除时连带其缩略图。此操作不可恢复，确定继续吗？`}
        onConfirm={handleDelete}
        onCancel={() => setConfirmDelete(false)}
      />
    </div>
  );
}
