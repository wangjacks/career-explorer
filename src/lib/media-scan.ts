/**
 * 媒体扫描与孤儿检测（#117）：服务端纯逻辑。
 * 反向检测法：先构建「被引用 key 集合」（getAllReferencedMedia，users 当前档案 + profile_submissions 快照，
 * 引用值经 extractKey 规范化），再按后端枚举存储文件（listObjects），不在集合中即为孤儿。
 * - 多后端分组：每个后端枚举自己的文件，引用集合按 storageId 过滤，互不串扰
 * - 缩略图派生：`*_thumb.jpg` 与源 key 同一判定（源孤儿 ⟺ 缩略图孤儿），sourceKey 供前端附属展示
 * - 保留期：孤儿超过可配置保留期（天）才可删，覆盖「上传→保存」宽限期
 */
import { getAllReferencedMedia, getMediaOrphanRetentionDays, listStorageBackends } from "./db";
import { getStorage } from "./storage";
import { extractKey } from "./thumbnail-backfill";
import { getSourceKey, isThumbnailKey } from "./thumbnail-utils";

export interface MediaScanResult {
  total: number;
  totalSize: number;
  orphanCount: number;
  orphanSize: number;
  deletableCount: number;
  deletableSize: number;
  retentionDays: number;
}

export interface OrphanItem {
  key: string;
  storageId: number;
  size: number;
  lastModified: string;
  type: "avatar" | "evaluation" | "thumbnail" | "other";
  /** 缩略图文件的源 key；非缩略图为 null */
  sourceKey: string | null;
  orphanDays: number;
  /** orphanDays >= retentionDays 才允许清理 */
  deletable: boolean;
}

/** 文件类型推断：按 key 前缀（generateObjectKey 固定 avatar_ / evaluation_）；旧格式遗留文件归 other */
function typeOf(key: string): OrphanItem["type"] {
  if (isThumbnailKey(key)) return "thumbnail";
  if (key.startsWith("avatar_")) return "avatar";
  if (key.startsWith("evaluation_")) return "evaluation";
  return "other";
}

const DAY_MS = 86400000;

/** 全量扫描：统计 + 孤儿明细（孤儿按 orphanDays 降序） */
export async function scanMedia(): Promise<{ status: MediaScanResult; orphans: OrphanItem[] }> {
  // 1. 引用集合（反向检测）：storageId:key 规范化后去重
  const refs = await getAllReferencedMedia();
  const referenced = new Set<string>();
  for (const ref of refs) {
    const key = extractKey(ref.url);
    if (key) referenced.add(`${ref.storageId}:${key}`);
  }

  // 2. 按后端枚举文件
  const backends = await listStorageBackends();
  const retentionDays = await getMediaOrphanRetentionDays();
  const now = Date.now();
  const orphans: OrphanItem[] = [];
  let total = 0;
  let totalSize = 0;
  let orphanCount = 0;
  let orphanSize = 0;
  let deletableCount = 0;
  let deletableSize = 0;

  for (const backend of backends) {
    const storage = await getStorage(backend.id);
    const objects = await storage.listObjects();
    for (const obj of objects) {
      total += 1;
      totalSize += obj.size;
      if (referenced.has(`${backend.id}:${obj.key}`)) continue; // 被引用（含当前档案与历史快照）

      const orphanDays = Math.floor((now - new Date(obj.lastModified).getTime()) / DAY_MS);
      const deletable = orphanDays >= retentionDays;
      orphanCount += 1;
      orphanSize += obj.size;
      if (deletable) {
        deletableCount += 1;
        deletableSize += obj.size;
      }
      orphans.push({
        key: obj.key,
        storageId: backend.id,
        size: obj.size,
        lastModified: obj.lastModified,
        type: typeOf(obj.key),
        sourceKey: isThumbnailKey(obj.key) ? getSourceKey(obj.key) : null,
        orphanDays,
        deletable,
      });
    }
  }

  orphans.sort((a, b) => b.orphanDays - a.orphanDays || a.key.localeCompare(b.key));
  return {
    status: { total, totalSize, orphanCount, orphanSize, deletableCount, deletableSize, retentionDays },
    orphans,
  };
}
