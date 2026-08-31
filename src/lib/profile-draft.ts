/**
 * 档案创建表单草稿（localStorage 持久化）的纯逻辑部分，便于单元测试。
 * 图片 File 本身不可序列化，仅持久化「已选」元数据；刷新后需在对应步骤重新选择图片。
 */

export const DRAFT_TAGS_KEY = "career_draft_tags";
export const DRAFT_META_KEY = "career_draft_meta";

export interface DraftMeta {
  /** 已选评价词云图片（File 在内存，刷新后需重选） */
  evaluation?: boolean;
  /** 已选虚拟形象图片（同上） */
  avatar?: boolean;
}

export function parseJsonOrNull<T>(raw: string | null): T | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** 是否存在有意义的草稿（标签或任一图片已选） */
export function hasMeaningfulDraft(tags: string[], meta: DraftMeta | null): boolean {
  return tags.length > 0 || !!meta?.evaluation || !!meta?.avatar;
}

/** 标签切换（勾选/取消勾选） */
export function toggleTag(current: string[], tag: string): string[] {
  return current.includes(tag) ? current.filter((t) => t !== tag) : [...current, tag];
}
