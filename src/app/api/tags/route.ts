import { NextResponse } from "next/server";
import { getActiveTags, getMaxCustomTags } from "@/lib/db";

/** 开放端点：表单/学生面板拉取预设标签 + 自定义标签上限（#94） */
export async function GET() {
  try {
    const tags = await getActiveTags();
    const maxCustomTags = await getMaxCustomTags();
    const categories = tags
      .filter((tag) => tag.type === "category")
      .map((category) => ({
        id: category.id,
        name: category.name,
        sortOrder: category.category_order,
        tags: tags
          .filter((tag) => tag.type === "tag" && tag.parent_id === category.id)
          .map((tag) => ({ id: tag.id, name: tag.name, sortOrder: tag.sort_order })),
      }));
    return NextResponse.json({ categories, maxCustomTags });
  } catch (err) {
    console.error("Public tags GET error:", err);
    return NextResponse.json({ error: "获取标签失败" }, { status: 500 });
  }
}
