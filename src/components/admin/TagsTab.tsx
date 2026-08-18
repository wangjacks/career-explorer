"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { toast } from "sonner";

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

  // Category picker for add-tag form
  const [catOpen, setCatOpen] = useState(false);
  const [catSearch, setCatSearch] = useState("");
  const catRef = useRef<HTMLDivElement>(null);

  // Category picker for edit-tag form
  const [editCatOpen, setEditCatOpen] = useState(false);
  const [editCatSearch, setEditCatSearch] = useState("");
  const editCatRef = useRef<HTMLDivElement>(null);

  const categories = useMemo(
    () => tags.filter((tag) => tag.type === "category").sort((a, b) => a.category_order - b.category_order || a.id - b.id),
    [tags]
  );

  const filteredAddCategories = useMemo(() => {
    const q = catSearch.trim().toLowerCase();
    const list = categories.filter((c) => c.active);
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
  }, [categories, catSearch]);

  const filteredEditCategories = useMemo(() => {
    const q = editCatSearch.trim().toLowerCase();
    const list = categories.filter((c) => c.active);
    return q ? list.filter((c) => c.name.toLowerCase().includes(q)) : list;
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
      const res = await fetch("/api/admin/tags");
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
      const res = await fetch("/api/admin/tags", {
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

  const toggleActive = async (tag: TagItem) => {
    await submit({ id: tag.id, active: !tag.active }, tag.active ? "已停用" : "已恢复");
  };

  const moveTag = async (tag: TagItem, direction: -1 | 1) => {
    const siblings = tags
      .filter((item) => item.type === tag.type && (tag.type === "category" || item.parent_id === tag.parent_id))
      .sort((a, b) => (tag.type === "category" ? a.category_order - b.category_order : a.sort_order - b.sort_order) || a.id - b.id);
    const index = siblings.findIndex((item) => item.id === tag.id);
    const target = siblings[index + direction];
    if (!target) return;
    const currentOrder = tag.type === "category" ? tag.category_order : tag.sort_order;
    const targetOrder = tag.type === "category" ? target.category_order : target.sort_order;
    const field = tag.type === "category" ? "category_order" : "sort_order";
    try {
      const requests = [
        [tag.id, targetOrder],
        [target.id, currentOrder],
      ].map(([id, order]) => fetch("/api/admin/tags", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id, [field]: order }),
      }));
      const responses = await Promise.all(requests);
      if (responses.some((res) => !res.ok)) throw new Error("排序失败");
      await refresh();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "排序失败");
    }
  };

  const toggleSelect = (id: number) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id); else next.add(id);
      return next;
    });
  };

  const batchSetActive = async (active: boolean) => {
    if (selected.size === 0) return;
    try {
      await Promise.all(
        Array.from(selected).map((id) => fetch("/api/admin/tags", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, active }),
        }))
      );
      toast.success(active ? `已恢复 ${selected.size} 项` : `已停用 ${selected.size} 项`);
      setSelected(new Set());
      await refresh();
    } catch {
      toast.error("批量操作失败");
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
        className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm text-left flex items-center justify-between focus:outline-none focus:ring-2 focus:ring-green-300"
      >
        <span className={selectedId ? "text-gray-800" : "text-gray-400"}>
          {selectedId ? filtered.find((c) => c.id === Number(selectedId))?.name || "所属分类" : "所属分类"}
        </span>
        <svg className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {open && (
        <div className="absolute top-full left-0 mt-1 w-56 bg-white rounded-xl border border-gray-200 shadow-lg z-30">
          <div className="p-2 border-b border-gray-100">
            <input
              type="text"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="搜索分类..."
              className="w-full px-2.5 py-1.5 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
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
                    isActive ? "bg-green-50 text-green-700" : "hover:bg-gray-50 text-gray-700"
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
      className="inline-flex items-center justify-center w-6 h-6 rounded-md text-gray-400 hover:text-green-600 hover:bg-green-50 transition-colors flex-shrink-0"
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        {dir === "up"
          ? <path d="M18 15l-6-6-6 6" />
          : <path d="M6 9l6 6 6-6" />}
      </svg>
    </button>
  );

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-gray-800">标签管理</h2>
        <p className="text-xs text-gray-400 mt-1">停用不会删除历史标签数据。</p>
      </div>

      {/* Add forms */}
      <div className="grid gap-4 md:grid-cols-2">
        <div className="border border-gray-100 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-700">新增一级分类</h3>
          <div className="flex gap-2">
            <input value={categoryName} onChange={(e) => setCategoryName(e.target.value)} placeholder="分类名称"
              className="flex-1 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
            <button onClick={addCategory} className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">新增</button>
          </div>
        </div>
        <div className="border border-gray-100 rounded-lg p-4 space-y-3">
          <h3 className="text-sm font-medium text-gray-700">新增二级标签</h3>
          <div className="flex gap-2">
            <input value={tagName} onChange={(e) => setTagName(e.target.value)} placeholder="标签名称"
              className="flex-1 min-w-0 px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300" />
            {renderCategoryPicker(catOpen, setCatOpen, catSearch, setCatSearch, catRef, filteredAddCategories, selectedCatId, (id) => { setSelectedCatId(id); setCatOpen(false); })}
            <button onClick={addTag} className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">新增</button>
          </div>
        </div>
      </div>

      {/* Batch actions */}
      {selected.size > 0 && (
        <div className="flex items-center gap-3 px-4 py-2.5 bg-green-50 rounded-lg border border-green-100">
          <span className="text-sm text-green-700 font-medium">已选 {selected.size} 项</span>
          <button onClick={() => batchSetActive(true)} className="px-3 py-1 bg-green-500 hover:bg-green-600 text-white text-xs rounded-lg">恢复</button>
          <button onClick={() => batchSetActive(false)} className="px-3 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded-lg">停用</button>
          <button onClick={() => setSelected(new Set())} className="text-xs text-gray-500 hover:text-gray-700">取消选择</button>
        </div>
      )}

      {/* Tag list */}
      {loading ? <p className="text-center py-8 text-gray-400">加载中...</p> : (
        <div className="space-y-3">
          {categories.map((category) => {
            const children = tags.filter((tag) => tag.type === "tag" && tag.parent_id === category.id)
              .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
            return (
              <div key={category.id} className={`border rounded-lg overflow-hidden ${category.active ? "border-gray-100" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50">
                  <input
                    type="checkbox"
                    className="rounded border-gray-300 text-green-500 focus:ring-green-300"
                    checked={selected.has(category.id)}
                    onChange={() => toggleSelect(category.id)}
                  />
                  {editing?.id === category.id ? (
                    <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm" />
                  ) : <span className={`flex-1 text-sm font-medium ${category.active ? "text-gray-800" : "text-gray-400 line-through"}`}>{category.name}</span>}
                  <span className="text-xs text-gray-400">一级分类 · {children.length} 个标签</span>
                  <SortBtn onClick={() => moveTag(category, -1)} dir="up" title="上移" />
                  <SortBtn onClick={() => moveTag(category, 1)} dir="down" title="下移" />
                  {editing?.id === category.id
                    ? <button onClick={saveEdit} className="text-xs text-green-600 hover:text-green-700">保存</button>
                    : <button onClick={() => setEditing({ ...category })} className="text-xs text-blue-600 hover:text-blue-700">编辑</button>}
                  <button onClick={() => toggleActive(category)} className="text-xs text-gray-500 hover:text-gray-700">{category.active ? "停用" : "恢复"}</button>
                </div>
                <div className="divide-y divide-gray-100">
                  {children.map((tag) => (
                    <div key={tag.id} className="flex items-center gap-2 px-4 py-2 pl-10">
                      <input
                        type="checkbox"
                        className="rounded border-gray-300 text-green-500 focus:ring-green-300"
                        checked={selected.has(tag.id)}
                        onChange={() => toggleSelect(tag.id)}
                      />
                      {editing?.id === tag.id ? (
                        <div className="flex flex-1 gap-2 items-center">
                          <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-sm" />
                          {renderCategoryPicker(editCatOpen, setEditCatOpen, editCatSearch, setEditCatSearch, editCatRef, filteredEditCategories, String(editing.parent_id ?? ""), (id) => setEditing({ ...editing, parent_id: Number(id) || null }))}
                        </div>
                      ) : <span className={`flex-1 text-sm ${tag.active ? "text-gray-700" : "text-gray-400 line-through"}`}>{tag.name}</span>}
                      <SortBtn onClick={() => moveTag(tag, -1)} dir="up" title="上移" />
                      <SortBtn onClick={() => moveTag(tag, 1)} dir="down" title="下移" />
                      {editing?.id === tag.id
                        ? <button onClick={saveEdit} className="text-xs text-green-600 hover:text-green-700">保存</button>
                        : <button onClick={() => setEditing({ ...tag })} className="text-xs text-blue-600 hover:text-blue-700">编辑</button>}
                      <button onClick={() => toggleActive(tag)} className="text-xs text-gray-500 hover:text-gray-700">{tag.active ? "停用" : "恢复"}</button>
                    </div>
                  ))}
                  {children.length === 0 && <p className="px-12 py-3 text-xs text-gray-400">暂无标签</p>}
                </div>
              </div>
            );
          })}
          {categories.length === 0 && <p className="text-center py-8 text-gray-400">暂无分类</p>}
        </div>
      )}
    </div>
  );
}
