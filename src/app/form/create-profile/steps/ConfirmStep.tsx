"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { toast } from "sonner";
import { submitProfile } from "@/lib/profile-submit";
import type { UseProfileDraftResult } from "@/hooks/useProfileDraft";

interface ConfirmProfile {
  user_code: string;
  avatar_url: string;
  evaluation_url: string;
  submitted_at: string | null;
}

interface ConfirmStepProps {
  draft: UseProfileDraftResult;
  studentName: string;
  onBack: () => void;
  onSubmitted: () => void;
}

/**
 * 第六步 · 最终确认：核验全部信息后才真正上传与保存。
 * 档案信息挂载时从会话接口自行获取，不依赖容器内存态（中途刷新后直接进入本步也可用）。
 */
export default function ConfirmStep({ draft, studentName, onBack, onSubmitted }: ConfirmStepProps) {
  const [profile, setProfile] = useState<ConfirmProfile | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [progress, setProgress] = useState("");

  const loadProfile = async () => {
    setLoadFailed(false);
    try {
      const res = await fetch("/api/shared/profile");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "档案信息加载失败");
      setProfile({
        user_code: data.user_code,
        avatar_url: data.avatar_url || "",
        evaluation_url: data.evaluation_url || "",
        submitted_at: data.submitted_at,
      });
    } catch (err) {
      console.error("Confirm step profile load failed:", err);
      setLoadFailed(true);
    }
  };

  /* eslint-disable react-hooks/set-state-in-effect -- load session profile on step entry */
  useEffect(() => {
    loadProfile();
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleSubmit = async () => {
    if (!profile) return;
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

        {!profile && !loadFailed && (
          <p className="text-center py-8 text-gray-400 dark:text-gray-500">档案信息加载中...</p>
        )}

        {loadFailed && (
          <div className="text-center py-8 space-y-2">
            <p className="text-sm text-red-500">档案信息加载失败</p>
            <button
              onClick={loadProfile}
              className="px-4 py-1.5 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg"
            >
              重试
            </button>
          </div>
        )}

        {profile && profile.submitted_at && (
          <div className="text-center py-8 space-y-3">
            <p className="text-sm text-gray-600 dark:text-gray-300">你已提交过档案，如需修改请前往学生面板</p>
            <Link
              href="/dashboard/student"
              className="inline-block px-6 py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
            >
              前往学生面板
            </Link>
          </div>
        )}

        {profile && !profile.submitted_at && (
          <>
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
          </>
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
            disabled={submitting || !profile || !!profile.submitted_at || loadFailed}
            className="flex-[2] py-3 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
          >
            {submitting ? progress || "提交中..." : "确认提交"}
          </button>
        </div>
      </div>
    </>
  );
}
