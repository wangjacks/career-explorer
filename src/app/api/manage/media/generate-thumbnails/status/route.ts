import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { scanThumbnailStatus } from "@/lib/thumbnail-backfill";

/**
 * 缩略图缺失检测（#118）：只读扫描被引用文件，统计已有/缺失缩略图（面板展示，不写入）。仅 admin。
 */
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

    const status = await scanThumbnailStatus();
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    console.error("Thumbnail status error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
