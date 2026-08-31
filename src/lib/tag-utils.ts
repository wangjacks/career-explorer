import type { TagRow } from "./db";

/** 标签名称规范化：转字符串 + trim + 去空 + 去重（#94 文本直存后的入库前处理） */
export function normalizeTagNames(raw: unknown[]): string[] {
  return Array.from(
    new Set(raw.map((t) => String(t ?? "").trim()).filter((n) => n.length > 0))
  );
}

/** 从提交标签中提取自定义部分（不在预设二级标签内的名称） */
export function extractCustomTags(names: string[], allTags: TagRow[]): string[] {
  const preset = new Set(
    allTags.filter((t) => t.type === "tag").map((t) => t.name)
  );
  return names.filter((n) => !preset.has(n));
}

/** 构建标签 ID → 分类名的映射 */
export function buildTagCategoryMap(allTags: TagRow[]): Map<number, string> {
  const categories = new Map(
    allTags
      .filter((tag) => tag.type === "category")
      .map((tag) => [tag.id, tag.name])
  );
  return new Map(
    allTags
      .filter((tag) => tag.type === "tag")
      .map((tag) => [tag.id, categories.get(tag.parent_id ?? -1) || "自定义"])
  );
}
