"use client";

import { useFileUrl } from "@/hooks/useFileUrl";
import { toThumbnailUrl } from "@/lib/thumbnail";

/**
 * 存储感知图片（#111）：本地后端直接渲染代理路径；云后端自动换取签名 URL。
 * 用于列表/详情等循环渲染场景（Hook 不能在循环中使用，故封装为组件）。
 * thumbnail（#118）：true 时请求 `_thumb` 派生缩略图（列表/小图场景），详情页保持默认原图。
 */
export default function StorageImage({
  url,
  storageId,
  className,
  alt = "",
  thumbnail = false,
}: {
  url: string | null | undefined;
  storageId?: number | null;
  className?: string;
  alt?: string;
  /** #118：请求缩略图（key 按 `_thumb` 后缀派生，本地路径与查询参数自动兼容） */
  thumbnail?: boolean;
}) {
  const resolved = useFileUrl(thumbnail && url ? toThumbnailUrl(url) : url, storageId);
  if (!url || !resolved) return null;
  return <img src={resolved} alt={alt} className={className} />;
}
