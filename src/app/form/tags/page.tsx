"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import NavigationBar from "@/components/NavigationBar";
import QuickModeBanner from "@/components/QuickModeBanner";
import TagSelector, { type TagCategory } from "@/components/TagSelector";
import FormSteps from "@/components/FormSteps";

interface StudentInfo {
  studentId: string;
  name: string;
}

export default function TagsPage() {
  const router = useRouter();
  const [selectedTags, setSelectedTags] = useState<string[]>([]);
  const [categories, setCategories] = useState<TagCategory[]>([]);
  const [loadingTags, setLoadingTags] = useState(true);
  const [tagsError, setTagsError] = useState(false);
  const [student, setStudent] = useState<StudentInfo | null>(null);

  // 挂载后读取已选标签与学生信息（避免 SSR/prerender 访问 localStorage）
  /* eslint-disable react-hooks/set-state-in-effect -- load persisted state on mount */
  useEffect(() => {
    const storedTags = localStorage.getItem("career_demo_tags");
    setSelectedTags(storedTags ? JSON.parse(storedTags) : []);
    const storedStudent = localStorage.getItem("career_demo_student");
    setStudent(storedStudent ? JSON.parse(storedStudent) : null);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const loadTags = async () => {
    setLoadingTags(true);
    try {
      const res = await fetch("/api/tags");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "获取标签失败");
      setCategories(data.categories || []);
      setTagsError(false);
    } catch (err) {
      console.error("Failed to load tags:", err);
      setTagsError(true);
    } finally {
      setLoadingTags(false);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- load dynamic tags on page entry */
  useEffect(() => {
    loadTags();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag];
      localStorage.setItem("career_demo_tags", JSON.stringify(next));
      return next;
    });
  };

  const removeTag = (tag: string) => {
    const next = selectedTags.filter((t) => t !== tag);
    setSelectedTags(next);
    localStorage.setItem("career_demo_tags", JSON.stringify(next));
  };

  const handleNext = () => {
    if (selectedTags.length === 0) {
      toast.warning("请至少选择一个标签");
      return;
    }
    router.push("/form/wordcloud");
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title="标签填写" showBack />
      <QuickModeBanner />
      <div className="pt-5">
        <FormSteps current={2} />
      </div>
      <main className="flex-1 px-4 py-6 space-y-6 max-w-lg sm:max-w-xl md:max-w-2xl mx-auto w-full">
        {student && (
          <div className="text-center text-sm text-gray-600 dark:text-gray-300">
            你好，<span className="font-semibold text-gray-800 dark:text-gray-100">{student.name}</span>同学！
          </div>
        )}

        {loadingTags && <p className="text-center py-8 text-gray-400 dark:text-gray-500">标签加载中...</p>}
        {tagsError && (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-red-500">标签加载失败</p>
            <button onClick={loadTags} className="px-4 py-1.5 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg">重试</button>
          </div>
        )}
        {!loadingTags && !tagsError && (
          <TagSelector
            categories={categories}
            selectedTags={selectedTags}
            onToggle={toggleTag}
            onRemove={removeTag}
          />
        )}

      </main>

      <div className="sticky bottom-0 bg-card/80 backdrop-blur-md border-t border-gray-100 dark:border-gray-700 p-4">
        <button
          onClick={handleNext}
          className="w-full max-w-lg sm:max-w-xl md:max-w-2xl mx-auto block py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
        >
          下一步
        </button>
      </div>
    </div>
  );
}
