import { NextResponse } from "next/server";
import { getAllProfilesRaw } from "@/lib/db";
import { tagCategories } from "@/lib/tagData";

export async function GET() {
  try {
    const rows = await getAllProfilesRaw();

    // Build a map: tag → category name
    const tagToCategory: Record<string, string> = {};
    for (const cat of tagCategories) {
      for (const tag of cat.tags) {
        tagToCategory[tag] = cat.name;
      }
    }

    const categoryCount: Record<string, number> = {};
    for (const row of rows) {
      const tags: string[] = JSON.parse(row.tags);
      for (const tag of tags) {
        const category = tagToCategory[tag] || "自定义";
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
