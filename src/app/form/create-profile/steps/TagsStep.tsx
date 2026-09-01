"use client";

import { useEffect, useState } from "react";
import { toast } from "sonner";
import TagSelector, { type TagCategory } from "@/components/TagSelector";
import type { UseProfileDraftResult } from "@/hooks/useProfileDraft";

interface TagsStepProps {
  draft: UseProfileDraftResult;
  studentName: string;
  onBack: () => void;
  onNext: () => void;
}

/** 第二步 · 标签选择（实时写入草稿） */
export default function TagsStep({ draft, studentName, onBack, onNext }: TagsStepProps) {
  const [categories, setCategories] = useState<TagCategory[]>([]);
  const [maxCustomTags, setMaxCustomTags] = useState<number | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const loadTags = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/tags");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取标签失败");
      setCategories(data.categories || []);
      setMaxCustomTags(typeof data.maxCustomTags === "number" ? data.maxCustomTags : undefined);
      setFailed(false);
    } catch (err) {
      console.error("Failed to load tags:", err);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- load dynamic tags on step entry */
  useEffect(() => {
    loadTags();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleNext = () => {
    if (draft.tags.length === 0) {
      toast.warning("请至少选择一个标签");
      return;
    }
    onNext();
  };

  return (
    <>
      <main className="flex-1 px-4 py-6 space-y-6 max-w-lg sm:max-w-xl md:max-w-2xl mx-auto w-full">
        <div className="text-center text-sm text-gray-600 dark:text-gray-300">
          你好，<span className="font-semibold text-foreground">{studentName}</span>
          同学！请选择你的兴趣 / 技能 / 性格标签
        </div>

        {loading && <p className="text-center py-8 text-gray-400 dark:text-gray-500">标签加载中...</p>}
        {failed && (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-red-500">标签加载失败</p>
            <button
              onClick={loadTags}
              className="px-4 py-1.5 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg"
            >
              重试
            </button>
          </div>
        )}
        {!loading && !failed && (
          <TagSelector
            categories={categories}
            selectedTags={draft.tags}
            onToggle={draft.toggleTag}
            onRemove={draft.toggleTag}
            maxCustomTags={maxCustomTags}
          />
        )}
      </main>

      <div className="sticky bottom-0 bg-card/80 backdrop-blur-md border-t border-border-soft p-4">
        <div className="max-w-lg sm:max-w-xl md:max-w-2xl mx-auto flex gap-3">
          <button
            onClick={onBack}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-xl transition-colors"
          >
            上一步
          </button>
          <button
            onClick={handleNext}
            className="flex-1 py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
          >
            下一步
          </button>
        </div>
      </div>
    </>
  );
}
