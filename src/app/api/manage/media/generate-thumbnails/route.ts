import { NextRequest, NextResponse } from "next/server";
import { getAllReferencedMedia } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { getStorage } from "@/lib/storage";
import { createThumbnail, getThumbnailKey } from "@/lib/thumbnail";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/** 从 DB 引用值提取对象 key：本地代理路径剥前缀，云值裸 key；去查询参数 */
function extractKey(url: string): string | null {
  const base = url.split("?")[0];
  const key = base.startsWith("/api/uploads/") ? base.slice("/api/uploads/".length) : base;
  return key || null;
}

/** 按 key 前缀推断资源类型（generateObjectKey 固定 avatar_ / evaluation_ 前缀） */
function prefixOf(key: string): "avatar" | "evaluation" {
  return key.startsWith("avatar_") ? "avatar" : "evaluation";
}

/**
 * 存量缩略图补生成（#118）：扫描全部被引用文件（users 当前档案 + profile_submissions 历史快照），
 * 为缺少缩略图的文件补生成（key 按 `_thumb` 后缀派生）。仅 admin。
 * 单文件失败不中断整体，返回统计供前端展示。
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

    const refs = await getAllReferencedMedia();
    const seen = new Set<string>();
    let total = 0;
    let generated = 0;
    let skipped = 0;
    let failed = 0;

    for (const ref of refs) {
      const key = extractKey(ref.url);
      if (!key) continue;
      // 同一文件可能被多行引用（如恢复版本），按 后端+key 去重
      const dedupeId = `${ref.storageId}:${key}`;
      if (seen.has(dedupeId)) continue;
      seen.add(dedupeId);

      const thumbKey = getThumbnailKey(key);
      if (thumbKey === key) continue; // 非 .jpg 无缩略图派生规则
      total += 1;
      try {
        const storage = await getStorage(ref.storageId);
        if (await storage.exists(thumbKey)) {
          skipped += 1;
          continue;
        }
        const buffer = await storage.read(key);
        const thumbBuffer = await createThumbnail(buffer, prefixOf(key));
        await storage.upload(thumbKey, thumbBuffer, "image/jpeg");
        generated += 1;
      } catch (err) {
        failed += 1;
        console.error(`Thumbnail backfill failed for ${key}:`, err);
      }
    }

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
