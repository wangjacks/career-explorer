"use client";

import WordCloudClient from "@/components/WordCloudClient";

interface WordcloudStepProps {
  tags: string[];
  onBack: () => void;
  onNext: () => void;
}

/** 第三步 · 词云展示（基于已选标签） */
export default function WordcloudStep({ tags, onBack, onNext }: WordcloudStepProps) {
  return (
    <>
      <main className="flex-1 px-4 py-6 space-y-6 max-w-lg sm:max-w-xl md:max-w-2xl mx-auto w-full">
        <div className="text-center space-y-1">
          <p className="text-sm text-muted">共选择了 {tags.length} 个标签</p>
        </div>

        <WordCloudClient words={tags} />

        <p className="text-xs text-muted text-center">
          以下是基于你的标签生成的词云
        </p>
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
            onClick={onNext}
            className="flex-1 py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
          >
            下一步
          </button>
        </div>
      </div>
    </>
  );
}
