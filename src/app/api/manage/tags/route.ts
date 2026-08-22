import { NextRequest, NextResponse } from "next/server";
import { getTags, insertTag, updateTag, deleteTags } from "@/lib/db";
import type { TagRow } from "@/lib/db";

type TagType = "category" | "tag";

function parseType(value: unknown): TagType | null {
  return value === "category" || value === "tag" ? value : null;
}

function parseOrder(value: unknown, fallback = 0): number {
  if (value === undefined) return fallback;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : NaN;
}

function validateParent(tags: TagRow[], type: TagType, parentId: unknown): number | null | undefined {
  if (type === "category") return null;
  const id = Number(parentId);
  const parent = tags.find((tag) => tag.id === id);
  return parent?.type === "category" ? id : undefined;
}

function errorResponse(err: unknown, fallback: string) {
  const duplicate = err instanceof Error && /unique|duplicate/i.test(err.message);
  return NextResponse.json(
    { error: duplicate ? "标签名称已存在" : fallback },
    { status: duplicate ? 409 : 500 }
  );
}

export async function GET() {
  try {
    return NextResponse.json({ data: await getTags() });
  } catch (err) {
    console.error("Admin tags GET error:", err);
    return NextResponse.json({ error: "获取标签失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const name = String(body.name ?? "").trim();
    const type = parseType(body.type);
    if (!name || name.length > 50 || !type) {
      return NextResponse.json({ error: "标签名称或类型无效" }, { status: 400 });
    }
    const tags = await getTags();
    const parentId = validateParent(tags, type, body.parent_id);
    if (parentId === undefined) {
      return NextResponse.json({ error: "请选择有效的一级分类" }, { status: 400 });
    }
    const categoryOrder = parseOrder(body.category_order);
    const sortOrder = parseOrder(body.sort_order);
    if (Number.isNaN(categoryOrder) || Number.isNaN(sortOrder)) {
      return NextResponse.json({ error: "排序值无效" }, { status: 400 });
    }
    const id = await insertTag({ name, type, parent_id: parentId, category_order: categoryOrder, sort_order: sortOrder });
    return NextResponse.json({ id }, { status: 201 });
  } catch (err) {
    console.error("Admin tags POST error:", err);
    return errorResponse(err, "新增标签失败");
  }
}

export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json() as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "标签 ID 无效" }, { status: 400 });
    }
    const tags = await getTags();
    const current = tags.find((tag) => tag.id === id);
    if (!current) return NextResponse.json({ error: "标签不存在" }, { status: 404 });

    const parentId = body.parent_id === undefined
      ? current.parent_id
      : validateParent(tags, current.type, body.parent_id);
    if (parentId === undefined) {
      return NextResponse.json({ error: "请选择有效的一级分类" }, { status: 400 });
    }
    const name = body.name === undefined ? undefined : String(body.name).trim();
    if (name !== undefined && (!name || name.length > 50)) {
      return NextResponse.json({ error: "标签名称无效" }, { status: 400 });
    }
    const categoryOrder = parseOrder(body.category_order, current.category_order);
    const sortOrder = parseOrder(body.sort_order, current.sort_order);
    if (Number.isNaN(categoryOrder) || Number.isNaN(sortOrder)) {
      return NextResponse.json({ error: "排序值无效" }, { status: 400 });
    }
    await updateTag(id, { name, parent_id: parentId, category_order: categoryOrder, sort_order: sortOrder });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Admin tags PATCH error:", err);
    return errorResponse(err, "更新标签失败");
  }
}

/** 物理删除（#94：停用机制下线）；支持单个 { id } 与批量 { ids }，分类级联删除其下标签 */
export async function DELETE(request: NextRequest) {
  try {
    const body = await request.json() as { id?: unknown; ids?: unknown };
    const ids: number[] = [];
    if (Array.isArray(body.ids)) {
      for (const raw of body.ids) {
        const id = Number(raw);
        if (Number.isInteger(id) && id > 0) ids.push(id);
      }
    } else {
      const id = Number(body.id);
      if (Number.isInteger(id) && id > 0) ids.push(id);
    }
    if (ids.length === 0) {
      return NextResponse.json({ error: "标签 ID 无效" }, { status: 400 });
    }
    await deleteTags(ids);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Admin tags DELETE error:", err);
    return NextResponse.json({ error: "删除标签失败" }, { status: 500 });
  }
}
