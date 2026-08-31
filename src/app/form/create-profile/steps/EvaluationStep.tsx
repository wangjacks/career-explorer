"use client";

import { toast } from "sonner";
import ImageUploadBox from "@/components/ImageUploadBox";
import type { UseProfileDraftResult } from "@/hooks/useProfileDraft";

interface EvaluationStepProps {
  draft: UseProfileDraftResult;
  onBack: () => void;
  onNext: () => void;
}

/** 第四步 · 评价词云选图（延迟上传：只本地预览，确认页提交时才真正上传） */
export default function EvaluationStep({ draft, onBack, onNext }: EvaluationStepProps) {
  const handleNext = () => {
    if (!draft.evaluationFile && !draft.evaluationPreview) {
      toast.warning("请选择评价词云图片");
      return;
    }
    onNext();
  };

  return (
    <>
      <main className="flex-1 px-4 py-6 space-y-6 max-w-lg sm:max-w-xl md:max-w-2xl mx-auto w-full">
        <p className="text-sm text-gray-500 dark:text-gray-400 text-center">
          上传同学们对你的评价词云图片（选择后暂存本地，最终确认时才上传）
        </p>
        {/* 包裹层与上传框同宽（均为 max-w-xs），保证各断点下真正居中 */}
        <div className="w-full max-w-xs mx-auto">
          <ImageUploadBox
            initialUrl={draft.evaluationPreview ?? undefined}
            aspect="wide"
            emptyHint="点击选择评价词云图片"
            onFileSelected={draft.setEvaluationFile}
          />
        </div>
      </main>

      <div className="sticky bottom-0 bg-card/80 backdrop-blur-md border-t border-gray-100 dark:border-gray-700 p-4">
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
