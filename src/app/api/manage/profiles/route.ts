import { NextRequest, NextResponse } from "next/server";
import { getSubmittedProfiles, getTags, clearSubmissions } from "@/lib/db";
import { tagIdsToNames } from "@/lib/tag-utils";

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const page = parseInt(searchParams.get("page") || "1", 10);
    const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

    const { rows, total } = await getSubmittedProfiles(page, pageSize);
    const allTags = await getTags();

    return NextResponse.json({
      data: rows.map((r) => {
        let ids: number[] = [];
        try {
          ids = r.tags ? (JSON.parse(r.tags) as number[]) : [];
        } catch {}
        return {
          studentId: r.user_code,
          studentName: r.name,
          tags: tagIdsToNames(ids, allTags),
          avatarUrl: r.avatar_url,
          evaluationUrl: r.evaluation_url,
          createdAt: r.submitted_at,
        };
      }),
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("Profiles GET error:", err);
    return NextResponse.json({ error: "获取档案列表失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的记录" }, { status: 400 });
    }
    const deleted = await clearSubmissions(ids);
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 条记录` });
  } catch (err) {
    console.error("Profiles DELETE error:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
