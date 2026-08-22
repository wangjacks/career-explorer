import { NextRequest, NextResponse } from "next/server";
import { getTags, insertTag } from "@/lib/db";

const MAX_NAME_LENGTH = 50;

/**
 * 标签批量导入（#94）：`{ items: [{ category, name }] }`。
 * 分类不存在时自动创建；「分类+标签名」已存在则跳过；返回导入/跳过计数。
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0) {
      return NextResponse.json({ error: "没有可导入的标签" }, { status: 400 });
    }

    // 规范化并校验
    const items: { category: string; name: string }[] = [];
    for (const raw of body.items) {
      const entry = raw as Record<string, unknown>;
      const category = String(entry?.category ?? "").trim();
      const name = String(entry?.name ?? "").trim();
      if (!category || !name) continue;
      if (category.length > MAX_NAME_LENGTH || name.length > MAX_NAME_LENGTH) {
        return NextResponse.json({ error: `分类与标签名不能超过 ${MAX_NAME_LENGTH} 字` }, { status: 400 });
      }
      items.push({ category, name });
    }
    if (items.length === 0) {
      return NextResponse.json({ error: "没有可导入的标签" }, { status: 400 });
    }

    const tags = await getTags();
    // 全局（class_id=0）分类：名称 → 行
    const categoryByName = new Map(
      tags.filter((t) => t.type === "category" && t.class_id === 0).map((t) => [t.name, t])
    );
    // 全局二级标签：`${parent_id}:${name}` 去重键
    const existingTagKeys = new Set(
      tags.filter((t) => t.type === "tag" && t.class_id === 0).map((t) => `${t.parent_id}:${t.name}`)
    );

    let imported = 0;
    let skipped = 0;
    let nextCategoryOrder = Math.max(0, ...Array.from(categoryByName.values()).map((c) => c.category_order + 1));

    for (const item of items) {
      let category = categoryByName.get(item.category);
      if (!category) {
        const categoryId = await insertTag({
          name: item.category,
          type: "category",
          parent_id: null,
          category_order: nextCategoryOrder,
          sort_order: 0,
        });
        nextCategoryOrder += 1;
        category = {
          id: categoryId,
          name: item.category,
          type: "category",
          parent_id: null,
          class_id: 0,
          category_order: nextCategoryOrder - 1,
          sort_order: 0,
          active: 1,
        };
        categoryByName.set(item.category, category);
      }

      const key = `${category.id}:${item.name}`;
      if (existingTagKeys.has(key)) {
        skipped += 1;
        continue;
      }
      const siblingCount = tags.filter((t) => t.type === "tag" && t.parent_id === category!.id).length;
      await insertTag({
        name: item.name,
        type: "tag",
        parent_id: category.id,
        category_order: category.category_order,
        sort_order: siblingCount,
      });
      existingTagKeys.add(key);
      imported += 1;
    }

    return NextResponse.json({ ok: true, imported, skipped });
  } catch (err) {
    const duplicate = err instanceof Error && /unique|duplicate/i.test(err.message);
    console.error("Admin tags batch POST error:", err);
    return NextResponse.json(
      { error: duplicate ? "标签名称已存在" : "批量导入失败" },
      { status: duplicate ? 409 : 500 }
    );
  }
}
