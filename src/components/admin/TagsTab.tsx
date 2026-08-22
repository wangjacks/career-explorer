"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";
import { ChevronDown, ChevronUp } from "lucide-react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";

interface TagItem {
  id: number;
  name: string;
  type: "category" | "tag";
  parent_id: number | null;
  category_order: number;
  sort_order: number;
  active: number;
}

interface EditingTag {
  id: number;
  name: string;
  parent_id: number | null;
  category_order: number;
  sort_order: number;
}

export default function TagsTab() {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [categoryName, setCategoryName] = useState("");
  const [tagName, setTagName] = useState("");
  const [editing, setEditing] = useState<EditingTag | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [selectedCatId, setSelectedCatId] = useState("");
  // 删除确认（#94：物理删除，单个/批量均需二次确认）
  const [deleting, setDeleting] = useState<TagItem | null>(null);
  const [batchDeleteOpen, setBatchDeleteOpen] = useState(false);
  // 恢复默认预设（#94 补充：二次确认后清空重插）
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);
  // 批量导入：粘贴/文件 → 预览核对 → 确认导入
  const [batchText, setBatchText] = useState("");
  const [batchPreview, setBatchPreview] = useState<{ category: string; name: string }[] | null>(null);
  const [importing, setImporting] = useState(false);
  const batchFileRef = useRef<HTMLInputElement>(null);
  // 排序草稿：非 null 表示有未保存的本地排序变更（避免每次移动都调 API 导致闪烁）
  const [draftTags, setDraftTags] = useState<TagItem[] | null>(null);
  const [savingSort, setSavingSort] = useState(false);

  // Category picker for add-tag form
  const [catOpen, setCatOpen] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const catRef = useRef<HTMLDivElement>(null);

  // Category picker for edit-tag form
  const [editCatOpen, setEditCatOpen] = useState(false);
  const [editCatSearch, setEditCatSearch] = useState("");
  const editCatRef = useRef<HTMLDivElement>(null);

  const displayTags = draftTags ?? tags;
  const categories = useMemo(
    () => displayTags.filter((tag) => tag.type === "category").sort((a, b) => a.category_order - b.category_order || a.id - b.id),
    [displayTags]
  );

  const filteredAddCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    return q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories;
  }, [categories, catSearch]);

  const filteredEditCategories = useMemo(() => {
    const q = editCatSearch.trim().toLowerCase();
    return q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories;
  }, [categories, editCatSearch]);

  // Close dropdowns on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false);
      if (editCatRef.current && !editCatRef.current.contains(e.target as Node)) setEditCatOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const refresh = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/manage/tags");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取标签失败");
      setTags(data.data || []);
    } catch (err) {
      console.error("Failed to load tags:", err);
      toast.error(err instanceof Error ? err.message : "获取标签失败");
    } finally {
      setLoading(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- load dynamic tags on mount */
  useEffect(() => {
    refresh();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const submit = async (body: Record<string, unknown>, successMessage: string) => {
    try {
      const res = await fetch("/api/manage/tags", {
        method: body.id ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
      toast.success(successMessage);
      await refresh();
      return true;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
      return false;
    }
  };

  const addCategory = async () => {
    const name = categoryName.trim();
    if (!name) return toast.warning("请输入分类名称");
    if (await submit({ name, type: "category", category_order: categories.length }, "分类已新增")) {
      setCategoryName("");
    }
  };

  const addTag = async () => {
    const name = tagName.trim();
    const parentId = Number(selectedCatId);
    if (!name) return toast.warning("请输入标签名称");
    if (!parentId) return toast.warning("请选择所属分类");
    const siblingCount = tags.filter((tag) => tag.type === "tag" && tag.parent_id === parentId).length;
    if (await submit({ name, type: "tag", parent_id: parentId, sort_order: siblingCount }, "标签已新增")) {
      setTagName("");
      setSelectedCatId("");
      setCatSearch("");
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return toast.warning("名称不能为空");
    if (await submit({ ...editing, name: editing.name.trim() }, "修改已保存")) {
      setEditing(null);
    }
  };

  /** 物理删除（单个/批量共用）；分类由服务端级联删除其下标签 */
  const doDelete = async (ids: number[], successMessage: string) => {
    try {
      const res = await fetch("/api/manage/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      toast.success(successMessage);
      setSelected(new Set());
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    }
  };

  const confirmDelete = async () => {
    if (!deleting) return;
    const target = deleting;
    setDeleting(null);
    await doDelete([target.id], `已删除「${target.name}」`);
  };

  const confirmBatchDelete = async () => {
    setBatchDeleteOpen(false);
    await doDelete(Array.from(selected), `已删除 ${selected.size} 项`);
  };

  const confirmRestore = async () => {
    setRestoreOpen(false);
    setRestoring(true);
    try {
      const res = await fetch("/api/manage/tags/restore", { method: "POST" });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "恢复失败");
      toast.success("已恢复默认预设");
      setSelected(new Set());
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复默认失败");
    } finally {
      setRestoring(false);
    }
  };

  const moveTag = (tag: TagItem, direction: -1 | 1) => {
    const base = draftTags ?? tags;
    const field = tag.type === "category" ? "category_order" : "sort_order";
    const siblings = base
      .filter((item) => item.type === tag.type && (tag.type === "category" || item.parent_id === tag.parent_id))
      .sort((a, b) => (tag.type === "category" ? a.category_order - b.category_order : a.sort_order - b.sort_order) || a.id - b.id);
    const index = siblings.findIndex((item) => item.id === tag.id);
    const target = siblings[index + direction];
    if (!target) return;
    const currentOrder = tag[field];
    const targetOrder = target[field];
    // 仅本地交换顺序，不调 API；由底部浮动 dock 统一保存/取消
    setDraftTags(base.map((item) => {
      if (item.id === tag.id) return { ...item, [field]: targetOrder };
      if (item.id === target.id) return { ...item, [field]: currentOrder };
      return item;
    }));
  };

  const cancelSort = () => setDraftTags(null);

  const saveSort = async () => {
    if (!draftTags) return;
    setSavingSort(true);
    try {
      const changes = draftTags.filter((d) => {
        const orig = tags.find((t) => t.id === d.id);
        if (!orig) return false;
        const field = d.type === "category" ? "category_order" : "sort_order";
        return orig[field] !== d[field];
      });
      const responses = await Promise.all(changes.map((d) => {
        const field = d.type === "category" ? "category_order" : "sort_order";
        return fetch("/api/manage/tags", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id: d.id, [field]: d[field] }),
        });
      }));
      if (responses.some((r) => !r.ok)) throw new Error("排序失败");
      // 乐观更新：直接生效草稿避免重新加载闪烁；后台同步服务端保证一致
      setTags(draftTags);
      setDraftTags(null);
      toast.success("已保存排序");
      fetch("/api/manage/tags").then((r) => r.json()).then((d) => { if (d.data) setTags(d.data); }).catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存排序失败");
    } finally {
      setSavingSort(false);
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  // ---- 批量导入（#94）----

  /** 逐行解析「分类,标签名」（兼容中文逗号/制表符分隔），跳过表头行，无效行丢弃 */
  const parseBatchText = (text: string): { category: string; name: string }[] => {
    const lines = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    // 跳过表头行（如 CSV 首行「分类,标签名」），避免误导入
    const start = lines.length > 0 && /^分类[,，\t]/.test(lines[0]) ? 1 : 0;
    return lines
      .slice(start)
      .map((line) => {
        const [category, name] = line.split(/[,，\t]/).map((s) => s.trim());
        return { category: category || "", name: name || "" };
      })
      .filter((item) => item.category && item.name);
  };

  const handleBatchParse = () => {
    const items = parseBatchText(batchText);
    if (items.length === 0) {
      toast.warning("未识别到有效数据，每行格式：分类,标签名");
      return;
    }
    setBatchPreview(items);
  };

  const handleBatchFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    try {
      const text = await file.text();
      setBatchText(text);
      const items = parseBatchText(text);
      if (items.length === 0) {
        toast.warning("未识别到有效数据，每行格式：分类,标签名");
        return;
      }
      setBatchPreview(items);
    } catch {
      toast.error("文件读取失败");
    }
  };

  const handleBatchImport = async () => {
    if (!batchPreview || batchPreview.length === 0) return;
    setImporting(true);
    try {
      const res = await fetch("/api/manage/tags/batch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ items: batchPreview }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "导入失败");
      toast.success(`已导入 ${data.imported} 个，跳过重复 ${data.skipped} 个`);
      setBatchText("");
      setBatchPreview(null);
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  // ---- category picker for add-tag ----

  const renderCategoryPicker = (
    open: boolean,
    setOpen: (v: boolean) => void,
    search: string,
    setSearch: (v: string) => void,
    ref: React.RefObject<HTMLDivElement | null>,
    filtered: TagItem[],
    selectedId: string,
    onSelect: (id: string) => void,
  ) => (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-green-300"
      >
        <span className={selectedId ? "text-gray-800" : "text-gray-400"}>
          {selectedId ? filtered.find((c) => c.id === Number(selectedId))?.name || "所属分类" : "所属分类"}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-card rounded-xl border border-gray-200 dark:border-gray-700 shadow-lg z-30">
          <div className="p-2 border-b border-gray-100 dark:border-gray-700">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索分类..."
              className="w-full px-2.5 py-1.5 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
              autoFocus
            />
          </div>
          <div className="max-h-48 overflow-y-auto py-1">
            {filtered.map((c) => {
              const isActive = selectedId === String(c.id);
              return (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => { onSelect(isActive ? "" : String(c.id)); setOpen(false); setSearch(""); }}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                    isActive ? "bg-green-50 dark:bg-green-900/30 text-green-700 dark:text-green-300" : "hover:bg-gray-50 dark:hover:bg-gray-800 text-gray-700 dark:text-gray-200"
                  }`}
                >
                  <span className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-xs ${
                    isActive ? "bg-green-500 border-green-500 text-white" : "border-gray-300"
                  }`}>
                    {isActive && "✓"}
                  </span>
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })}
            {filtered.length === 0 && <div className="px-3 py-4 text-center text-sm text-gray-400">无匹配分类</div>}
          </div>
        </div>
      )}
    </div>
  );

  // ---- Sort button ----
  const SortBtn = ({ onClick, dir, title }: { onClick: () => void; dir: "up" | "down"; title: string }) => (
    <button
      onClick={onClick}
      title={title}
      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-400 dark:text-gray-500 hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors flex-shrink-0"
    >
      {dir === "up" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  return (
    <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-6 space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-semibold text-gray-800 dark:text-gray-100">标签管理</h2>
          <p className="text-xs text-gray-400 dark:text-gray-500 mt-1">删除为物理删除，不影响学生已提交的标签数据；删除分类会同时删除其下标签。</p>
        </div>
        <button
          onClick={() => setRestoreOpen(true)}
          disabled={restoring}
          className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-200 text-xs rounded-lg transition-colors"
        >
          {restoring ? "恢复中..." : "恢复默认预设"}
        </button>
      </div>

      {/* Add forms */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">新增一级分类</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="分类名称"
              className="flex-1 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
            <button onClick={addCategory} className="px-3 py-2 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg whitespace-nowrap">新增</button>
          </div>
        </div>
        <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">新增二级标签</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="标签名称"
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
            <div className="flex gap-2">
              {renderCategoryPicker(catOpen, setCatOpen, catSearch, setCatSearch, catRef, filteredAddCategories, selectedCatId, (id) => { setSelectedCatId(id); setCatOpen(false); })}
              <button onClick={addTag} className="px-3 py-2 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg whitespace-nowrap">新增</button>
            </div>
          </div>
        </div>
      </div>

      {/* Batch import (#94): paste/file → preview → confirm */}
      <div className="border border-gray-100 dark:border-gray-700 rounded-lg p-4 space-y-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-gray-700 dark:text-gray-200">批量导入标签</h3>
          <button
            onClick={() => batchFileRef.current?.click()}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-xs rounded-lg transition-colors"
          >
            从文件导入（CSV/TXT）
          </button>
          <input ref={batchFileRef} type="file" accept=".csv,.txt" onChange={handleBatchFile} className="hidden" />
        </div>
        <textarea
          value={batchText}
          onChange={(e) => setBatchText(e.target.value)}
          rows={3}
          placeholder={"每行一条：分类,标签名\n示例：\n兴趣,阅读\n兴趣,编程\n技能,绘画"}
          className="w-full px-3 py-2 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-lg text-sm font-mono focus:outline-none focus:ring-2 focus:ring-green-300"
        />
        {batchPreview === null ? (
          <button
            onClick={handleBatchParse}
            disabled={!batchText.trim()}
            className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors"
          >
            预览核对
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-gray-500 dark:text-gray-400">
              识别到 {batchPreview.length} 条（分类不存在时将自动创建；已存在的标签自动跳过）
            </p>
            <div className="max-h-40 overflow-y-auto border border-gray-100 dark:border-gray-700 rounded-lg divide-y divide-gray-50 dark:divide-gray-700/50">
              {batchPreview.map((item, i) => (
                <div key={i} className="px-3 py-1.5 text-sm flex gap-2">
                  <span className="text-gray-400 dark:text-gray-500 flex-shrink-0">{item.category}</span>
                  <span className="text-gray-700 dark:text-gray-200 truncate">{item.name}</span>
                </div>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                onClick={handleBatchImport}
                disabled={importing}
                className="px-4 py-1.5 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
              >
                {importing ? "导入中..." : `确认导入（${batchPreview.length} 条）`}
              </button>
              <button
                onClick={() => setBatchPreview(null)}
                className="px-4 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors"
              >
                重新编辑
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Batch actions */}
      {selected.size > 0 && (
        <div className="flex flex-wrap items-center gap-2 sm:gap-3 px-4 py-2.5 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-100 dark:border-green-900">
          <span className="text-sm text-green-700 dark:text-green-400 font-medium">已选 {selected.size} 项</span>
          <button onClick={() => setBatchDeleteOpen(true)} className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg">批量删除</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700">取消选择</button>
        </div>
      )}

      {/* Tag list */}
      {loading ? <p className="text-center py-8 text-gray-400 dark:text-gray-500">加载中...</p> : (
        <div className="space-y-3">
          {categories.map((category) => {
            const children = displayTags.filter((tag) => tag.type === "tag" && tag.parent_id === category.id)
              .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
            return (
              <div key={category.id} className="border rounded-lg border-gray-100 dark:border-gray-700">
                <div className="px-4 py-3 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
                  {editing?.id === category.id ? (
                    <>
                      {/* Mobile: two-row layout */}
                      <div className="sm:hidden space-y-2">
                        <div className="flex items-center gap-2">
                          <input type="checkbox" className="rounded border-gray-300 text-green-500 focus:ring-green-300 flex-shrink-0" checked={selected.has(category.id)} onChange={() => toggleSelect(category.id)} />
                          <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-sm" />
                        </div>
                        <div className="flex items-center gap-2 pl-6">
                          <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0">一级分类 · {children.length} 个标签</span>
                          <SortBtn onClick={() => moveTag(category, -1)} dir="up" title="上移" />
                          <SortBtn onClick={() => moveTag(category, 1)} dir="down" title="下移" />
                          <button onClick={saveEdit} className="text-xs text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 flex-shrink-0">保存</button>
                          <button onClick={() => setEditing(null)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0">取消</button>
                        </div>
                      </div>
                      {/* Desktop: single-row layout */}
                      <div className="hidden sm:flex items-center gap-2">
                        <input type="checkbox" className="rounded border-gray-300 text-green-500 focus:ring-green-300 flex-shrink-0" checked={selected.has(category.id)} onChange={() => toggleSelect(category.id)} />
                        <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-sm" />
                        <SortBtn onClick={() => moveTag(category, -1)} dir="up" title="上移" />
                        <SortBtn onClick={() => moveTag(category, 1)} dir="down" title="下移" />
                        <button onClick={saveEdit} className="text-xs text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 flex-shrink-0">保存</button>
                        <button onClick={() => setEditing(null)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0">取消</button>
                      </div>
                    </>
                  ) : (
                    <div className="flex items-center gap-2">
                      <input type="checkbox" className="rounded border-gray-300 text-green-500 focus:ring-green-300 flex-shrink-0" checked={selected.has(category.id)} onChange={() => toggleSelect(category.id)} />
                      <span className="flex-1 min-w-0 text-sm font-medium truncate text-gray-800 dark:text-gray-100">{category.name}</span>
                      <span className="text-xs text-gray-400 dark:text-gray-500 flex-shrink-0 hidden sm:inline">一级分类 · {children.length} 个标签</span>
                      <SortBtn onClick={() => moveTag(category, -1)} dir="up" title="上移" />
                      <SortBtn onClick={() => moveTag(category, 1)} dir="down" title="下移" />
                      <button onClick={() => setEditing({ ...category })} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex-shrink-0">编辑</button>
                      <button onClick={() => setDeleting(category)} className="text-xs text-red-500 hover:text-red-600 flex-shrink-0">删除</button>
                    </div>
                  )}
                </div>
                {/* 不用 overflow-hidden：编辑二级标签时的分类选择下拉需溢出卡片显示 */}
                <div className="divide-y divide-gray-100 dark:divide-gray-700/50 rounded-b-lg">
                  {children.map((tag) => (
                    <div key={tag.id} className="px-4 py-2 pl-10">
                      {editing?.id === tag.id ? (
                        <>
                          {/* Mobile: two-row layout */}
                          <div className="sm:hidden space-y-2">
                            <div className="flex items-center gap-2">
                              <input type="checkbox" className="rounded border-gray-300 text-green-500 focus:ring-green-300 flex-shrink-0" checked={selected.has(tag.id)} onChange={() => toggleSelect(tag.id)} />
                              <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 min-w-0 px-2 py-1.5 border border-gray-200 rounded text-sm" />
                            </div>
                            <div className="flex items-center gap-2 pl-6">
                              <div className="flex-shrink-0">
                                {renderCategoryPicker(editCatOpen, setEditCatOpen, editCatSearch, setEditCatSearch, editCatRef, filteredEditCategories, String(editing.parent_id ?? ""), (id) => setEditing({ ...editing, parent_id: Number(id) || null }))}
                              </div>
                              <SortBtn onClick={() => moveTag(tag, -1)} dir="up" title="上移" />
                              <SortBtn onClick={() => moveTag(tag, 1)} dir="down" title="下移" />
                              <button onClick={saveEdit} className="text-xs text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 flex-shrink-0">保存</button>
                              <button onClick={() => setEditing(null)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0">取消</button>
                            </div>
                          </div>
                          {/* Desktop: single-row layout */}
                          <div className="hidden sm:flex items-center gap-2">
                            <input type="checkbox" className="rounded border-gray-300 text-green-500 focus:ring-green-300 flex-shrink-0" checked={selected.has(tag.id)} onChange={() => toggleSelect(tag.id)} />
                            <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-sm" />
                            <div className="flex-shrink-0">
                              {renderCategoryPicker(editCatOpen, setEditCatOpen, editCatSearch, setEditCatSearch, editCatRef, filteredEditCategories, String(editing.parent_id ?? ""), (id) => setEditing({ ...editing, parent_id: Number(id) || null }))}
                            </div>
                            <SortBtn onClick={() => moveTag(tag, -1)} dir="up" title="上移" />
                            <SortBtn onClick={() => moveTag(tag, 1)} dir="down" title="下移" />
                            <button onClick={saveEdit} className="text-xs text-green-600 dark:text-green-400 hover:text-green-700 dark:hover:text-green-300 flex-shrink-0">保存</button>
                            <button onClick={() => setEditing(null)} className="text-xs text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 flex-shrink-0">取消</button>
                          </div>
                        </>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input type="checkbox" className="rounded border-gray-300 text-green-500 focus:ring-green-300 flex-shrink-0" checked={selected.has(tag.id)} onChange={() => toggleSelect(tag.id)} />
                          <span className="flex-1 min-w-0 text-sm text-gray-700 dark:text-gray-200">{tag.name}</span>
                          <SortBtn onClick={() => moveTag(tag, -1)} dir="up" title="上移" />
                          <SortBtn onClick={() => moveTag(tag, 1)} dir="down" title="下移" />
                          <button onClick={() => setEditing({ ...tag })} className="text-xs text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 flex-shrink-0">编辑</button>
                          <button onClick={() => setDeleting(tag)} className="text-xs text-red-500 hover:text-red-600 flex-shrink-0">删除</button>
                        </div>
                      )}
                    </div>
                  ))}
                  {children.length === 0 && <p className="px-12 py-3 text-xs text-gray-400">暂无标签</p>}
                </div>
              </div>
            );
          })}
          {categories.length === 0 && <p className="text-center py-8 text-gray-400 dark:text-gray-500">暂无分类</p>}
        </div>
      )}

      {/* 排序草稿浮动 dock：有未保存排序变更时出现，取消恢复/保存批量提交 */}
      {draftTags && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-card border border-gray-200 dark:border-gray-700 rounded-xl shadow-lg animate-[fade-in_0.2s_ease-out]">
          <span className="text-sm text-gray-600 dark:text-gray-300">有未保存的排序变更</span>
          <button
            onClick={cancelSort}
            className="px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 text-sm rounded-lg transition-colors"
          >
            取消
          </button>
          <button
            onClick={saveSort}
            disabled={savingSort}
            className="px-3 py-1.5 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm rounded-lg transition-colors"
          >
            {savingSort ? "保存中..." : "保存排序"}
          </button>
        </div>
      )}
      {/* 删除确认弹窗（单个 / 批量） */}
      <ConfirmDialog
        open={deleting !== null}
        title="删除标签"
        message={
          deleting?.type === "category"
            ? `确定删除分类「${deleting?.name}」？其下 ${displayTags.filter((t) => t.type === "tag" && t.parent_id === deleting?.id).length} 个标签将一并删除。不影响学生已提交的数据。`
            : `确定删除标签「${deleting?.name}」？不影响学生已提交的数据。`
        }
        confirmText="删除"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleting(null)}
      />
      <ConfirmDialog
        open={batchDeleteOpen}
        title="批量删除"
        message={`确定删除已选的 ${selected.size} 项？删除分类会同时删除其下标签。不影响学生已提交的数据。`}
        confirmText="删除"
        variant="danger"
        onConfirm={confirmBatchDelete}
        onCancel={() => setBatchDeleteOpen(false)}
      />
      <ConfirmDialog
        open={restoreOpen}
        title="恢复默认预设"
        message="将清空当前所有标签（含自定义）并重置为默认预设。不影响学生已提交的标签数据。确定继续？"
        confirmText="恢复默认"
        variant="warning"
        onConfirm={confirmRestore}
        onCancel={() => setRestoreOpen(false)}
      />
    </div>
  );
}
