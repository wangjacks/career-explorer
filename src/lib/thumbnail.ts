/**
 * 图片缩略图生成（#118）：
 * 仅服务端使用（依赖 sharp，被客户端引用会破坏打包）；key 派生与 URL 换算见 ./thumbnail-utils。
 * - 头像：120×120 居中裁剪（fit: cover，sharp 默认居中）
 * - 词云：长边 240px（fit: inside 保持宽高比，不放大）
 * 输出 JPEG 质量 80。
 */
import sharp from "sharp";
import { AVATAR_THUMB_SIZE, EVALUATION_THUMB_WIDTH, THUMB_JPEG_QUALITY } from "./thumbnail-utils";

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
