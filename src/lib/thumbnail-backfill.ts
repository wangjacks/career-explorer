/**
 * 缩略图存量维护（#118）：检测与补生成共享逻辑（服务端）。
 * - scanThumbnailStatus：只读扫描，统计被引用文件与缩略图缺失情况（面板「检测」）
 * - runThumbnailBackfill：补生成缺失缩略图（面板「生成」/ 原迁移端点）
 * 单文件失败不中断整体；同一文件被多行引用时按 后端+key 去重。
 */
import { getAllReferencedMedia } from "./db";
import { getStorage } from "./storage";
import { createThumbnail } from "./thumbnail";
import { getThumbnailKey } from "./thumbnail-utils";

/** 从 DB 引用值提取对象 key：本地代理路径剥前缀，云值裸 key；去查询参数 */
export function extractKey(url: string): string | null {
  const base = url.split("?")[0];
  const key = base.startsWith("/api/uploads/") ? base.slice("/api/uploads/".length) : base;
  return key || null;
}

/** 按 key 前缀推断资源类型（generateObjectKey 固定 avatar_ / evaluation_ 前缀） */
export function prefixOf(key: string): "avatar" | "evaluation" {
  return key.startsWith("avatar_") ? "avatar" : "evaluation";
}

/** 枚举全部被引用文件并去重，返回对象 key 列表（含后端归属） */
async function collectKeys(): Promise<{ key: string; storageId: number }[]> {
  const refs = await getAllReferencedMedia();
  const seen = new Set<string>();
  const keys: { key: string; storageId: number }[] = [];
  for (const ref of refs) {
    const key = extractKey(ref.url);
    if (!key) continue;
    const dedupeId = `${ref.storageId}:${key}`;
    if (seen.has(dedupeId)) continue;
    seen.add(dedupeId);
    // 非 .jpg 无缩略图派生规则，不计入维护范围
    if (getThumbnailKey(key) === key) continue;
    keys.push({ key, storageId: ref.storageId });
  }
  return keys;
}

/** 只读检测：被引用文件总数 / 已有缩略图数 / 缺失数（面板展示，不写入） */
export async function scanThumbnailStatus(): Promise<{ total: number; existing: number; missing: number }> {
  const keys = await collectKeys();
  let existing = 0;
  let missing = 0;
  for (const { key, storageId } of keys) {
    try {
      const storage = await getStorage(storageId);
      if (await storage.exists(getThumbnailKey(key))) existing += 1;
      else missing += 1;
    } catch (err) {
      console.error(`Thumbnail status check failed for ${key}:`, err);
      missing += 1;
    }
  }
  return { total: keys.length, existing, missing };
}

/** 补生成缺失缩略图，返回统计（检测期间已存在的跳过） */
export async function runThumbnailBackfill(): Promise<{
  total: number;
  generated: number;
  skipped: number;
  failed: number;
}> {
  const keys = await collectKeys();
  let generated = 0;
  let skipped = 0;
  let failed = 0;
  for (const { key, storageId } of keys) {
    const thumbKey = getThumbnailKey(key);
    try {
      const storage = await getStorage(storageId);
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
  return { total: keys.length, generated, skipped, failed };
}
