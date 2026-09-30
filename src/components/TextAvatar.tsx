"use client";

import { useState } from "react";
import { useFileUrl } from "@/hooks/useFileUrl";
import { toThumbnailUrl } from "@/lib/thumbnail-utils";

const SIZES = {
  sm: "w-8 h-8 text-sm",
  md: "w-10 h-10 text-base",
  lg: "w-16 h-16 text-xl",
} as const;

/**
 * 单个地址的图片层。用 `key={url}` 挂载，实例只服务这一个地址：
 * `useFileUrl` 换地址后要等签名回来，共用实例会把上一个地址的结果当成当前结果。
 */
function ImageLayer({
  url,
  storageId,
  onFail,
}: {
  url: string;
  storageId?: number | null;
  onFail: () => void;
}) {
  const resolved = useFileUrl(url, storageId);
  if (!resolved) return null;
  return (
    <img
      src={resolved}
      alt=""
      className="absolute inset-0 w-full h-full object-cover"
      onError={onFail}
    />
  );
}

/**
 * 头像，取不到图时回落为姓名首字（#101）。
 * 没有直接复用 `StorageImage`：它在签名 URL 未回来时渲染 null、加载失败后留下破图，
 * 而分组界面里「教师看外班头像」按权限本就 403 —— 这两种情况都要显示首字，不能是空框或破图。
 */
export default function TextAvatar({
  name,
  avatarUrl,
  storageId,
  size = "md",
}: {
  name: string | null | undefined;
  avatarUrl?: string | null;
  storageId?: number | null;
  size?: keyof typeof SIZES;
}) {
  // 失败记录按头像地址归档：换头像 / 换人后旧记录自然失效（纯派生，不在渲染期改 state）
  const [failures, setFailures] = useState<{ forUrl: string; thumb: boolean; original: boolean } | null>(
    null
  );
  const key = avatarUrl ?? "";
  const failed = failures && failures.forUrl === key ? failures : { thumb: false, original: false };

  const hasThumbVariant = !!avatarUrl && toThumbnailUrl(avatarUrl) !== avatarUrl;
  // 先试 `_thumb`（#118），它失败再试原图；两张都失败就彻底回落，不再重试（否则两个坏地址互相踢皮球）
  const wantThumb = failed.thumb ? false : hasThumbVariant;
  const givenUp = failed.thumb ? failed.original : hasThumbVariant ? false : failed.original;
  const requested = avatarUrl && !givenUp ? (wantThumb ? toThumbnailUrl(avatarUrl) : avatarUrl) : null;

  const mark = (thumb: boolean) =>
    setFailures({ forUrl: key, thumb, original: thumb ? failed.original : true });

  return (
    <span
      className={`relative flex-shrink-0 overflow-hidden rounded-full border border-border-soft bg-background flex items-center justify-center font-semibold text-foreground ${SIZES[size]}`}
    >
      {/* 首字始终在底层：图片没解析出来（云后端签名中）或失败时露出的就是它 */}
      <span aria-hidden>{(name ?? "").slice(0, 1) || "?"}</span>
      {requested && (
        <ImageLayer
          key={requested}
          url={requested}
          storageId={storageId}
          onFail={() => mark(requested !== avatarUrl)}
        />
      )}
    </span>
  );
}
