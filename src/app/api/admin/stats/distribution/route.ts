import { NextResponse } from "next/server";
import { getAllSubmitted, getTags } from "@/lib/db";
import { buildTagCategoryMap } from "@/lib/tag-utils";

export async function GET() {
  try {
    const rows = await getAllSubmitted();
    const allTags = await getTags();
    const idToCategory = buildTagCategoryMap(allTags);

    const categoryCount: Record<string, number> = {};
    for (const row of rows) {
      if (!row.tags) continue;
      let ids: number[] = [];
      try {
        ids = JSON.parse(row.tags) as number[];
      } catch {
        continue;
      }
      for (const id of ids) {
        const category = idToCategory.get(id) || "自定义";
        categoryCount[category] = (categoryCount[category] || 0) + 1;
      }
    }

    const result = Object.entries(categoryCount).map(([category, count]) => ({ category, count }));
    return NextResponse.json(result);
  } catch (err) {
    console.error("Stats distribution GET error:", err);
    return NextResponse.json({ error: "获取分布数据失败" }, { status: 500 });
  }
}
