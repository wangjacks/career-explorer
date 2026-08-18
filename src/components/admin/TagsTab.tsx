"use client";

import { useEffect, useMemo, useState } from "react";
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
  const [tagParent, setTagParent] = useState("");
  const [editing, setEditing] = useState<EditingTag | null>(null);

  const categories = useMemo(
    () => tags.filter((tag) => tag.type === "category").sort((a, b) => a.category_order - b.category_order || a.id - b.id),
    [tags]
  );

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
    const parentId = Number(tagParent);
    if (!name) return toast.warning("请输入标签名称");
    if (!parentId) return toast.warning("请选择所属分类");
    const siblingCount = tags.filter((tag) => tag.type === "tag" && tag.parent_id === parentId).length;
    if (await submit({ name, type: "tag", parent_id: parentId, sort_order: siblingCount }, "标签已新增")) {
      setTagName("");
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

  return (
    <div className="bg-white rounded-xl border border-gray-100 p-6 space-y-6">
      <div>
        <h2 className="font-semibold text-gray-800">标签管理</h2>
        <p className="text-xs text-gray-400 mt-1">停用不会删除历史标签数据。</p>
      </div>

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
            <select value={tagParent} onChange={(e) => setTagParent(e.target.value)} className="w-28 px-2 py-2 border border-gray-200 rounded-lg text-sm">
              <option value="">所属分类</option>
              {categories.filter((category) => category.active).map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </select>
            <button onClick={addTag} className="px-3 py-2 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg">新增</button>
          </div>
        </div>
      </div>

      {loading ? <p className="text-center py-8 text-gray-400">加载中...</p> : (
        <div className="space-y-3">
          {categories.map((category) => {
            const children = tags.filter((tag) => tag.type === "tag" && tag.parent_id === category.id)
              .sort((a, b) => a.sort_order - b.sort_order || a.id - b.id);
            return (
              <div key={category.id} className={`border rounded-lg overflow-hidden ${category.active ? "border-gray-100" : "border-gray-200 bg-gray-50"}`}>
                <div className="flex items-center gap-2 px-4 py-3 bg-gray-50">
                  {editing?.id === category.id ? (
                    <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 px-2 py-1 border border-gray-200 rounded text-sm" />
                  ) : <span className={`flex-1 text-sm font-medium ${category.active ? "text-gray-800" : "text-gray-400 line-through"}`}>{category.name}</span>}
                  <span className="text-xs text-gray-400">一级分类 · {children.length} 个标签</span>
                  <button onClick={() => moveTag(category, -1)} className="text-xs text-gray-500" title="上移">↑</button>
                  <button onClick={() => moveTag(category, 1)} className="text-xs text-gray-500" title="下移">↓</button>
                  {editing?.id === category.id ? <button onClick={saveEdit} className="text-xs text-green-600">保存</button> : <button onClick={() => setEditing({ ...category })} className="text-xs text-blue-600">编辑</button>}
                  <button onClick={() => toggleActive(category)} className="text-xs text-gray-500">{category.active ? "停用" : "恢复"}</button>
                </div>
                <div className="divide-y divide-gray-100">
                  {children.map((tag) => (
                    <div key={tag.id} className="flex items-center gap-2 px-4 py-2 pl-8">
                      {editing?.id === tag.id ? (
                        <div className="flex flex-1 gap-2">
                          <input autoFocus value={editing.name} onChange={(e) => setEditing({ ...editing, name: e.target.value })} className="flex-1 min-w-0 px-2 py-1 border border-gray-200 rounded text-sm" />
                          <select value={editing.parent_id ?? ""} onChange={(e) => setEditing({ ...editing, parent_id: Number(e.target.value) })} className="w-28 px-1 border border-gray-200 rounded text-xs">
                            {categories.filter((item) => item.active).map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}
                          </select>
                        </div>
                      ) : <span className={`flex-1 text-sm ${tag.active ? "text-gray-700" : "text-gray-400 line-through"}`}>{tag.name}</span>}
                      <button onClick={() => moveTag(tag, -1)} className="text-xs text-gray-500" title="上移">↑</button>
                      <button onClick={() => moveTag(tag, 1)} className="text-xs text-gray-500" title="下移">↓</button>
                      {editing?.id === tag.id ? <button onClick={saveEdit} className="text-xs text-green-600">保存</button> : <button onClick={() => setEditing({ ...tag })} className="text-xs text-blue-600">编辑</button>}
                      <button onClick={() => toggleActive(tag)} className="text-xs text-gray-500">{tag.active ? "停用" : "恢复"}</button>
                    </div>
                  ))}
                  {children.length === 0 && <p className="px-8 py-3 text-xs text-gray-400">暂无标签</p>}
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
