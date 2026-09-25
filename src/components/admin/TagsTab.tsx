"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { toast } from "sonner";
import {
  CheckSquare,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  Download,
  Pencil,
  Search,
  Trash2,
} from "lucide-react";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import {
  buildTagExportRows,
  previewTagImport,
  summarizeSelection,
  toggleCategorySelection,
  toggleTagSelection,
} from "@/lib/tag-utils";

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

/** 删除确认目标：单个删除与批量删除共用同一确认弹窗与文案结构（#163） */
interface DeleteTarget {
  ids: number[];
  title: string;
  message: ReactNode;
}

/** 撤销窗口内的待删除任务（#163：超时后提交服务端） */
interface PendingDelete {
  ids: number[];
}

/** 表头关键词（对齐学生名单导入的识别思路）：首行单元格命中即判定为表头行并跳过 */
const TAG_HEADER_KEYWORDS = ["分类", "标签名", "标签", "category", "tag", "name"];

/** 删除撤销窗口：确认后先本地隐藏，窗口内可撤销，超时才真正删除 */
const UNDO_WINDOW_MS = 6000;

/**
 * 标签管理（#94 功能基线 + #163 操作路径重设计）
 * - 选择：分类级联选中其下全部标签；已选条常驻显示分类/标签构成与实际影响行数
 * - 层级：分类可折叠、可全部展开/收起；标签可直接移动到其它分类
 * - 批量：批量移动 / 批量删除；删除统一确认弹窗 + 6 秒撤销窗口
 * - 导入导出：导入前预览影响面（新建分类 / 将跳过），并支持导出 XLSX 回导
 */
export default function TagsTab() {
  const [tags, setTags] = useState<TagItem[]>([]);
  const [loading, setLoading] = useState(true);

  // 搜索、折叠与筛选
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState<Set<number>>(new Set());
  const [showSelectedOnly, setShowSelectedOnly] = useState(false);

  // 新增 / 编辑
  const [categoryName, setCategoryName] = useState("");
  const [tagName, setTagName] = useState("");
  const [selectedCatId, setSelectedCatId] = useState("");
  const [editing, setEditing] = useState<EditingTag | null>(null);
  const categoryInputRef = useRef<HTMLInputElement>(null);

  // 分类选择器（新增标签 / 编辑标签共用一份状态机）
  const [catOpen, setCatOpen] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const catRef = useRef<HTMLDivElement>(null);
  const [editCatOpen, setEditCatOpen] = useState(false);
  const [editCatSearch, setEditCatSearch] = useState("");
  const editCatRef = useRef<HTMLDivElement>(null);

  // 选择与批量操作
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<DeleteTarget | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PendingDelete | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [moveTargetId, setMoveTargetId] = useState("");
  const [moving, setMoving] = useState(false);

  // 恢复默认预设
  const [restoreOpen, setRestoreOpen] = useState(false);
  const [restoring, setRestoring] = useState(false);

  // 批量导入
  const [batchText, setBatchText] = useState("");
  const [batchPreview, setBatchPreview] = useState<{ category: string; name: string }[] | null>(null);
  const [importing, setImporting] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const batchFileRef = useRef<HTMLInputElement>(null);

  // 排序草稿
  const [draftTags, setDraftTags] = useState<TagItem[] | null>(null);
  const [savingSort, setSavingSort] = useState(false);

  // 导出
  const [exporting, setExporting] = useState(false);

  // 撤销窗口的定时器与最新待删任务（供卸载时兜底提交）
  const undoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingRef = useRef<number[] | null>(null);

  /** 乐观隐藏待删除项，撤销窗口内不请求服务端 */
  const liveTags = useMemo(
    () => (pendingDelete ? tags.filter((tag) => !pendingDelete.ids.includes(tag.id)) : tags),
    [tags, pendingDelete]
  );
  const displayTags = draftTags ?? liveTags;

  const categories = useMemo(
    () =>
      displayTags
        .filter((tag) => tag.type === "category")
        .sort((a, b) => a.category_order - b.category_order || a.id - b.id),
    [displayTags]
  );

  /** 某分类下的二级标签（按 sort_order 排序） */
  const childrenOf = useCallback(
    (categoryId: number) =>
      displayTags
        .filter((tag) => tag.type === "tag" && tag.parent_id === categoryId)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id),
    [displayTags]
  );

  const selection = useMemo(() => summarizeSelection(selected, displayTags), [selected, displayTags]);
  const selectedItems = useMemo(
    () => Array.from(selected).map((id) => displayTags.find((tag) => tag.id === id)).filter((t): t is TagItem => Boolean(t)),
    [selected, displayTags]
  );

  const filteredAddCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    return q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories;
  }, [categories, catSearch]);

  const filteredEditCategories = useMemo(() => {
    const q = editCatSearch.trim().toLowerCase();
    return q ? categories.filter((c) => c.name.toLowerCase().includes(q)) : categories;
  }, [categories, editCatSearch]);

  /** 列表可见行：受搜索与「仅看已选」影响 */
  const visibleRows = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows: { category: TagItem; children: TagItem[] }[] = [];
    for (const category of categories) {
      const all = displayTags
        .filter((tag) => tag.type === "tag" && tag.parent_id === category.id)
        .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
      if (showSelectedOnly) {
        const kids = all.filter((tag) => selected.has(tag.id));
        const categorySelected = selected.has(category.id);
        if (!categorySelected && kids.length === 0) continue;
        rows.push({ category, children: categorySelected ? all : kids });
        continue;
      }
      if (!q) {
        rows.push({ category, children: all });
        continue;
      }
      const categoryMatched = category.name.toLowerCase().includes(q);
      const matchedChildren = all.filter((tag) => tag.name.toLowerCase().includes(q));
      if (categoryMatched || matchedChildren.length > 0) {
        rows.push({ category, children: categoryMatched ? all : matchedChildren });
      }
    }
    return rows;
  }, [categories, displayTags, query, showSelectedOnly, selected]);

  const allCollapsed = categories.length > 0 && categories.every((c) => collapsed.has(c.id));

  // ---- 数据加载与基础请求 ----

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

  /** 卸载时兜底：撤销窗口内离开页面则立即提交删除，避免操作被静默丢弃 */
  useEffect(() => {
    return () => {
      if (undoTimerRef.current) clearTimeout(undoTimerRef.current);
      const ids = pendingRef.current;
      if (ids && ids.length > 0) {
        void fetch("/api/manage/tags", {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ids }),
        });
      }
    };
  }, []);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (catRef.current && !catRef.current.contains(e.target as Node)) setCatOpen(false);
      if (editCatRef.current && !editCatRef.current.contains(e.target as Node)) setEditCatOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEscapeKey(moveOpen, () => setMoveOpen(false));

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
      return data;
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
      return null;
    }
  };

  // ---- 新增 / 编辑 ----

  const addCategory = async (name: string): Promise<number | null> => {
    const trimmed = name.trim();
    if (!trimmed) {
      toast.warning("请输入分类名称");
      return null;
    }
    const created = await submit(
      { name: trimmed, type: "category", category_order: categories.length },
      "分类已新增"
    );
    if (created) {
      setCategoryName("");
      return created.id as number;
    }
    return null;
  };

  const addTag = async () => {
    const name = tagName.trim();
    const parentId = Number(selectedCatId);
    if (!name) return toast.warning("请输入标签名称");
    if (!parentId) return toast.warning("请选择所属分类");
    const siblingCount = childrenOf(parentId).length;
    const created = await submit(
      { name, type: "tag", parent_id: parentId, sort_order: siblingCount },
      "标签已新增"
    );
    if (created) {
      setTagName("");
      setSelectedCatId("");
      setCatSearch("");
    }
  };

  const saveEdit = async () => {
    if (!editing || !editing.name.trim()) return toast.warning("名称不能为空");
    const saved = await submit({ ...editing, name: editing.name.trim() }, "修改已保存");
    if (saved) setEditing(null);
  };

  /** 选择器内快速新建分类（#163：新增/编辑标签时无需来回切换表单） */
  const createCategoryFromPicker = async (name: string, forEdit: boolean) => {
    const id = await addCategory(name);
    if (!id) return;
    if (forEdit) {
      setEditing((prev) => (prev ? { ...prev, parent_id: id } : prev));
      setEditCatSearch("");
      setEditCatOpen(false);
      return;
    }
    setSelectedCatId(String(id));
    setCatSearch("");
    setCatOpen(false);
  };

  // ---- 选择（#163：分类级联）----

  const toggleCategory = (categoryId: number) => {
    setSelected((prev) => toggleCategorySelection(prev, categoryId, childrenOf(categoryId).map((t) => t.id)));
  };

  const toggleTag = (tag: TagItem) => {
    setSelected((prev) => toggleTagSelection(prev, tag.id, tag.parent_id));
  };

  const selectVisible = () => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of visibleRows) {
        next.add(row.category.id);
        childrenOf(row.category.id).forEach((tag) => next.add(tag.id));
      }
      return next;
    });
  };

  const clearSelection = () => setSelected(new Set());

  const toggleCollapse = (categoryId: number) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(categoryId)) next.delete(categoryId);
      else next.add(categoryId);
      return next;
    });
  };

  const toggleAllCollapsed = () => {
    setCollapsed(allCollapsed ? new Set() : new Set(categories.map((c) => c.id)));
  };

  // ---- 删除（统一确认 + 撤销窗口）----

  const commitDelete = useCallback(async (ids: number[]) => {
    try {
      const res = await fetch("/api/manage/tags", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "删除失败");
      toast.success(`已删除 ${ids.length} 项`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "删除失败");
    } finally {
      pendingRef.current = null;
      setPendingDelete(null);
      await refresh();
    }
  }, []);

  /** 立即提交撤销窗口内的待删任务（新的删除操作开始时调用） */
  const flushPendingDelete = useCallback(() => {
    const ids = pendingRef.current;
    if (!ids || ids.length === 0) return;
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    pendingRef.current = null;
    setPendingDelete(null);
    void commitDelete(ids);
  }, [commitDelete]);

  const undoDelete = useCallback(() => {
    if (undoTimerRef.current) {
      clearTimeout(undoTimerRef.current);
      undoTimerRef.current = null;
    }
    pendingRef.current = null;
    setPendingDelete(null);
    toast.info("已撤销删除");
  }, []);

  const confirmDelete = () => {
    if (!deleteTarget) return;
    const ids = deleteTarget.ids;
    setDeleteTarget(null);
    flushPendingDelete();
    setSelected(new Set());
    pendingRef.current = ids;
    setPendingDelete({ ids });
    toast(`已删除 ${ids.length} 项`, {
      description: "不影响学生已提交的数据",
      duration: UNDO_WINDOW_MS,
      action: { label: "撤销", onClick: () => undoDelete() },
    });
    undoTimerRef.current = setTimeout(() => {
      undoTimerRef.current = null;
      void commitDelete(ids);
    }, UNDO_WINDOW_MS);
  };

  const requestSingleDelete = (tag: TagItem) => {
    const cascade = tag.type === "category" ? childrenOf(tag.id).length : 0;
    setDeleteTarget({
      ids: [tag.id, ...(tag.type === "category" ? childrenOf(tag.id).map((t) => t.id) : [])],
      title: tag.type === "category" ? "删除分类" : "删除标签",
      message:
        tag.type === "category"
          ? `确定删除分类「${tag.name}」？其下 ${cascade} 个标签将一并删除。删除后 ${UNDO_WINDOW_MS / 1000} 秒内可撤销；不影响学生已提交的数据。`
          : `确定删除标签「${tag.name}」？删除后 ${UNDO_WINDOW_MS / 1000} 秒内可撤销；不影响学生已提交的数据。`,
    });
  };

  const requestBatchDelete = () => {
    if (selection.affected === 0) return;
    const preview = selectedItems.slice(0, 8);
    setDeleteTarget({
      ids: selectedItems.map((tag) => tag.id),
      title: "批量删除",
      message: (
        <div className="space-y-2 text-left">
          <p>
            确定删除已选的 {selection.affected} 项（分类 {selection.categories} · 标签 {selection.tags}）？删除分类会同时删除其下标签；删除后{" "}
            {UNDO_WINDOW_MS / 1000} 秒内可撤销，不影响学生已提交的数据。
          </p>
          <ul className="space-y-0.5 text-xs text-muted max-h-32 overflow-y-auto">
            {preview.map((tag) => (
              <li key={tag.id}>
                · {tag.type === "category" ? "分类" : "标签"}：{tag.name}
              </li>
            ))}
            {selectedItems.length > preview.length && <li>… 等共 {selectedItems.length} 项</li>}
          </ul>
        </div>
      ),
    });
  };

  // ---- 批量移动（复用单条 PATCH，无需新增接口）----

  const openMove = () => {
    if (selection.tags === 0) {
      return toast.warning("请至少选择一个二级标签（一级分类不支持移动）");
    }
    setMoveTargetId("");
    setMoveOpen(true);
  };

  const confirmMove = async () => {
    const targetId = Number(moveTargetId);
    if (!targetId) return toast.warning("请选择目标分类");
    const movingTags = selectedItems.filter((tag) => tag.type === "tag");
    if (movingTags.length === 0) return toast.warning("请至少选择一个二级标签");
    setMoving(true);
    try {
      const baseCount = childrenOf(targetId).filter((tag) => !selected.has(tag.id)).length;
      const responses = await Promise.all(
        movingTags.map((tag, index) =>
          fetch("/api/manage/tags", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: tag.id, parent_id: targetId, sort_order: baseCount + index }),
          })
        )
      );
      if (responses.some((r) => !r.ok)) throw new Error("部分标签移动失败");
      const targetName = categories.find((c) => c.id === targetId)?.name ?? "";
      toast.success(`已移动 ${movingTags.length} 个标签到「${targetName}」`);
      setMoveOpen(false);
      setMoveTargetId("");
      setSelected(new Set());
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "移动失败");
    } finally {
      setMoving(false);
    }
  };

  // ---- 恢复默认预设 ----

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

  // ---- 排序（本地草稿 + 统一保存）----

  const moveTag = (tag: TagItem, direction: -1 | 1) => {
    const base = draftTags ?? tags;
    const field = tag.type === "category" ? "category_order" : "sort_order";
    const siblings = base
      .filter((item) => item.type === tag.type && (tag.type === "category" || item.parent_id === tag.parent_id))
      .sort((a, b) =>
        tag.type === "category"
          ? a.category_order - b.category_order || a.id - b.id
          : a.sort_order - b.sort_order || a.id - b.id
      );
    const index = siblings.findIndex((item) => item.id === tag.id);
    const target = siblings[index + direction];
    if (!target) return;
    const currentOrder = tag[field];
    const targetOrder = target[field];
    setDraftTags(
      base.map((item) => {
        if (item.id === tag.id) return { ...item, [field]: targetOrder };
        if (item.id === target.id) return { ...item, [field]: currentOrder };
        return item;
      })
    );
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
      const responses = await Promise.all(
        changes.map((d) => {
          const field = d.type === "category" ? "category_order" : "sort_order";
          return fetch("/api/manage/tags", {
            method: "PATCH",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ id: d.id, [field]: d[field] }),
          });
        })
      );
      if (responses.some((r) => !r.ok)) throw new Error("排序失败");
      // 乐观更新：直接生效草稿避免重新加载闪烁；后台同步服务端保证一致
      setTags(draftTags);
      setDraftTags(null);
      toast.success("已保存排序");
      fetch("/api/manage/tags")
        .then((r) => r.json())
        .then((d) => {
          if (d.data) setTags(d.data);
        })
        .catch(() => {});
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存排序失败");
    } finally {
      setSavingSort(false);
    }
  };

  // ---- 批量导入 ----

  /** 逐行解析「分类,标签名」（兼容中文逗号/制表符分隔/UTF-8 BOM）；表头行按关键词识别跳过 */
  const parseBatchText = (text: string): { category: string; name: string }[] => {
    const lines = text
      .replace(/^\uFEFF/, "")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    if (lines.length === 0) return [];
    const firstCells = lines[0].split(/[,，\t]/).map((s) => s.trim().toLowerCase());
    const hasHeader = firstCells.some((c) => TAG_HEADER_KEYWORDS.includes(c));
    return lines
      .slice(hasHeader ? 1 : 0)
      .map((line) => {
        const [category, name] = line.split(/[,，\t]/).map((s) => s.trim());
        return { category: category || "", name: name || "" };
      })
      .filter((item) => item.category && item.name);
  };

  const readFileToText = async (file: File): Promise<string> => {
    if (/\.(csv|txt)$/i.test(file.name)) {
      return await file.text();
    }
    const mod = await import("exceljs");
    const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(await file.arrayBuffer());
    const sheet = workbook.worksheets[0];
    if (!sheet) throw new Error("文件没有工作表");
    const lines: string[] = [];
    sheet.eachRow((row) => {
      const cells: string[] = [];
      row.eachCell({ includeEmpty: true }, (cell) => {
        cells.push(cell.value == null ? "" : String(cell.value).trim());
      });
      if (cells.some((c) => c)) lines.push(cells.join(","));
    });
    return lines.join("\n");
  };

  const handleBatchParse = () => {
    const items = parseBatchText(batchText);
    if (items.length === 0) {
      toast.warning("未识别到有效数据，每行格式：分类,标签名");
      return;
    }
    setBatchPreview(items);
  };

  const importFile = async (file: File) => {
    try {
      const text = await readFileToText(file);
      setBatchText(text);
      const items = parseBatchText(text);
      if (items.length === 0) {
        toast.warning("未识别到有效数据，每行格式：分类,标签名");
        return;
      }
      setBatchPreview(items);
    } catch (err) {
      console.error("Tag file import parse error:", err);
      toast.error(err instanceof Error ? err.message : "文件解析失败");
    }
  };

  const handleBatchFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    await importFile(file);
  };

  const clearBatch = () => {
    setBatchText("");
    setBatchPreview(null);
    if (batchFileRef.current) batchFileRef.current.value = "";
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
      clearBatch();
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "导入失败");
    } finally {
      setImporting(false);
    }
  };

  /** 导入影响面预览（复刻服务端去重口径） */
  const importPreview = useMemo(
    () => (batchPreview ? previewTagImport(batchPreview, displayTags) : null),
    [batchPreview, displayTags]
  );

  // ---- 导出（与导入格式一致，可直接回导）----

  const exportTags = async () => {
    if (displayTags.length === 0) {
      toast.warning("没有可导出的标签");
      return;
    }
    setExporting(true);
    try {
      const mod = await import("exceljs");
      const ExcelJS = (mod as unknown as { default?: typeof mod }).default ?? mod;
      const workbook = new ExcelJS.Workbook();
      const { pairs, categories: categoryRows } = buildTagExportRows(displayTags);
      const sheet = workbook.addWorksheet("标签清单");
      sheet.addRow(["分类", "标签名"]);
      pairs.forEach((row) => sheet.addRow(row));
      const categorySheet = workbook.addWorksheet("分类清单");
      categorySheet.addRow(["分类"]);
      categoryRows.forEach((row) => categorySheet.addRow(row));
      const buffer = await workbook.xlsx.writeBuffer();
      const blob = new Blob([buffer as unknown as BlobPart], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = `标签清单-${new Date().toISOString().slice(0, 10)}.xlsx`;
      link.click();
      URL.revokeObjectURL(url);
      toast.success(`已导出 ${pairs.length} 条标签`);
    } catch (err) {
      console.error("Tag export failed:", err);
      toast.error("导出失败");
    } finally {
      setExporting(false);
    }
  };

  // ---- 共享 UI 片段 ----

  const secondaryButton =
    "px-3 py-1.5 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-200 text-xs rounded-lg transition-colors";
  const primaryButton =
    "px-4 py-1.5 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm rounded-lg transition-colors";
  const dangerButton = "px-3 py-1 bg-danger hover:bg-red-600 text-white text-xs rounded-lg transition-colors";
  const inputClass =
    "px-3 py-2 border border-border-soft bg-card text-foreground rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring";

  const SortBtn = ({ onClick, dir, label }: { onClick: () => void; dir: "up" | "down"; label: string }) => (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      title={label}
      className="inline-flex items-center justify-center w-7 h-7 rounded-md text-muted hover:text-green-600 dark:hover:text-green-400 hover:bg-green-50 dark:hover:bg-green-900/30 transition-colors flex-shrink-0"
    >
      {dir === "up" ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
    </button>
  );

  const renderCategoryPicker = (
    open: boolean,
    setOpen: (v: boolean) => void,
    search: string,
    setSearch: (v: string) => void,
    ref: React.RefObject<HTMLDivElement | null>,
    filtered: TagItem[],
    selectedId: string,
    onSelect: (id: string) => void,
    onCreate: ((name: string) => void) | null
  ) => (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-label="选择所属分类"
        className={`${inputClass} w-full text-left flex items-center justify-between gap-2`}
      >
        <span className={selectedId ? "text-foreground truncate" : "text-muted truncate"}>
          {selectedId ? filtered.find((c) => c.id === Number(selectedId))?.name || "所属分类" : "所属分类"}
        </span>
        <ChevronDown className={`w-3.5 h-3.5 text-muted transition-transform flex-shrink-0 ${open ? "rotate-180" : ""}`} />
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-card rounded-xl border border-border-soft shadow-lg z-30">
          <div className="p-2 border-b border-border-soft">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索分类..."
              aria-label="搜索分类"
              className={`${inputClass} w-full py-1.5`}
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
                  onClick={() => {
                    onSelect(isActive ? "" : String(c.id));
                    setOpen(false);
                    setSearch("");
                  }}
                  className={`w-full text-left px-3 py-1.5 text-sm flex items-center gap-2 transition-colors ${
                    isActive
                      ? "bg-primary-soft text-primary"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800 text-foreground"
                  }`}
                >
                  <span
                    className={`w-4 h-4 rounded border flex items-center justify-center flex-shrink-0 text-xs ${
                      isActive ? "bg-primary border-primary text-white" : "border-gray-300"
                    }`}
                  >
                    {isActive && "✓"}
                  </span>
                  <span className="truncate">{c.name}</span>
                </button>
              );
            })}
            {filtered.length === 0 && (
              <div className="px-3 py-3 text-center space-y-2">
                <p className="text-xs text-muted">{search.trim() ? "无匹配分类" : "还没有分类"}</p>
                {onCreate && search.trim() && (
                  <button type="button" onClick={() => onCreate(search.trim())} className={secondaryButton}>
                    新建分类「{search.trim()}」
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className={`bg-card rounded-xl border border-border-soft p-6 space-y-6 ${draftTags ? "pb-28" : ""}`}>
      {/* 头部：说明 + 导出 / 恢复默认 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="font-semibold text-foreground">标签管理</h2>
          <p className="text-xs text-muted mt-1">
            删除为物理删除，不影响学生已提交的标签数据；删除分类会同时删除其下标签，删除后 6 秒内可撤销。
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button onClick={exportTags} disabled={exporting} className={secondaryButton} aria-label="导出标签清单">
            <span className="inline-flex items-center gap-1.5">
              <Download className="w-3.5 h-3.5" />
              {exporting ? "导出中..." : "导出 XLSX"}
            </span>
          </button>
          <button
            onClick={() => setRestoreOpen(true)}
            disabled={restoring}
            className="px-3 py-1.5 border border-danger/40 text-danger hover:bg-danger/10 disabled:opacity-50 text-xs rounded-lg transition-colors"
          >
            {restoring ? "恢复中..." : "恢复默认预设"}
          </button>
        </div>
      </div>

      {/* 工具条：搜索 / 选择 / 折叠 */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[12rem]">
          <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-muted" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="搜索分类或标签名"
            aria-label="搜索分类或标签名"
            className={`${inputClass} w-full pl-8`}
          />
        </div>
        <button onClick={selectVisible} className={secondaryButton} aria-label="全选当前筛选结果">
          <span className="inline-flex items-center gap-1.5">
            <CheckSquare className="w-3.5 h-3.5" />
            全选筛选结果
          </span>
        </button>
        <button onClick={clearSelection} disabled={selected.size === 0} className={secondaryButton}>
          清空选择
        </button>
        <button onClick={toggleAllCollapsed} className={secondaryButton}>
          {allCollapsed ? "全部展开" : "全部折叠"}
        </button>
        <button
          onClick={() => setShowSelectedOnly((v) => !v)}
          aria-pressed={showSelectedOnly}
          className={`${secondaryButton} ${showSelectedOnly ? "ring-2 ring-focus-ring" : ""}`}
        >
          仅看已选
        </button>
      </div>

      {/* 新增表单 */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-border-soft rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">新增一级分类</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              ref={categoryInputRef}
              value={categoryName}
              onChange={(e) => setCategoryName(e.target.value)}
              placeholder="分类名称"
              aria-label="分类名称"
              className={`${inputClass} flex-1`}
            />
            <button onClick={() => addCategory(categoryName)} className={`${primaryButton} whitespace-nowrap`}>
              新增
            </button>
          </div>
        </div>
        <div className="border border-border-soft rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-foreground">新增二级标签</h3>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              value={tagName}
              onChange={(e) => setTagName(e.target.value)}
              placeholder="标签名称"
              aria-label="标签名称"
              className={`${inputClass} flex-1 min-w-0`}
            />
            <div className="flex gap-2">
              {renderCategoryPicker(
                catOpen,
                setCatOpen,
                catSearch,
                setCatSearch,
                catRef,
                filteredAddCategories,
                selectedCatId,
                (id) => {
                  setSelectedCatId(id);
                  setCatOpen(false);
                },
                (name) => void createCategoryFromPicker(name, false)
              )}
              <button onClick={addTag} className={`${primaryButton} whitespace-nowrap`}>
                新增
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 批量导入：粘贴 / 文件 / 拖拽 → 影响面预览 → 确认 */}
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragActive(true);
        }}
        onDragLeave={() => setDragActive(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragActive(false);
          const file = e.dataTransfer.files?.[0];
          if (file) importFile(file);
        }}
        className={`border rounded-lg p-4 space-y-3 transition-colors ${
          dragActive ? "border-green-400 bg-primary-soft" : "border-border-soft"
        }`}
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-medium text-foreground">
            批量导入标签
            {dragActive && <span className="ml-2 text-green-600 dark:text-green-400">松开导入文件</span>}
          </h3>
          <div className="flex flex-wrap items-center gap-2">
            <button onClick={() => batchFileRef.current?.click()} className={secondaryButton}>
              从文件导入（CSV/TXT/XLSX）
            </button>
            <button onClick={clearBatch} disabled={!batchText && !batchPreview} className={secondaryButton}>
              清空
            </button>
            <input ref={batchFileRef} type="file" accept=".csv,.txt,.xlsx" onChange={handleBatchFile} className="hidden" />
          </div>
        </div>
        <textarea
          value={batchText}
          onChange={(e) => setBatchText(e.target.value)}
          rows={3}
          aria-label="批量导入文本"
          placeholder={"每行一条：分类,标签名\n示例：\n兴趣,阅读\n兴趣,编程\n技能,绘画"}
          className={`${inputClass} w-full font-mono`}
        />
        {batchPreview === null || !importPreview ? (
          <button onClick={handleBatchParse} disabled={!batchText.trim()} className={secondaryButton}>
            预览核对
          </button>
        ) : (
          <div className="space-y-2">
            <p className="text-xs text-muted">
              识别到 {importPreview.rows.length} 条：将导入{" "}
              <span className="text-foreground font-medium">{importPreview.importCount}</span> 条
              {importPreview.newCategoryCount > 0 && <>（其中新建分类 {importPreview.newCategoryCount} 个）</>}
              {importPreview.skipCount > 0 && (
                <>
                  ，将跳过 <span className="text-foreground font-medium">{importPreview.skipCount}</span> 条（已存在或批次内重复）
                </>
              )}
            </p>
            <div className="max-h-44 overflow-y-auto border border-border-soft rounded-lg divide-y divide-gray-100 dark:divide-gray-700/50">
              {importPreview.rows.map((row, i) => (
                <div key={`${row.category}-${row.name}-${i}`} className="px-3 py-1.5 text-sm flex items-center gap-2">
                  <span className="text-muted flex-shrink-0">{row.category}</span>
                  <span className="text-foreground truncate flex-1">{row.name}</span>
                  {row.createsCategory && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-300 flex-shrink-0">
                      新建分类
                    </span>
                  )}
                  {row.skips && (
                    <span className="text-xs px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-muted flex-shrink-0">
                      跳过
                    </span>
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                onClick={handleBatchImport}
                disabled={importing || importPreview.importCount === 0}
                className={primaryButton}
              >
                {importing ? "导入中..." : `确认导入（${importPreview.importCount} 条）`}
              </button>
              <button onClick={() => setBatchPreview(null)} className={secondaryButton}>
                重新编辑
              </button>
              <button onClick={clearBatch} className={secondaryButton}>
                清空
              </button>
            </div>
          </div>
        )}
      </div>

      {/* 选择操作条：常驻显示已选构成与实际影响行数 */}
      {selection.affected > 0 && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2.5 bg-primary-soft dark:bg-green-900/20 rounded-lg border border-border-soft">
          <span className="text-sm font-medium text-foreground">已选 {selection.affected} 项</span>
          <span className="text-xs text-muted">
            分类 {selection.categories} · 标签 {selection.tags}（删除分类会级联其下标签）
          </span>
          <div className="flex flex-wrap items-center gap-2 ml-auto">
            <button onClick={openMove} className={secondaryButton}>
              批量移动
            </button>
            <button onClick={requestBatchDelete} className={dangerButton}>
              批量删除
            </button>
            <button onClick={clearSelection} className={secondaryButton}>
              取消选择
            </button>
          </div>
        </div>
      )}

      {/* 列表 */}
      {loading ? (
        <div className="space-y-3" aria-busy="true" aria-label="加载标签中">
          {[0, 1, 2].map((i) => (
            <div key={i} className="border border-border-soft rounded-lg p-4 space-y-2 animate-pulse">
              <div className="h-3.5 w-1/4 rounded bg-gray-200 dark:bg-gray-700" />
              <div className="h-3 w-1/2 rounded bg-gray-100 dark:bg-gray-800" />
            </div>
          ))}
        </div>
      ) : (
        <div className="space-y-3">
          {visibleRows.map(({ category, children }) => {
            const allChildren = childrenOf(category.id);
            const isCollapsed = collapsed.has(category.id);
            const selectedChildren = allChildren.filter((tag) => selected.has(tag.id)).length;
            return (
              <div key={category.id} className="border border-border-soft rounded-lg">
                <div className="px-3 py-2.5 bg-gray-50 dark:bg-gray-800 rounded-t-lg">
                  {editing?.id === category.id ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <input
                        type="checkbox"
                        checked={selected.has(category.id)}
                        onChange={() => toggleCategory(category.id)}
                        aria-label={`选择分类 ${category.name}`}
                        className="rounded border-gray-300 text-green-500 focus:ring-focus-ring flex-shrink-0"
                      />
                      <input
                        autoFocus
                        value={editing.name}
                        onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                        aria-label="分类名称"
                        className={`${inputClass} flex-1 min-w-[8rem] py-1`}
                      />
                      <SortBtn onClick={() => moveTag(category, -1)} dir="up" label={`上移分类 ${category.name}`} />
                      <SortBtn onClick={() => moveTag(category, 1)} dir="down" label={`下移分类 ${category.name}`} />
                      <button onClick={saveEdit} className="text-xs text-green-600 dark:text-green-400 hover:underline flex-shrink-0">
                        保存
                      </button>
                      <button onClick={() => setEditing(null)} className="text-xs text-muted hover:text-foreground flex-shrink-0">
                        取消
                      </button>
                    </div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => toggleCollapse(category.id)}
                        aria-label={isCollapsed ? `展开分类 ${category.name}` : `折叠分类 ${category.name}`}
                        aria-expanded={!isCollapsed}
                        className="p-1 rounded-md text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
                      >
                        {isCollapsed ? <ChevronRight className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
                      </button>
                      <input
                        type="checkbox"
                        checked={selected.has(category.id)}
                        onChange={() => toggleCategory(category.id)}
                        aria-label={`选择分类 ${category.name}（含其下 ${allChildren.length} 个标签）`}
                        className="rounded border-gray-300 text-green-500 focus:ring-focus-ring flex-shrink-0"
                      />
                      <span className="flex-1 min-w-0 text-sm font-medium truncate text-foreground">{category.name}</span>
                      <span className="text-xs text-muted flex-shrink-0 hidden sm:inline">
                        一级分类 · {allChildren.length} 个标签
                        {selectedChildren > 0 && ` · 已选 ${selectedChildren}`}
                      </span>
                      <SortBtn onClick={() => moveTag(category, -1)} dir="up" label={`上移分类 ${category.name}`} />
                      <SortBtn onClick={() => moveTag(category, 1)} dir="down" label={`下移分类 ${category.name}`} />
                      <button
                        onClick={() => setEditing({ ...category })}
                        aria-label={`编辑分类 ${category.name}`}
                        className="p-1 rounded-md text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={() => requestSingleDelete(category)}
                        aria-label={`删除分类 ${category.name}`}
                        className="p-1 rounded-md text-danger hover:bg-danger/10 flex-shrink-0"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  )}
                </div>
                <div className="divide-y divide-gray-100 dark:divide-gray-700/50 rounded-b-lg">
                  {children.map((tag) => (
                    <div key={tag.id} className="px-3 py-2 pl-8">
                      {editing?.id === tag.id ? (
                        <div className="flex flex-wrap items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected.has(tag.id)}
                            onChange={() => toggleTag(tag)}
                            aria-label={`选择标签 ${tag.name}`}
                            className="rounded border-gray-300 text-green-500 focus:ring-focus-ring flex-shrink-0"
                          />
                          <input
                            autoFocus
                            value={editing.name}
                            onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                            aria-label="标签名称"
                            className={`${inputClass} flex-1 min-w-[8rem] py-1`}
                          />
                          <div className="flex-shrink-0">
                            {renderCategoryPicker(
                              editCatOpen,
                              setEditCatOpen,
                              editCatSearch,
                              setEditCatSearch,
                              editCatRef,
                              filteredEditCategories,
                              String(editing.parent_id ?? ""),
                              (id) => setEditing({ ...editing, parent_id: Number(id) || null }),
                              (name) => void createCategoryFromPicker(name, true)
                            )}
                          </div>
                          <SortBtn onClick={() => moveTag(tag, -1)} dir="up" label={`上移标签 ${tag.name}`} />
                          <SortBtn onClick={() => moveTag(tag, 1)} dir="down" label={`下移标签 ${tag.name}`} />
                          <button onClick={saveEdit} className="text-xs text-green-600 dark:text-green-400 hover:underline flex-shrink-0">
                            保存
                          </button>
                          <button onClick={() => setEditing(null)} className="text-xs text-muted hover:text-foreground flex-shrink-0">
                            取消
                          </button>
                        </div>
                      ) : (
                        <div className="flex items-center gap-2">
                          <input
                            type="checkbox"
                            checked={selected.has(tag.id)}
                            onChange={() => toggleTag(tag)}
                            aria-label={`选择标签 ${tag.name}`}
                            className="rounded border-gray-300 text-green-500 focus:ring-focus-ring flex-shrink-0"
                          />
                          <span className="flex-1 min-w-0 text-sm text-foreground truncate">{tag.name}</span>
                          <SortBtn onClick={() => moveTag(tag, -1)} dir="up" label={`上移标签 ${tag.name}`} />
                          <SortBtn onClick={() => moveTag(tag, 1)} dir="down" label={`下移标签 ${tag.name}`} />
                          <button
                            onClick={() => setEditing({ ...tag })}
                            aria-label={`编辑标签 ${tag.name}`}
                            className="p-1 rounded-md text-muted hover:text-foreground hover:bg-gray-100 dark:hover:bg-gray-700 flex-shrink-0"
                          >
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => requestSingleDelete(tag)}
                            aria-label={`删除标签 ${tag.name}`}
                            className="p-1 rounded-md text-danger hover:bg-danger/10 flex-shrink-0"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      )}
                    </div>
                  ))}
                  {children.length === 0 && (
                    <p className="px-8 py-3 text-xs text-muted">
                      {isCollapsed ? "已折叠" : "该分类暂无标签"}
                    </p>
                  )}
                </div>
              </div>
            );
          })}
          {categories.length === 0 && (
            <div className="text-center py-10 space-y-3">
              <p className="text-sm text-muted">还没有分类：先新增一级分类，或在上方批量导入「分类,标签名」</p>
              <button onClick={() => categoryInputRef.current?.focus()} className={primaryButton}>
                新增一级分类
              </button>
            </div>
          )}
          {categories.length > 0 && visibleRows.length === 0 && (
            <p className="text-center py-8 text-sm text-muted">
              {showSelectedOnly ? "当前没有已选项" : "没有匹配的标签，试试其它关键词"}
            </p>
          )}
        </div>
      )}

      {/* 排序草稿浮动 dock：有未保存变更时出现 */}
      {draftTags && (
        <div className="fixed bottom-4 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 px-4 py-3 bg-card border border-border-soft rounded-xl shadow-lg animate-[fade-in_0.2s_ease-out]">
          <span className="text-sm text-foreground">有未保存的排序变更</span>
          <button onClick={cancelSort} className={secondaryButton}>
            取消
          </button>
          <button onClick={saveSort} disabled={savingSort} className={`${primaryButton} text-sm`}>
            {savingSort ? "保存中..." : "保存排序"}
          </button>
        </div>
      )}

      {/* 删除确认（单个 / 批量共用） */}
      <ConfirmDialog
        open={deleteTarget !== null}
        title={deleteTarget?.title ?? "删除标签"}
        message={deleteTarget?.message ?? ""}
        confirmText="删除"
        variant="danger"
        onConfirm={confirmDelete}
        onCancel={() => setDeleteTarget(null)}
      />

      {/* 批量移动 */}
      {moveOpen && (
        <div
          className="fixed inset-0 bg-black/40 backdrop-blur-sm flex items-center justify-center z-50 px-4"
          onClick={() => setMoveOpen(false)}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="批量移动到分类"
            className="bg-card rounded-2xl shadow-xl max-w-sm w-full p-6 space-y-4 animate-[scale-in_0.15s_ease-out]"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="font-semibold text-foreground text-lg">批量移动到分类</h3>
            <p className="text-sm text-muted">
              将 {selection.tags} 个二级标签移动到目标分类；已选的一级分类不受影响。
            </p>
            <label className="block space-y-1">
              <span className="text-xs text-muted">目标分类</span>
              <select
                value={moveTargetId}
                onChange={(e) => setMoveTargetId(e.target.value)}
                className={`${inputClass} w-full`}
              >
                <option value="">请选择分类</option>
                {categories.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex gap-2 pt-1">
              <button onClick={() => setMoveOpen(false)} className={`${secondaryButton} flex-1 py-2 text-sm`}>
                取消
              </button>
              <button onClick={confirmMove} disabled={moving} className={`${primaryButton} flex-1 py-2`}>
                {moving ? "移动中..." : "确认移动"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* 恢复默认预设 */}
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
