import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { runThumbnailBackfill } from "@/lib/thumbnail-backfill";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 存量缩略图补生成（#118）：扫描全部被引用文件（users 当前档案 + profile_submissions 历史快照），
 * 为缺少缩略图的文件补生成（key 按 `_thumb` 后缀派生）。仅 admin。
 * 单文件失败不中断整体，返回统计供面板展示。
 */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
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

    const { total, generated, skipped, failed } = await runThumbnailBackfill();

    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor, action: "media:thumbnail-backfill", method: "POST", path: "/api/manage/media/generate-thumbnails",
      resource_type: "media", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { total, generated, skipped, failed },
    });
    return NextResponse.json({ ok: true, total, generated, skipped, failed });
  } catch (err) {
    console.error("Thumbnail backfill error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
