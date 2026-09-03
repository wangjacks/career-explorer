import { NextResponse } from "next/server";
import { getAllSubmitted, getTags } from "@/lib/db";
import { buildTagCategoryMap, buildTagCategoryMapByName } from "@/lib/tag-utils";

export async function GET() {
  try {
    const rows = await getAllSubmitted();
    const allTags = await getTags();
    const idToCategory = buildTagCategoryMap(allTags);
    const nameToCategory = buildTagCategoryMapByName(allTags);

    const categoryCount: Record<string, number> = {};
    for (const row of rows) {
      if (!row.tags) continue;
      let entries: (string | number)[] = [];
      try {
        entries = JSON.parse(row.tags) as (string | number)[];
      } catch {
        continue;
      }
      for (const entry of entries) {
        const category =
          typeof entry === "string"
            ? nameToCategory.get(entry) || "自定义"
            : idToCategory.get(entry) || "自定义";
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
