/**
 * 媒体扫描与孤儿检测（#117）：服务端纯逻辑。
 * 反向检测法：先构建「被引用 key 集合」（getAllReferencedMedia，users 当前档案 + profile_submissions 快照，
 * 引用值经 extractKey 规范化），再按后端枚举存储文件（listObjects），不在集合中即为孤儿。
 * - 多后端分组：每个后端枚举自己的文件，引用集合按 storageId 过滤，互不串扰
 * - 缩略图为派生附属（#118）：参与列表与统计，但引用状态/孤儿判定**跟随源 key**（源图被引用则缩略图
 *   为「使用中」，源图孤儿则缩略图同孤儿）；删除时由 cleanup 在源图删除时连带删除，不可独立清理
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

/** 媒体文件条目（#117 全量列表）：含引用状态与关联学生 */
export interface MediaFileItem {
  key: string;
  storageId: number;
  size: number;
  lastModified: string;
  type: "avatar" | "evaluation" | "thumbnail" | "other";
  /** 是否被任何档案/历史版本引用 */
  referenced: boolean;
  /** 关联学生（被引用时；同一文件多行引用取其一） */
  userCode: string | null;
  userName: string | null;
  /** 缩略图文件的源 key；非缩略图为 null */
  sourceKey: string | null;
  orphanDays: number;
  /** orphanDays >= retentionDays 才允许清理（仅孤儿有意义） */
  deletable: boolean;
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

/** 全量扫描：统计 + 全量文件列表（含引用状态/关联学生）+ 孤儿子集；文件按 lastModified 降序 */
export async function scanMedia(): Promise<{
  status: MediaScanResult;
  files: MediaFileItem[];
  orphans: OrphanItem[];
}> {
  // 1. 引用集合（反向检测）：storageId:key 规范化后去重，携带关联学生
  const refs = await getAllReferencedMedia();
  const referenced = new Set<string>();
  const ownerById = new Map<string, { userCode: string; userName: string }>();
  for (const ref of refs) {
    const key = extractKey(ref.url);
    if (!key) continue;
    const id = `${ref.storageId}:${key}`;
    referenced.add(id);
    if (!ownerById.has(id) && (ref.userCode || ref.userName)) {
      ownerById.set(id, { userCode: ref.userCode ?? "", userName: ref.userName ?? "" });
    }
  }

  // 2. 按后端枚举文件
  const backends = await listStorageBackends();
  const retentionDays = await getMediaOrphanRetentionDays();
  const now = Date.now();
  const files: MediaFileItem[] = [];
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
      const id = `${backend.id}:${obj.key}`;
      // 缩略图状态跟随源图：引用判定用源 key（源图被引用 → 缩略图「使用中」）
      const effectiveId = isThumbnailKey(obj.key) ? `${backend.id}:${getSourceKey(obj.key)}` : id;
      const isReferenced = referenced.has(effectiveId);
      const owner = ownerById.get(effectiveId);
      total += 1;
      totalSize += obj.size;

      const orphanDays = isReferenced
        ? 0
        : Math.floor((now - new Date(obj.lastModified).getTime()) / DAY_MS);
      const deletable = !isReferenced && orphanDays >= retentionDays;
      if (!isReferenced) {
        orphanCount += 1;
        orphanSize += obj.size;
        if (deletable) {
          deletableCount += 1;
          deletableSize += obj.size;
        }
      }
      files.push({
        key: obj.key,
        storageId: backend.id,
        size: obj.size,
        lastModified: obj.lastModified,
        type: typeOf(obj.key),
        referenced: isReferenced,
        userCode: owner?.userCode ?? null,
        userName: owner?.userName ?? null,
        sourceKey: isThumbnailKey(obj.key) ? getSourceKey(obj.key) : null,
        orphanDays,
        deletable,
      });
    }
  }

  // 文件按最近修改降序（管理视角：最新在前）；孤儿子集按孤儿时长降序（清理视角：最老优先）
  files.sort(
    (a, b) =>
      b.lastModified.localeCompare(a.lastModified) ||
      (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
  );
  const orphans = files
    .filter((f) => !f.referenced)
    .sort((a, b) => b.orphanDays - a.orphanDays || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));
  return {
    status: { total, totalSize, orphanCount, orphanSize, deletableCount, deletableSize, retentionDays },
    files,
    orphans,
  };
}
