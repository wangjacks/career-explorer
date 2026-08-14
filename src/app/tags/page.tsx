"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import NavigationBar from "@/components/NavigationBar";
import { tagCategories } from "@/lib/tagData";

interface StudentInfo {
  studentId: string;
  name: string;
}

export default function TagsPage() {
  const router = useRouter();
  const [selectedTags, setSelectedTags] = useState<string[]>(() => {
    const stored = localStorage.getItem("career_demo_tags");
    return stored ? JSON.parse(stored) : [];
  });
  const [customInput, setCustomInput] = useState(() => localStorage.getItem("career_demo_custom_input") || "");
  const [student] = useState<StudentInfo | null>(() => {
    const stored = localStorage.getItem("career_demo_student");
    return stored ? JSON.parse(stored) : null;
  });

  const toggleTag = (tag: string) => {
    setSelectedTags((prev) => {
      const next = prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag];
      localStorage.setItem("career_demo_tags", JSON.stringify(next));
      return next;
    });
  };

  const updateCustomInput = (value: string) => {
    setCustomInput(value);
    localStorage.setItem("career_demo_custom_input", value);
  };

  const addCustomTag = () => {
    const trimmed = customInput.trim();
    if (!trimmed) return;
    if (selectedTags.includes(trimmed)) {
      toast.warning("该标签已存在");
      return;
    }
    const next = [...selectedTags, trimmed];
    setSelectedTags(next);
    localStorage.setItem("career_demo_tags", JSON.stringify(next));
    setCustomInput("");
    localStorage.removeItem("career_demo_custom_input");
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
    router.push("/wordcloud");
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Toaster position="top-center" />
      <NavigationBar title="标签填写" showBack />
      <main className="flex-1 px-4 py-6 space-y-6 max-w-lg sm:max-w-xl md:max-w-2xl mx-auto w-full">
        {student && (
          <div className="text-center text-sm text-gray-600">
            你好，<span className="font-semibold text-gray-800">{student.name}</span>同学！
          </div>
        )}

        {tagCategories.map((category) => (
          <section key={category.name} className="space-y-3">
            <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">
              {category.name}
            </h2>
            <div className="flex flex-wrap gap-2">
              {category.tags.map((tag) => (
                <button
                  key={tag}
                  onClick={() => toggleTag(tag)}
                  className={`px-4 py-2 rounded-full text-sm font-medium transition-all ${
                    selectedTags.includes(tag)
                      ? "bg-green-500 text-white shadow-sm"
                      : "bg-white text-gray-700 border border-gray-200 hover:border-green-300"
                  }`}
                >
                  {tag}
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
                    onClick={() => removeTag(tag)}
                    className="ml-1 hover:text-green-900"
                  >
                    ×
                  </button>
                </span>
              ))}
            </div>
          </section>
        )}

        <section className="space-y-2">
          <h2 className="text-sm font-semibold text-gray-500">自定义标签</h2>
          <div className="flex gap-2">
            <input
              type="text"
              value={customInput}
              onChange={(e) => updateCustomInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && addCustomTag()}
              placeholder="输入自定义标签..."
              className="flex-1 px-4 py-2 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent"
            />
            <button
              onClick={addCustomTag}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 rounded-xl text-sm font-medium transition-colors"
            >
              添加
            </button>
          </div>
        </section>
      </main>

      <div className="sticky bottom-0 bg-white/80 backdrop-blur-md border-t border-gray-100 p-4">
        <button
          onClick={handleNext}
          className="w-full max-w-lg sm:max-w-xl md:max-w-2xl mx-auto block py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
        >
          下一步
        </button>
      </div>
    </div>
  );
}
