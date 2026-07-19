import { NextRequest, NextResponse } from "next/server";
import { getAllProfiles, deleteProfiles } from "@/lib/db";

export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

  const { rows, total } = await getAllProfiles(page, pageSize);

  return NextResponse.json({
    data: rows.map((r) => ({
      studentId: r.student_id,
      studentName: r.studentName || "",
      tags: JSON.parse(r.tags),
      avatarUrl: r.avatar_url,
      evaluationUrl: r.evaluation_url,
      createdAt: r.created_at,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}

export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的记录" }, { status: 400 });
    }
    const deleted = await deleteProfiles(ids);
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 条记录` });
  } catch {
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
