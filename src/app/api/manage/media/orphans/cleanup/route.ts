import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { getAllReferencedMedia } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { scanMedia, type OrphanItem } from "@/lib/media-scan";
import { extractKey } from "@/lib/thumbnail-backfill";
import { getSourceKey, getThumbnailKey, isThumbnailKey } from "@/lib/thumbnail-utils";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

const MAX_ITEMS = 500;
/** 审计明细最多保留的 key 条数（CR P2-2）：防止 sanitizeMetadata 2000 字符截断产生非法 JSON */
const MAX_AUDIT_KEYS = 50;

/** 逐个删除孤儿（含源图连带缩略图，delete 幂等静默）；失败时把已删明细附加到错误对象供审计留痕 */
async function performDelete(targets: OrphanItem[]): Promise<{
  deleted: number;
  deletedSizeBytes: number;
  deletedKeys: string[];
}> {
  let deleted = 0;
  let deletedSizeBytes = 0;
  const deletedKeys: string[] = [];
  try {
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
  } catch (err) {
    throw Object.assign(err instanceof Error ? err : new Error(String(err)), {
      partial: { deleted, deletedSizeBytes, deletedKeys },
    });
  }
  return { deleted, deletedSizeBytes, deletedKeys };
}

/**
 * 批量删除孤儿文件（#117）：仅 admin。
 * 两种模式：
 * - body { items: { key, storageId }[] }（≤500）：按清单删除（服务端重扫自证：引用重查 + 保留期校验）
 * - body { mode: "all" }：删除全部可删孤儿（500 人规模一键清理入口）
 * 安全链（服务端全部重新校验，不信任前端）；审计记统计与明细（key 限条数保留 + truncated 标记）。
 */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  let mode: "all" | "items" | null = null;
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
    mode = body.mode === "all" ? "all" : "items";
    // items 参数前置校验（避免无效请求触发全量扫描）；非数组（对象/字符串）同样拒绝（CR P3-4）
    let items: { key?: unknown; storageId?: unknown }[] | null = null;
    if (mode === "items") {
      const rawItems = body.items;
      if (!Array.isArray(rawItems) || rawItems.length === 0 || rawItems.length > MAX_ITEMS) {
        const { ip: bip, user_agent: bua } = getRequestContext(request);
        const bactor = await getAuditActor(request);
        void recordAudit({
          ...bactor, action: "media:cleanup", method: "POST", path: request.nextUrl.pathname,
          resource_type: "media", resource_id: null,
          status: "failed", error_message: "items 参数非法", ip: bip, user_agent: bua, metadata: null,
        });
        return NextResponse.json({ error: `items 须为 1-${MAX_ITEMS} 条` }, { status: 400 });
      }
      items = rawItems as { key?: unknown; storageId?: unknown }[];
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
      const seenIds = new Set<string>();
      for (const raw of items!) {
        const key = String(raw.key ?? "").split("?")[0];
        const storageId = Number(raw.storageId);
        if (!key || !Number.isInteger(storageId) || storageId <= 0) {
          skipped += 1;
          continue;
        }
        const id = `${storageId}:${key}`;
        // 重复条目去重（CR P3-5）：同文件二次提交计 skipped，避免统计虚高
        if (seenIds.has(id)) {
          skipped += 1;
          continue;
        }
        seenIds.add(id);
        const orphan = orphanById.get(id);
        // 非孤儿、未到期、或后端不符 → 跳过（保留期/引用在扫描时已实时校验）
        if (!orphan || !orphan.deletable) {
          skipped += 1;
          continue;
        }
        targets.push(orphan);
      }
    }

    // 删除前引用复核（CR P2-3）：scanMedia 与逐条删除之间存在窗口，期间新提交可能引用待删 key；
    // 重新查引用集合过滤（纯 key 匹配，缩略图按源 key 判定），成本仅一次 DB 查询
    const refsNow = await getAllReferencedMedia();
    const refKeysNow = new Set<string>();
    for (const ref of refsNow) {
      const key = extractKey(ref.url);
      if (key) refKeysNow.add(key);
    }
    const before = targets.length;
    targets = targets.filter((t) => {
      const effectiveKey = isThumbnailKey(t.key) ? getSourceKey(t.key)! : t.key;
      return !refKeysNow.has(effectiveKey);
    });
    skipped += before - targets.length;

    const { deleted, deletedSizeBytes, deletedKeys } = await performDelete(targets);

    const actor = await getAuditActor(request);
    // 明细限条数保留 + truncated 标记（CR P2-2）：防止 sanitizeMetadata 2000 字符截断产生非法 JSON
    const truncated = deletedKeys.length > MAX_AUDIT_KEYS;
    const auditKeys = truncated ? deletedKeys.slice(0, MAX_AUDIT_KEYS) : deletedKeys;
    void recordAudit({
      ...actor, action: "media:cleanup", method: "POST", path: "/api/manage/media/orphans/cleanup",
      resource_type: "media", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { mode, deleted, skipped, deletedSizeBytes, deletedKeys: auditKeys, ...(truncated ? { truncated: true } : {}) },
    });
    return NextResponse.json({ ok: true, deleted, skipped, deletedSizeBytes });
  } catch (err) {
    console.error("Media cleanup error:", err);
    // 失败路径留痕（CR P2-1）：破坏性操作失败必须可追溯；已删明细随错误对象携带
    const actor = await getAuditActor(request);
    const partial = (err as { partial?: { deleted: number; deletedSizeBytes: number; deletedKeys: string[] } }).partial;
    void recordAudit({
      ...actor, action: "media:cleanup", method: "POST", path: "/api/manage/media/orphans/cleanup",
      resource_type: "media", resource_id: null,
      status: "failed", error_message: err instanceof Error ? err.message : "服务器错误", ip, user_agent,
      metadata: partial
        ? {
            mode, deleted: partial.deleted, deletedSizeBytes: partial.deletedSizeBytes,
            deletedKeys: partial.deletedKeys.slice(0, MAX_AUDIT_KEYS), error: err instanceof Error ? err.message : "服务器错误",
          }
        : null,
    });
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
