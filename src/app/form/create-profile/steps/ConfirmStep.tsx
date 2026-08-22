"use client";

import { useState } from "react";
import { toast } from "sonner";
import { submitProfile } from "@/lib/profile-submit";
import type { UseProfileDraftResult } from "@/hooks/useProfileDraft";
import type { ProfileInfo } from "./LoginGateStep";

interface ConfirmStepProps {
  draft: UseProfileDraftResult;
  studentName: string;
  profile: ProfileInfo;
  onBack: () => void;
  onSubmitted: () => void;
}

/** 第六步 · 最终确认：核验全部信息后才真正上传与保存 */
export default function ConfirmStep({ draft, studentName, profile, onBack, onSubmitted }: ConfirmStepProps) {
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      setProgress("正在上传评价词云与虚拟形象...");
      await submitProfile({
        studentId: profile.user_code,
        tags: draft.tags,
        avatarFile: draft.avatarFile,
        evaluationFile: draft.evaluationFile,
        existingAvatarUrl: profile.avatar_url,
        existingEvaluationUrl: profile.evaluation_url,
      });
      setProgress("保存档案...");
      toast.success("提交成功");
      onSubmitted();
    } catch (err) {
      console.error("Profile submit failed:", err);
      toast.error(err instanceof Error ? err.message : "提交失败，请重试");
    } finally {
      setSubmitting(false);
      setProgress("");
    }
  };

  const summaryRow = (label: string, value: string) => (
    <div className="flex justify-between text-sm">
      <span className="text-gray-500 dark:text-gray-400">{label}</span>
      <span className="font-medium text-gray-800 dark:text-gray-100">{value}</span>
    </div>
  );

  return (
    <>
      <main className="flex-1 px-4 py-6 space-y-6 max-w-lg sm:max-w-xl md:max-w-2xl mx-auto w-full">
        <div className="text-center space-y-1">
          <h2 className="text-lg font-bold text-gray-900 dark:text-gray-100">最终确认</h2>
          <p className="text-sm text-gray-500 dark:text-gray-400">请核验以下信息，提交后才会真正上传</p>
        </div>

        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
          {summaryRow("姓名", studentName)}
          {summaryRow("学号", profile.user_code)}
          {summaryRow("标签数量", `${draft.tags.length} 个`)}
          {summaryRow("评价词云", draft.evaluationFile ? "已选择（待上传）" : "未选择")}
          {summaryRow("虚拟形象", draft.avatarFile ? "已选择（待上传）" : "未选择")}
        </div>

        {(draft.evaluationPreview || draft.avatarPreview) && (
          <div className="grid grid-cols-2 gap-4">
            {draft.evaluationPreview && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2">评价词云预览</p>
                <img
                  src={draft.evaluationPreview}
                  alt="评价词云预览"
                  className="w-full rounded-xl border border-gray-100 dark:border-gray-700 object-contain max-h-48"
                />
              </div>
            )}
            {draft.avatarPreview && (
              <div>
                <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2">虚拟形象预览</p>
                <img
                  src={draft.avatarPreview}
                  alt="虚拟形象预览"
                  className="w-full rounded-xl border border-gray-100 dark:border-gray-700 object-cover max-h-48"
                />
              </div>
            )}
          </div>
        )}
      </main>

      <div className="sticky bottom-0 bg-card/80 backdrop-blur-md border-t border-gray-100 dark:border-gray-700 p-4">
        <div className="max-w-lg sm:max-w-xl md:max-w-2xl mx-auto flex gap-3">
          <button
            onClick={onBack}
            disabled={submitting}
            className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-gray-700 dark:text-gray-200 font-medium rounded-xl transition-colors disabled:opacity-50"
          >
            上一步
          </button>
          <button
            onClick={handleSubmit}
            disabled={submitting}
            className="flex-[2] py-3 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
          >
            {submitting ? progress || "提交中..." : "确认提交"}
          </button>
        </div>
      </div>
    </>
  );
}
