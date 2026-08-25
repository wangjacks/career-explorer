"use client";

import { useFileUrl } from "@/hooks/useFileUrl";

/**
 * 存储感知图片（#111）：本地后端直接渲染代理路径；云后端自动换取签名 URL。
 * 用于列表/详情等循环渲染场景（Hook 不能在循环中使用，故封装为组件）。
 */
export default function StorageImage({
  url,
  storageId,
  className,
  alt = "",
}: {
  url: string | null | undefined;
  storageId?: number | null;
  className?: string;
  alt?: string;
}) {
  const resolved = useFileUrl(url, storageId);
  if (!url || !resolved) return null;
  return <img src={resolved} alt={alt} className={className} />;
}
