"use client";

import { useState } from "react";
import { Compass, SquarePen, X } from "lucide-react";
import { useFileUrl } from "@/hooks/useFileUrl";
import { safeImageUrl } from "@/lib/sanitize";
import type { AssessmentListItem } from "@/lib/assessment-list";
import { heroCompletionText } from "@/lib/profile-ui";
import { MAX_RESULT_VERSIONS } from "@/lib/assessment-flow";
import type { StudentProfile } from "@/types/student-profile";

/** 罗盘进度环（signature）：档案完成度 x/3，琥珀弧线随完成度填充 */
function ProgressRing({ completion }: { completion: number }) {
  const r = 34;
  const C = 2 * Math.PI * r;
  return (
    <div
      className="relative w-14 h-14 sm:w-20 sm:h-20 flex-shrink-0"
      role="img"
      aria-label={`档案完成度 ${completion}/3`}
    >
      <svg viewBox="0 0 80 80" className="w-full h-full -rotate-90">
        <circle cx="40" cy="40" r={r} stroke="rgba(255,255,255,0.18)" strokeWidth="6" fill="none" />
        <circle
          cx="40"
          cy="40"
          r={r}
          stroke="var(--color-accent)"
          strokeWidth="6"
          fill="none"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - completion / 3)}
          className="transition-[stroke-dashoffset] duration-700 ease-out"
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <Compass size={16} className="text-accent" aria-hidden />
        <span className="text-[10px] sm:text-xs font-semibold text-white mt-0.5">{completion}/3</span>
      </div>
    </div>
  );
}

/**
 * 学生面板 hero（#322 精简 / #361 抽成组件）：
 * 头像 + 身份 + 状态印章 + 完成度环 + 就地修改入口；历史 / 小组路由复用同一视觉。
 */
export default function StudentHero({
  profile,
  hasSubmitted,
  completion,
  latestAssessment,
  editing,
  submissionClosed,
  submissionDeadline,
  onEdit,
}: {
  profile: StudentProfile;
  hasSubmitted: boolean;
  completion: number;
  /** 最近一次完成的量表；历史 / 小组页不额外拉测评数据，传 undefined */
  latestAssessment?: AssessmentListItem | null;
  editing: boolean;
  submissionClosed: boolean;
  submissionDeadline: string | null;
  onEdit: () => void;
}) {
  const avatarResolved = useFileUrl(profile.avatar_url, profile.storage_id);
  const avatarPreview = safeImageUrl(avatarResolved);
  // 头像放大由 hero 自己管理：档案 / 历史 / 小组三个路由都能点开，不依赖页面级 lightbox
  const [preview, setPreview] = useState<string | null>(null);

  return (
    <>
    <section className="bg-brand rounded-2xl p-4 sm:p-6 shadow-sm">
      <div className="flex items-start gap-3 sm:gap-5">
        {avatarPreview ? (
          <img
            src={avatarPreview}
            alt="头像"
            onClick={() => setPreview(avatarPreview)}
            className="w-14 h-14 sm:w-20 sm:h-20 rounded-full object-cover border-2 border-accent/70 flex-shrink-0 cursor-zoom-in"
          />
        ) : (
          <div className="w-14 h-14 sm:w-20 sm:h-20 rounded-full bg-white/15 border-2 border-white/20 flex items-center justify-center text-white font-bold text-xl sm:text-2xl flex-shrink-0">
            {profile.name.slice(0, 1)}
          </div>
        )}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2.5 flex-wrap">
            <h1 className="min-w-0 break-words text-xl sm:text-2xl font-extrabold text-white leading-tight">
              {profile.name}
            </h1>
            <span
              className={`px-2.5 py-0.5 rounded-full text-xs font-medium border ${
                hasSubmitted
                  ? "bg-accent/20 text-white border-accent/50"
                  : "bg-white/10 text-white/80 border-white/25"
              }`}
            >
              {hasSubmitted ? "已归档" : "建档中"}
            </span>
          </div>
          <p className="text-sm text-white/70 font-mono mt-1">{profile.user_code}</p>
          <div className="flex items-center gap-2 mt-2 flex-wrap">
            <span className="max-w-full truncate rounded-full bg-white/15 px-2.5 py-0.5 text-xs text-white/90">
              {profile.class_name}
            </span>
          </div>
          {/* 移动端：右侧完整度环收纳成一行（不占横向空间，长姓名/班级也不被挤） */}
          <div className="mt-2 flex items-center gap-2 sm:hidden">
            <span className="h-1.5 w-24 overflow-hidden rounded-full bg-white/20" aria-hidden>
              <span
                className="block h-full rounded-full bg-accent"
                style={{ width: `${(completion / 3) * 100}%` }}
              />
            </span>
            <span className="text-[11px] text-white/75">{heroCompletionText(completion)}</span>
            {!hasSubmitted && !editing && (
              <button
                type="button"
                onClick={onEdit}
                disabled={submissionClosed}
                className="ml-auto inline-flex flex-shrink-0 items-center gap-1 rounded-lg border border-white/30 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
              >
                <SquarePen className="h-3.5 w-3.5" aria-hidden />
                开始填写
              </button>
            )}
          </div>
          {latestAssessment && (
            <p className="mt-1.5 text-[11px] sm:text-xs text-white/60 truncate">
              最近测评：{latestAssessment.name}
              {latestAssessment.historyCount > 0 && (
                <>
                  {" · 第 "}
                  {latestAssessment.historyCount >= MAX_RESULT_VERSIONS
                    ? `${MAX_RESULT_VERSIONS}+`
                    : latestAssessment.historyCount}{" "}
                  次
                </>
              )}
              {" · "}
              {latestAssessment.completedAt}
            </p>
          )}
        </div>
        {/* 桌面：完整度环 + 修改入口；移动端收纳为下方一行完整度文案（#324） */}
        <div className="hidden flex-shrink-0 flex-col items-end gap-2 sm:flex">
          <div
            className="group relative rounded-full focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
            tabIndex={0}
            aria-label={`资料完整度 ${completion}/3`}
            aria-describedby="completion-hint"
          >
            <ProgressRing completion={completion} />
            <div
              id="completion-hint"
              role="tooltip"
              className="pointer-events-none absolute right-0 top-full z-10 mt-2 w-44 rounded-lg border border-border-soft bg-card p-2 text-[11px] leading-relaxed text-foreground opacity-0 shadow-sm transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
            >
              资料完整度：标签 / 头像 / 他人评价（已完成 {completion}/3）
            </div>
          </div>
          {!editing && (
            <button
              type="button"
              onClick={onEdit}
              disabled={submissionClosed}
              title={submissionClosed ? "档案提交已截止" : undefined}
              className="inline-flex items-center gap-1 whitespace-nowrap rounded-lg border border-white/30 px-2.5 py-1 text-xs font-medium text-white transition-colors hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <SquarePen className="h-3.5 w-3.5" aria-hidden />
              {hasSubmitted ? "修改" : "开始填写"}
            </button>
          )}
          {submissionClosed && (
            <p className="max-w-[9rem] text-right text-[11px] leading-snug text-white/70">
              {submissionDeadline ? `档案提交已于 ${submissionDeadline} 截止` : "档案提交已截止"}
            </p>
          )}
        </div>
      </div>
    </section>

    {preview && (
      <div
        className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4"
        onClick={() => setPreview(null)}
      >
        <img
          src={preview}
          alt="放大预览"
          onClick={(event) => event.stopPropagation()}
          className="max-w-full max-h-full object-contain rounded-lg"
        />
        <button
          onClick={() => setPreview(null)}
          aria-label="关闭预览"
          className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
        >
          <X className="w-5 h-5" />
        </button>
      </div>
    )}
    </>
  );
}
