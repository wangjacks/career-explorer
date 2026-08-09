import type { TagRow } from "./db";

/** 标签名称数组 → 标签 ID 数组（未知名称会被过滤） */
export function tagNamesToIds(names: string[], allTags: TagRow[]): number[] {
  const map = new Map(allTags.map((t) => [t.name, t.id]));
  return names
    .map((n) => map.get(n))
    .filter((id): id is number => id !== undefined);
}

/** 标签 ID 数组 → 标签名称数组（未知 ID 会被过滤） */
export function tagIdsToNames(ids: number[], allTags: TagRow[]): string[] {
  const map = new Map(allTags.map((t) => [t.id, t.name]));
  return ids
    .map((id) => map.get(id))
    .filter((n): n is string => n !== undefined);
}

/** 构建标签 ID → 分类名的映射 */
export function buildTagCategoryMap(allTags: TagRow[]): Map<number, string> {
  return new Map(allTags.map((t) => [t.id, t.category]));
}
