/**
 * 校验 URL 是否安全（防止 XSS via javascript: 协议等）
 * 仅允许：相对路径（/uploads/...）或 http/https 协议
 */
export function isSafeImageUrl(url: string | null | undefined): boolean {
  if (!url) return false;
  // 允许相对路径和协议相对路径
  if (url.startsWith("/") || url.startsWith("//")) return true;
  // 仅允许 http/https
  if (/^https?:\/\//i.test(url)) return true;
  return false;
}

/**
 * 安全获取图片 URL，不安全时返回 null
 */
export function safeImageUrl(url: string | null | undefined): string | null {
  return isSafeImageUrl(url) ? url! : null;
}
