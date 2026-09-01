"use client";

import dynamic from "next/dynamic";

const WordCloudCanvas = dynamic(() => import("@/components/WordCloudCanvas"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-[300px] bg-gray-50 dark:bg-gray-800/50 rounded-xl text-muted">
      加载中...
    </div>
  ),
});

export default WordCloudCanvas;
