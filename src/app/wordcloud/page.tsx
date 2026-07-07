"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import NavigationBar from "@/components/NavigationBar";
import WordCloudClient from "@/components/WordCloudClient";

export default function WordcloudPage() {
  const router = useRouter();
  const [tags, setTags] = useState<string[]>([]);

  useEffect(() => {
    const stored = localStorage.getItem("career_demo_tags");
    if (stored) {
      setTags(JSON.parse(stored));
    }
  }, []);

  const handleNext = () => {
    router.push("/avatar");
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <NavigationBar title="词云展示" showBack />
      <main className="flex-1 px-4 py-6 space-y-6 max-w-lg mx-auto w-full">
        <div className="text-center space-y-1">
          <p className="text-sm text-gray-500">共选择了 {tags.length} 个标签</p>
        </div>

        <WordCloudClient words={tags} />

        <p className="text-xs text-gray-400 text-center">
          以下是基于你的标签生成的词云
        </p>
      </main>

      <div className="sticky bottom-0 bg-white/80 backdrop-blur-md border-t border-gray-100 p-4">
        <button
          onClick={handleNext}
          className="w-full max-w-lg mx-auto block py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
        >
          下一步
        </button>
      </div>
    </div>
  );
}
