"use client";

import { useEffect, useState } from "react";

/**
 * 文件访问地址解析（#111，私有读写模式）：
 * - 本地后端（或无后端信息）：原样返回代理路径，行为与现版本完全一致
 * - 云后端：向 `/api/shared/storage-sign` 换取 30 分钟签名 URL，
 *   模块级内存缓存（到期前 2 分钟视为失效，避免频繁签发）
 *
 * 注意：签名请求携带 Cookie 会话，端点会校验文件归属（本人/管辖班级/管理员）。
 */

interface CacheEntry {
  url: string;
  expiresAt: number;
}

/** 签名 URL 缓存：按文件引用键缓存；28 分钟视为失效（签名 30 分钟，提前 2 分钟刷新） */
const signCache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 28 * 60 * 1000;

export function useFileUrl(url: string | null | undefined, storageId?: number | null): string {
  const [resolved, setResolved] = useState<string>(() => {
    // 首帧同步返回可用值：本地路径或缓存命中，避免图片闪烁
    if (!url) return "";
    if (!storageId || url.startsWith("/api/uploads/")) return url;
    return signCache.get(url)?.url ?? "";
  });

  /* eslint-disable react-hooks/set-state-in-effect -- 本地路径/缓存命中分支需同步解析，避免图片首帧闪烁 */
  useEffect(() => {
    if (!url) {
      setResolved("");
      return;
    }
    // 本地模式或无后端信息：原样使用
    if (!storageId || url.startsWith("/api/uploads/")) {
      setResolved(url);
      return;
    }
    // 缓存命中且未临近过期：直接使用
    const cached = signCache.get(url);
    if (cached && cached.expiresAt > Date.now()) {
      setResolved(cached.url);
      return;
    }
    /* eslint-enable react-hooks/set-state-in-effect */
    let cancelled = false;
    fetch(`/api/shared/storage-sign?url=${encodeURIComponent(url)}`, { credentials: "include" })
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("签发失败"))))
      .then((data) => {
        if (cancelled) return;
        if (typeof data.url === "string" && data.url) {
          signCache.set(url, { url: data.url, expiresAt: Date.now() + CACHE_TTL_MS });
          setResolved(data.url);
        }
      })
      .catch((err) => {
        console.error("File URL sign failed:", err);
        if (!cancelled) setResolved("");
      });
    return () => {
      cancelled = true;
    };
  }, [url, storageId]);

  return resolved;
}
