import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { scanMedia } from "@/lib/media-scan";

/** 孤儿文件分页明细（#117）：仅 admin；按 orphanDays 降序（scanMedia 已排序） */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid || result.uid == null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (result.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const page = Number(request.nextUrl.searchParams.get("page") ?? 1);
    const pageSize = Number(request.nextUrl.searchParams.get("pageSize") ?? 20);
    if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
      return NextResponse.json({ error: "分页参数无效" }, { status: 400 });
    }

    const { status, orphans } = await scanMedia();
    const start = (page - 1) * pageSize;
    return NextResponse.json({
      ok: true,
      items: orphans.slice(start, start + pageSize),
      total: orphans.length,
      page,
      pageSize,
      retentionDays: status.retentionDays,
    });
  } catch (err) {
    console.error("Media orphans error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
