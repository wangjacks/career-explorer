"use client";

import { useState } from "react";
import { useFileUrl } from "@/hooks/useFileUrl";
import { safeImageUrl } from "@/lib/sanitize";
import { toThumbnailUrl } from "@/lib/thumbnail-utils";
import { EVALUATION_COUNT } from "@/lib/evaluation-text";
import { TAG_CHIP_COLORS } from "@/components/TagSelector";
import ProfileSectionHeader from "@/components/assessment/ProfileSectionHeader";
import EvaluationWordCloud from "@/components/EvaluationWordCloud";
import EvaluationTexts from "@/components/EvaluationTexts";
import type { SubmissionHistoryItem } from "@/types/student-profile";

/** 历史版本条目（#95）：版本号 + 时间 + 当前标记 + 快照详情（标签/头像/评价/词云）+ 恢复按钮 */
function HistoryItem({
  submission,
  restoring,
  closed,
  tagColorMap,
  onRestore,
}: {
  submission: SubmissionHistoryItem;
  restoring: boolean;
  closed: boolean;
  /** 标签三色映射（#95）：与「我的标签」展示态一致，未匹配分类的标签兜底第一种颜色 */
  tagColorMap: Map<string, string>;
  onRestore: (id: number) => void;
}) {
  // 历史文件 URL 解析（#111）：与主档案同规则，云后端换签名 URL；小图场景走 _thumb 缩略图（#118），
  // 缩略图加载失败（存量未补生成）时回退原图（review 修复）
  const [avatarThumbFailed, setAvatarThumbFailed] = useState(false);
  const [evaluationThumbFailed, setEvaluationThumbFailed] = useState(false);
  const avatarResolved = useFileUrl(
    submission.avatar_url && !avatarThumbFailed ? toThumbnailUrl(submission.avatar_url) : submission.avatar_url || undefined,
    submission.storage_id
  );
  const evaluationResolved = useFileUrl(
    submission.evaluation_url && !evaluationThumbFailed
      ? toThumbnailUrl(submission.evaluation_url)
      : submission.evaluation_url || undefined,
    submission.storage_id
  );
  const avatarPreview = safeImageUrl(avatarResolved);
  const evaluationPreview = safeImageUrl(evaluationResolved);
  const evaluationTexts = submission.evaluation_texts ?? [];
  const evaluationWords = submission.evaluation_words ?? [];
  const hasEvaluationText =
    evaluationTexts.filter((text) => text.trim()).length === EVALUATION_COUNT;

  return (
    <li className="border border-border-soft rounded-lg p-3 space-y-2">
      <div className="flex items-center gap-2 flex-wrap">
        <span className="text-sm font-semibold text-foreground">版本 {submission.version}</span>
        {submission.is_current === 1 ? (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400">
            当前版本
          </span>
        ) : (
          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-500 dark:bg-gray-800 dark:text-gray-400">
            历史版本
          </span>
        )}
        <span className="ml-auto text-xs text-muted">{submission.submitted_at}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {submission.tags.length === 0 ? (
          <span className="text-xs text-muted">暂无标签</span>
        ) : (
          submission.tags.map((tag) => (
            <span key={tag} className={`px-2.5 py-1 rounded-full text-xs ${tagColorMap.get(tag) ?? TAG_CHIP_COLORS[0]}`}>
              {tag}
            </span>
          ))
        )}
      </div>
      {(avatarPreview || (!hasEvaluationText && evaluationPreview)) && (
        <div className="flex gap-2">
          {avatarPreview && (
            <img
              src={avatarPreview}
              alt={`版本 ${submission.version} 头像`}
              onError={() => setAvatarThumbFailed(true)}
              className="w-12 h-12 rounded-lg object-cover border border-border-soft"
            />
          )}
          {!hasEvaluationText && evaluationPreview && (
            <img
              src={evaluationPreview}
              alt={`版本 ${submission.version} 历史评价词云图片`}
              onError={() => setEvaluationThumbFailed(true)}
              className="h-12 w-20 rounded-lg object-cover border border-border-soft"
            />
          )}
        </div>
      )}
      {hasEvaluationText && (
        <div className="space-y-2">
          <EvaluationWordCloud
            words={evaluationWords}
            height={120}
            emptyText="暂无可提取的关键词"
          />
          <EvaluationTexts texts={evaluationTexts} />
          {evaluationPreview && (
            <details>
              <summary className="cursor-pointer select-none text-xs text-muted hover:text-foreground">
                查看此版本的历史图片
              </summary>
              <img
                src={evaluationPreview}
                alt={`版本 ${submission.version} 历史评价词云图片`}
                onError={() => setEvaluationThumbFailed(true)}
                className="mt-2 h-16 w-28 rounded-lg object-cover border border-border-soft"
              />
            </details>
          )}
        </div>
      )}
      {!closed && submission.is_current === 0 && (
        <button
          onClick={() => onRestore(submission.id)}
          disabled={restoring}
          className="px-3 py-1.5 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-xs font-medium rounded-lg transition-colors"
        >
          {restoring ? "恢复中..." : "恢复此版本"}
        </button>
      )}
    </li>
  );
}

/** 历史提交列表（#95 / #361）：路由页只负责取数与恢复动作，列表展示收在这里 */
export default function HistoryList({
  submissions,
  loading,
  restoringId,
  closed,
  tagColorMap,
  onRestore,
}: {
  submissions: SubmissionHistoryItem[];
  loading: boolean;
  restoringId: number | null;
  closed: boolean;
  tagColorMap: Map<string, string>;
  onRestore: (id: number) => void;
}) {
  return (
    <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
      <ProfileSectionHeader label="历史提交" />
      {loading ? (
        <p className="text-sm text-muted">加载中...</p>
      ) : submissions.length === 0 ? (
        <p className="text-sm text-muted">暂无历史提交</p>
      ) : (
        <ul className="space-y-2">
          {submissions.map((submission) => (
            <HistoryItem
              key={submission.id}
              submission={submission}
              restoring={restoringId === submission.id}
              closed={closed}
              tagColorMap={tagColorMap}
              onRestore={onRestore}
            />
          ))}
        </ul>
      )}
    </section>
  );
}
