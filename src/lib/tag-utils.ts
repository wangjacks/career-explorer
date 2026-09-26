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

/** 构建标签名称 → 分类名的映射（#94 名称直存后的统计路径使用） */
export function buildTagCategoryMapByName(allTags: TagRow[]): Map<string, string> {
  const idToCategoryName = new Map(
    allTags.filter((tag) => tag.type === "category").map((tag) => [tag.id, tag.name])
  );
  return new Map(
    allTags
      .filter((tag) => tag.type === "tag")
      .map((tag) => [tag.name, idToCategoryName.get(tag.parent_id ?? -1) || "自定义"])
  );
}

// ---- 标签管理多选与批量操作（#163）----

/** 标签管理页所需的标签最小形状（兼容 TagRow 与页面内 TagItem） */
export interface TagLike {
  id: number;
  name: string;
  type: "category" | "tag";
  parent_id: number | null;
  category_order?: number;
  sort_order?: number;
}

/** 已选统计：分类数 / 二级标签数 / 实际影响行数（已不存在的 id 不计入） */
export interface SelectionSummary {
  categories: number;
  tags: number;
  affected: number;
}

export function summarizeSelection(
  selected: ReadonlySet<number>,
  allTags: TagLike[]
): SelectionSummary {
  const existing = new Map(allTags.map((tag) => [tag.id, tag]));
  let categories = 0;
  let tags = 0;
  let affected = 0;
  for (const id of selected) {
    const tag = existing.get(id);
    if (!tag) continue;
    affected += 1;
    if (tag.type === "category") categories += 1;
    else tags += 1;
  }
  return { categories, tags, affected };
}

/**
 * 勾选/取消一级分类：勾选时级联包含其下全部二级标签（#163 选中语义），
 * 取消时一并移除，保证「选中集合 == 实际删除集合」。
 */
export function toggleCategorySelection(
  selected: ReadonlySet<number>,
  categoryId: number,
  childIds: number[]
): Set<number> {
  const next = new Set(selected);
  const allSelected = next.has(categoryId) && childIds.every((id) => next.has(id));
  if (allSelected) {
    next.delete(categoryId);
    childIds.forEach((id) => next.delete(id));
  } else {
    next.add(categoryId);
    childIds.forEach((id) => next.add(id));
  }
  return next;
}

/**
 * 勾选/取消单个二级标签。取消子标签时若其父分类已被选中，则同时取消父分类，
 * 避免「父分类仍选中」导致删除范围大于用户预期。
 */
export function toggleTagSelection(
  selected: ReadonlySet<number>,
  tagId: number,
  parentId: number | null
): Set<number> {
  const next = new Set(selected);
  if (next.has(tagId)) {
    next.delete(tagId);
    if (parentId != null) next.delete(parentId);
  } else {
    next.add(tagId);
  }
  return next;
}

/** 批量导入预览行：标注「将新建分类 / 已存在（跳过）」，供导入前核对影响面 */
export interface TagImportPreviewRow {
  category: string;
  name: string;
  /** 该分类当前不存在，导入时会自动创建 */
  createsCategory: boolean;
  /** 分类 + 标签名已存在，或批次内重复，导入时会被跳过 */
  skips: boolean;
}

export interface TagImportPreview {
  rows: TagImportPreviewRow[];
  importCount: number;
  skipCount: number;
  newCategoryCount: number;
}

/**
 * 导入影响面预览：复刻服务端 `POST /api/manage/tags/batch` 的去重口径
 * （分类按名称匹配；标签按「分类 id + 名称」去重；批次内重复同样跳过）。
 */
export function previewTagImport(
  items: { category: string; name: string }[],
  existingTags: TagLike[]
): TagImportPreview {
  const categoryIdByName = new Map(
    existingTags.filter((t) => t.type === "category").map((t) => [t.name, t.id])
  );
  const existingTagKeys = new Set(
    existingTags.filter((t) => t.type === "tag").map((t) => `${t.parent_id}:${t.name}`)
  );

  const rows: TagImportPreviewRow[] = [];
  const createdCategoryNames = new Map<string, number>();
  let virtualId = -1;
  let importCount = 0;
  let skipCount = 0;

  for (const item of items) {
    let categoryId = categoryIdByName.get(item.category);
    let createsCategory = false;
    if (categoryId === undefined) {
      categoryId = createdCategoryNames.get(item.category) ?? virtualId--;
      if (!createdCategoryNames.has(item.category)) {
        createdCategoryNames.set(item.category, categoryId);
        createsCategory = true;
      }
    }

    const key = `${categoryId}:${item.name}`;
    const skips = existingTagKeys.has(key);
    if (skips) {
      skipCount += 1;
    } else {
      existingTagKeys.add(key);
      importCount += 1;
    }
    rows.push({ category: item.category, name: item.name, createsCategory, skips });
  }

  return {
    rows,
    importCount,
    skipCount,
    newCategoryCount: createdCategoryNames.size,
  };
}

/** 导出数据：Sheet1 与导入格式一致（分类,标签名，可直接回导）；Sheet2 含空分类便于人工核对 */
export interface TagExportRows {
  pairs: string[][];
  categories: string[][];
}

export function buildTagExportRows(allTags: TagLike[]): TagExportRows {
  const categories = allTags
    .filter((tag) => tag.type === "category")
    .sort((a, b) => (a.category_order ?? 0) - (b.category_order ?? 0) || a.id - b.id);
  const pairs: string[][] = [];
  for (const category of categories) {
    const children = allTags
      .filter((tag) => tag.type === "tag" && tag.parent_id === category.id)
      .sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || a.id - b.id);
    for (const child of children) {
      pairs.push([category.name, child.name]);
    }
  }
  return { pairs, categories: categories.map((category) => [category.name]) };
}
