import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { getStorage } from "@/lib/storage";
import { scanMedia, type OrphanItem } from "@/lib/media-scan";
import { getThumbnailKey } from "@/lib/thumbnail-utils";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

const MAX_ITEMS = 500;

/** 逐个删除孤儿（含源图连带缩略图，delete 幂等静默）；返回统计与明细 */
async function performDelete(targets: OrphanItem[]): Promise<{
  deleted: number;
  skipped: number;
  deletedSizeBytes: number;
  deletedKeys: string[];
}> {
  let deleted = 0;
  const skipped = 0;
  let deletedSizeBytes = 0;
  const deletedKeys: string[] = [];
  for (const orphan of targets) {
    const storage = await getStorage(orphan.storageId);
    await storage.delete(orphan.key);
    deleted += 1;
    deletedSizeBytes += orphan.size;
    deletedKeys.push(orphan.key);
    // 源图连带缩略图：直接 delete（对不存在静默成功），保证源图删除时缩略图必被清理（无 exists 竞态窗口）
    if (orphan.type !== "thumbnail") {
      const thumbKey = getThumbnailKey(orphan.key);
      if (thumbKey !== orphan.key) {
        await storage.delete(thumbKey);
      }
    }
  }
  return { deleted, skipped, deletedSizeBytes, deletedKeys };
}

/**
 * 批量删除孤儿文件（#117）：仅 admin。
 * 两种模式：
 * - body { items: { key, storageId }[] }（≤500）：按清单删除（服务端重扫自证：引用重查 + 保留期校验）
 * - body { mode: "all" }：删除全部可删孤儿（500 人规模一键清理入口）
 * 安全链（服务端全部重新校验，不信任前端）；审计记统计与明细（sanitizeMetadata 截断保护）。
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

    const body = (await request.json()) as { items?: unknown; mode?: unknown };
    if (body.items === undefined && body.mode !== "all") {
      const { ip: bip, user_agent: bua } = getRequestContext(request);
      const bactor = await getAuditActor(request);
      void recordAudit({
        ...bactor, action: "media:cleanup", method: "POST", path: request.nextUrl.pathname,
        resource_type: "media", resource_id: null,
        status: "failed", error_message: "缺少 items 或 mode 参数", ip: bip, user_agent: bua, metadata: null,
      });
      return NextResponse.json({ error: "缺少 items 或 mode 参数" }, { status: 400 });
    }
    const mode = body.mode === "all" ? "all" : "items";
    // items 参数前置校验（避免无效请求触发全量扫描）
    let items: { key?: unknown; storageId?: unknown }[] | null = null;
    if (mode === "items") {
      items = body.items as { key?: unknown; storageId?: unknown }[];
      if (items.length === 0 || items.length > MAX_ITEMS) {
        const { ip: bip, user_agent: bua } = getRequestContext(request);
        const bactor = await getAuditActor(request);
        void recordAudit({
          ...bactor, action: "media:cleanup", method: "POST", path: request.nextUrl.pathname,
          resource_type: "media", resource_id: null,
          status: "failed", error_message: "items 参数非法", ip: bip, user_agent: bua, metadata: null,
        });
        return NextResponse.json({ error: `items 须为 1-${MAX_ITEMS} 条` }, { status: 400 });
      }
    }

    // 重新扫描：以服务端实时结果为准（防前端伪造 key/时间/引用状态）
    const { orphans } = await scanMedia();
    let targets: OrphanItem[];
    let skipped = 0;

    if (mode === "all") {
      // 全部可删模式：服务端直接选取（当前仍孤儿且超保留期）
      targets = orphans.filter((o) => o.deletable);
    } else {
      const orphanById = new Map(orphans.map((o) => [`${o.storageId}:${o.key}`, o]));
      targets = [];
      for (const raw of items!) {
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
        targets.push(orphan);
      }
    }

    const { deleted, deletedSizeBytes, deletedKeys } = await performDelete(targets);

    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor, action: "media:cleanup", method: "POST", path: "/api/manage/media/orphans/cleanup",
      resource_type: "media", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      // 明细含被删 key 列表与模式（sanitizeMetadata 截断保护，不记全量时仍可追溯）
      metadata: { mode, deleted, skipped, deletedSizeBytes, deletedKeys },
    });
    return NextResponse.json({ ok: true, deleted, skipped, deletedSizeBytes });
  } catch (err) {
    console.error("Media cleanup error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
