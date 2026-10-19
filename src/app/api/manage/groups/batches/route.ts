import { NextRequest, NextResponse } from "next/server";
import { getGroupBatches } from "@/lib/db";

/** GET：某班的历史批次列表（新→旧）。读不限班级，与当前分组一致 */
export async function GET(request: NextRequest) {
  try {
    const classId = Number(request.nextUrl.searchParams.get("classId"));
    if (!Number.isInteger(classId) || classId <= 0) {
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }
    const batches = await getGroupBatches(classId);
    return NextResponse.json({
      data: batches.map((b) => ({
        id: b.id,
        classId: b.class_id,
        strategy: b.strategy,
        groupSize: b.group_size,
        studentCount: b.student_count,
        taggedCount: b.tagged_count,
        createdAt: b.created_at,
        createdByName: b.created_by_name,
        metrics: b.metrics,
      })),
    });
  } catch (err) {
    console.error("Group batches GET error:", err);
    return NextResponse.json({ error: "获取历史分组失败" }, { status: 500 });
  }
}
