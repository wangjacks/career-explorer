/**
 * 缩略图 key 派生与 URL 换算（#118）：
 * 纯函数、零依赖（不引入 sharp），可安全被客户端组件引用；
 * sharp 生成逻辑在 ./thumbnail.ts（仅服务端）引用本模块常量。
 */

export const THUMB_SUFFIX = "_thumb";
export const AVATAR_THUMB_SIZE = 120;
export const EVALUATION_THUMB_WIDTH = 240;
export const THUMB_JPEG_QUALITY = 80;

/** 原 key → 缩略图 key：`{base}.jpg` → `{base}_thumb.jpg`（仅 .jpg 结尾派生，其余原样返回） */
export function getThumbnailKey(key: string): string {
  return key.endsWith(".jpg") ? `${key.slice(0, -4)}${THUMB_SUFFIX}.jpg` : key;
}

/** 是否为缩略图 key（以 `_thumb.jpg` 结尾） */
export function isThumbnailKey(key: string): boolean {
  return key.endsWith(`${THUMB_SUFFIX}.jpg`);
}

/** 缩略图 key → 原 key；非缩略图 key 返回 null */
export function getSourceKey(key: string): string | null {
  if (!isThumbnailKey(key)) return null;
  return `${key.slice(0, -(THUMB_SUFFIX.length + 4))}.jpg`;
}

/** 前端展示换算：原图 URL → 缩略图 URL（兼容 `/api/uploads/` 代理路径与裸 key，查询参数原样保留） */
export function toThumbnailUrl(url: string): string {
  const [base, query] = url.split("?");
  const thumb = getThumbnailKey(base);
  return query ? `${thumb}?${query}` : thumb;
}
