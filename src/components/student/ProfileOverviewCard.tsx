"use client";

import { useState } from "react";
import { useFileUrl } from "@/hooks/useFileUrl";
import { safeImageUrl } from "@/lib/sanitize";
import { toThumbnailUrl } from "@/lib/thumbnail-utils";
import { EVALUATION_COUNT } from "@/lib/evaluation-text";
import { profileCompletion } from "@/lib/profile-completion";
import { PROFILE_INFO_ID } from "@/lib/profile-summary";
import { TAG_CHIP_COLORS, type TagCategory } from "@/components/TagSelector";
import type { StudentProfile } from "@/types/student-profile";
import ProfileSectionHeader from "@/components/assessment/ProfileSectionHeader";
import EvaluationWordCloud from "@/components/EvaluationWordCloud";
import EvaluationTexts from "@/components/EvaluationTexts";

/**
 * 「我的档案资料」卡（#322）：标签（按分类三色、全量展示）+ 他人评价（#162 文字优先，
 * 历史图片兜底）+ 三项完成度 + 提交时间合并为一张卡，卡尾放主操作「修改数据」。
 */
export default function ProfileOverviewCard({
  profile,
  categories,
  evaluationUrl,
  submissionClosed,
  submissionDeadline,
  onEdit,
  onPreview,
  highlight = false,
}: {
  profile: StudentProfile;
  categories: TagCategory[];
  /** 词云原图地址（放大预览用；缩略图加载失败时回退原图） */
  evaluationUrl: string | null;
  submissionClosed: boolean;
  submissionDeadline: string | null;
  onEdit: () => void;
  onPreview: (url: string) => void;
  /** 被速览卡定位时短暂高亮（#323） */
  highlight?: boolean;
}) {
  // 词云缩略图（#118）：小图优先降低首屏体积；存量未补生成缩略图时回退原图（review 修复同 HistoryItem）
  const [thumbFailed, setThumbFailed] = useState(false);
  const thumbnailResolved = useFileUrl(
    profile.evaluation_url && !thumbFailed ? toThumbnailUrl(profile.evaluation_url) : profile.evaluation_url || undefined,
    profile.storage_id
  );
  const thumbnailPreview = safeImageUrl(thumbnailResolved);

  const groupedTags = categories.map((cat, catIdx) => ({
    name: cat.name,
    color: TAG_CHIP_COLORS[catIdx % TAG_CHIP_COLORS.length],
    tags: cat.tags.filter((t) => profile.tags.includes(t.name)).map((t) => t.name),
  }));
  const groupedNames = new Set(groupedTags.flatMap((group) => group.tags));
  const ungrouped = profile.tags.filter((tag) => !groupedNames.has(tag));
  const completion = profileCompletion(profile);
  const evaluationTexts = profile.evaluation_texts ?? [];
  const evaluationWords = profile.evaluation_words ?? [];
  const hasEvaluationText =
    evaluationTexts.filter((text) => text.trim()).length === EVALUATION_COUNT;

  return (
    <section
      id={PROFILE_INFO_ID}
      className={`bg-card rounded-xl border border-border-soft p-5 space-y-4 scroll-mt-24 transition-shadow duration-300 ${
        highlight ? "ring-2 ring-accent/70 shadow-lg" : ""
      }`}
    >
      <div className="flex flex-wrap items-center gap-2">
        <ProfileSectionHeader label="我的档案资料" />
        <span className="ml-auto text-xs text-muted">
          {profile.submitted_at ? `提交于 ${profile.submitted_at}` : "尚未提交"}
        </span>
      </div>

      {/* 三项完成度（#322）：与 hero 进度环同一口径，逐项标出已完成 / 未完成 */}
      <ul className="flex flex-wrap gap-2 text-xs" aria-label="资料完整度">
        {completion.map((item) => (
          <li
            key={item.label}
            className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 ${
              item.done
                ? "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
                : "bg-gray-100 text-muted dark:bg-gray-800"
            }`}
          >
            {item.label}
            <span aria-hidden>{item.done ? "✓" : "—"}</span>
            <span className="sr-only">{item.done ? "已完成" : "未完成"}</span>
          </li>
        ))}
      </ul>

      {/* 我的标签（按 API 分类分组三色） */}
      <div className="space-y-3">
        {profile.tags.length === 0 ? (
          <p className="text-sm text-muted">还没有标签，点「修改数据」补充。</p>
        ) : (
          groupedTags
            .filter((group) => group.tags.length > 0)
            .map((group) => (
              <div key={group.name}>
                <p className="mb-1.5 text-xs text-muted">{group.name}</p>
                <div className="flex flex-wrap gap-1.5">
                  {group.tags.map((tag) => (
                    <span key={tag} className={`rounded-full px-2.5 py-1 text-xs ${group.color}`}>
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            ))
        )}
        {ungrouped.length > 0 && (
          <div className="flex flex-wrap gap-1.5">
            {ungrouped.map((tag) => (
              <span key={tag} className={`rounded-full px-2.5 py-1 text-xs ${TAG_CHIP_COLORS[0]}`}>
                {tag}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* 他人评价与词云（#162）：文字优先，历史图片兜底 */}
      <div className="space-y-2">
        <p className="text-xs font-medium text-foreground">他人评价与词云</p>
        {hasEvaluationText ? (
          <div className="space-y-3">
            <EvaluationWordCloud
              words={evaluationWords}
              height={280}
              emptyText="暂无可提取的关键词"
            />
            <EvaluationTexts texts={evaluationTexts} />
            {thumbnailPreview && (
              <details>
                <summary className="cursor-pointer select-none text-xs text-muted hover:text-foreground">
                  查看历史评价图片
                </summary>
                <button
                  type="button"
                  onClick={() => onPreview(evaluationUrl || thumbnailPreview)}
                  aria-label="放大历史评价词云图片"
                  className="mt-2 block w-full max-w-xs cursor-zoom-in rounded-lg border border-border-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                >
                  <img
                    src={thumbnailPreview}
                    alt="历史评价词云图片"
                    onError={() => setThumbFailed(true)}
                    className="w-full rounded-lg"
                  />
                </button>
              </details>
            )}
          </div>
        ) : thumbnailPreview ? (
          <div className="space-y-2">
            <button
              type="button"
              onClick={() => onPreview(evaluationUrl || thumbnailPreview)}
              aria-label="放大历史评价词云图片"
              className="block w-full max-w-xs cursor-zoom-in rounded-lg border border-border-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            >
              <img
                src={thumbnailPreview}
                alt="历史评价词云图片"
                onError={() => setThumbFailed(true)}
                className="w-full rounded-lg"
              />
            </button>
            <p className="text-xs text-muted">
              这是你此前上传的历史图片。填写三条他人评价后，将改为自动生成的词云。
            </p>
          </div>
        ) : (
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-sm text-muted">还没有他人评价。</p>
            <button
              type="button"
              onClick={onEdit}
              disabled={submissionClosed}
              className="text-sm font-medium text-primary-strong underline underline-offset-2 hover:no-underline disabled:opacity-50"
            >
              补充评价
            </button>
          </div>
        )}
      </div>

      <button
        type="button"
        onClick={onEdit}
        disabled={submissionClosed}
        className="w-full rounded-xl bg-primary py-3 font-medium text-white transition-colors hover:bg-primary-strong disabled:opacity-50 sm:w-auto sm:px-6"
      >
        修改数据
      </button>
      {submissionClosed && (
        <p className="text-xs text-warning-text">
          {submissionDeadline ? `档案提交已于 ${submissionDeadline} 截止，无法再修改` : "档案提交已截止，无法再修改"}
        </p>
      )}
    </section>
  );
}
