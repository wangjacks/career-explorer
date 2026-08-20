"use client";

export interface TagCategory {
  id: number;
  name: string;
  sortOrder: number;
  tags: { id: number; name: string; sortOrder: number }[];
}

interface TagSelectorProps {
  categories: TagCategory[];
  selectedTags: string[];
  onToggle: (tag: string) => void;
  onRemove: (tag: string) => void;
}

/**
 * 标签三色系统（三维度色彩编码，>3 类循环取色）。
 * 色彩始终伴随文字标签，不依赖颜色单独传达（无障碍）。
 */
const TAG_COLORS = [
  {
    // 兴趣绿
    heading: "text-emerald-700 dark:text-emerald-400",
    selected: "bg-emerald-600 text-white shadow-sm",
    unselected: "bg-card text-foreground border border-gray-200 hover:border-emerald-400",
    chip: "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300",
    chipRemove: "hover:text-emerald-900 dark:hover:text-emerald-100",
  },
  {
    // 技能蓝
    heading: "text-sky-700 dark:text-sky-400",
    selected: "bg-sky-600 text-white shadow-sm",
    unselected: "bg-card text-foreground border border-gray-200 hover:border-sky-400",
    chip: "bg-sky-50 text-sky-700 dark:bg-sky-900/30 dark:text-sky-300",
    chipRemove: "hover:text-sky-900 dark:hover:text-sky-100",
  },
  {
    // 性格琥珀
    heading: "text-amber-700 dark:text-amber-400",
    selected: "bg-amber-500 text-white shadow-sm",
    unselected: "bg-card text-foreground border border-gray-200 hover:border-amber-400",
    chip: "bg-amber-50 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300",
    chipRemove: "hover:text-amber-900 dark:hover:text-amber-100",
  },
];

/** 标签选择器：分类多选网格 + 已选标签 chips（form 流程与学生面板共用） */
export default function TagSelector({ categories, selectedTags, onToggle, onRemove }: TagSelectorProps) {
  // 标签名 → 所属分类序号（用于已选 chips 取对应色）
  const tagCategoryIndex = new Map<string, number>();
  categories.forEach((category, idx) => {
    category.tags.forEach((tag) => tagCategoryIndex.set(tag.name, idx));
  });

  return (
    <>
      {categories.map((category, idx) => {
        const color = TAG_COLORS[idx % TAG_COLORS.length];
        return (
          <section key={category.id} className="space-y-3">
            <h2 className={`text-sm font-semibold uppercase tracking-wide ${color.heading}`}>{category.name}</h2>
            <div className="flex flex-wrap gap-2">
              {category.tags.map((tag) => {
                const isSelected = selectedTags.includes(tag.name);
                return (
                  <button
                    key={tag.id}
                    onClick={() => onToggle(tag.name)}
                    className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                      isSelected ? color.selected : color.unselected
                    }`}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          </section>
        );
      })}

      {selectedTags.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500 dark:text-gray-400">
            已选标签（{selectedTags.length}）
          </h2>
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((tag) => {
              const color = TAG_COLORS[(tagCategoryIndex.get(tag) ?? 0) % TAG_COLORS.length];
              return (
                <span
                  key={tag}
                  className={`inline-flex items-center gap-1 px-3 py-1 rounded-full text-sm ${color.chip}`}
                >
                  {tag}
                  <button
                    onClick={() => onRemove(tag)}
                    className={`ml-1 ${color.chipRemove}`}
                  >
                    ×
                  </button>
                </span>
              );
            })}
          </div>
        </section>
      )}
    </>
  );
}
