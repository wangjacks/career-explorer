/**
 * 图片缩略图工具（#118）：
 * - key 派生：原 key + `_thumb` 后缀（DB 零字段，由原 key 推算）
 * - 生成：头像 120×120 居中裁剪 / 词云长边 240px，JPEG 质量 80
 * - URL 换算：兼容本地代理路径（/api/uploads/...）与裸 key，查询参数原样保留
 * 纯函数 + 纯 sharp 管道，便于单元测试。
 */
import sharp from "sharp";

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

/**
 * 生成缩略图：
 * - 头像：120×120 居中裁剪（fit: cover，sharp 默认居中）
 * - 词云：长边 240px（fit: inside 保持宽高比，不放大）
 * 输出 JPEG 质量 80。
 */
export async function createThumbnail(buffer: Buffer, prefix: "avatar" | "evaluation"): Promise<Buffer> {
  if (prefix === "avatar") {
    return sharp(buffer)
      .resize({ width: AVATAR_THUMB_SIZE, height: AVATAR_THUMB_SIZE, fit: "cover" })
      .jpeg({ quality: THUMB_JPEG_QUALITY })
      .toBuffer();
  }
  return sharp(buffer)
    .resize({ width: EVALUATION_THUMB_WIDTH, height: EVALUATION_THUMB_WIDTH, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: THUMB_JPEG_QUALITY })
    .toBuffer();
}
