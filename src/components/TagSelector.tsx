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

/** 标签选择器：分类多选网格 + 已选标签 chips（form 流程与学生面板共用） */
export default function TagSelector({ categories, selectedTags, onToggle, onRemove }: TagSelectorProps) {
  return (
    <>
      {categories.map((category) => (
        <section key={category.id} className="space-y-3">
          <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{category.name}</h2>
          <div className="flex flex-wrap gap-2">
            {category.tags.map((tag) => (
              <button
                key={tag.id}
                onClick={() => onToggle(tag.name)}
                className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                  selectedTags.includes(tag.name)
                    ? "bg-green-500 text-white shadow-sm"
                    : "bg-white text-gray-700 border border-gray-200 hover:border-green-300"
                }`}
              >
                {tag.name}
              </button>
            ))}
          </div>
        </section>
      ))}

      {selectedTags.length > 0 && (
        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500">
            已选标签（{selectedTags.length}）
          </h2>
          <div className="flex flex-wrap gap-2">
            {selectedTags.map((tag) => (
              <span
                key={tag}
                className="inline-flex items-center gap-1 px-3 py-1 bg-green-50 text-green-700 rounded-full text-sm"
              >
                {tag}
                <button
                  onClick={() => onRemove(tag)}
                  className="ml-1 hover:text-green-900"
                >
                  ×
                </button>
              </span>
            ))}
          </div>
        </section>
      )}
    </>
  );
}
