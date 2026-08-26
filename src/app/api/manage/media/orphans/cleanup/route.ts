import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { getStorage } from "@/lib/storage";
import { scanMedia } from "@/lib/media-scan";
import { getThumbnailKey } from "@/lib/thumbnail-utils";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

const MAX_ITEMS = 500;

/**
 * 批量删除孤儿文件（#117）：仅 admin。
 * 安全链（服务端全部重新校验，不信任前端）：
 * 1. 重新扫描（scanMedia 内置引用重查 + 保留期校验），仅接受当前仍「孤儿且可删」的文件
 * 2. 删除源图时连带 `_thumb` 缩略图（不存在静默）
 * 3. 审计记统计不记全量 key（防 metadata 截断）
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
      const { ip: fip, user_agent: fua } = getRequestContext(request);
      const faction = await getAuditActor(request);
      void recordAudit({
        ...faction, action: "media:cleanup", method: "POST", path: request.nextUrl.pathname,
        resource_type: "media", resource_id: null,
        status: "failed", error_message: "越权访问", ip: fip, user_agent: fua, metadata: null,
      });
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as { items?: unknown };
    if (!Array.isArray(body.items) || body.items.length === 0 || body.items.length > MAX_ITEMS) {
      const { ip: bip, user_agent: bua } = getRequestContext(request);
      const bactor = await getAuditActor(request);
      void recordAudit({
        ...bactor, action: "media:cleanup", method: "POST", path: request.nextUrl.pathname,
        resource_type: "media", resource_id: null,
        status: "failed", error_message: "items 参数非法", ip: bip, user_agent: bua, metadata: null,
      });
      return NextResponse.json({ error: `items 须为 1-${MAX_ITEMS} 条` }, { status: 400 });
    }

    // 重新扫描：以服务端实时结果为准（防前端伪造 key/时间/引用状态）
    const { orphans } = await scanMedia();
    const orphanById = new Map(orphans.map((o) => [`${o.storageId}:${o.key}`, o]));

    let deleted = 0;
    let skipped = 0;
    let deletedSizeBytes = 0;
    const deletedKeys: string[] = [];
    for (const raw of body.items as { key?: unknown; storageId?: unknown }[]) {
      const key = String(raw.key ?? "").split("?")[0];
      const storageId = Number(raw.storageId);
      if (!key || !Number.isInteger(storageId) || storageId <= 0) {
        skipped += 1;
        continue;
      }
      const orphan = orphanById.get(`${storageId}:${key}`);
      // 非孤儿、未到期、或后端不符 → 跳过（保留期/引用在扫描时已实时校验）
      if (!orphan || !orphan.deletable) {
        skipped += 1;
        continue;
      }
      const storage = await getStorage(storageId);
      await storage.delete(key);
      deleted += 1;
      deletedSizeBytes += orphan.size;
      deletedKeys.push(key);
      // 源图连带缩略图：直接 delete（对不存在静默成功），保证源图删除时缩略图必被清理（无 exists 竞态窗口）
      if (orphan.type !== "thumbnail") {
        const thumbKey = getThumbnailKey(key);
        if (thumbKey !== key) {
          await storage.delete(thumbKey);
        }
      }
    }

    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor, action: "media:cleanup", method: "POST", path: "/api/manage/media/orphans/cleanup",
      resource_type: "media", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      // 明细含被删 key 列表（sanitizeMetadata 截断保护，不记全量时仍可追溯）
      metadata: { deleted, skipped, deletedSizeBytes, deletedKeys },
    });
    return NextResponse.json({ ok: true, deleted, skipped, deletedSizeBytes });
  } catch (err) {
    console.error("Media cleanup error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
