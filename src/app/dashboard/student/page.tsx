"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { Compass, SquarePen, UsersRound, X } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import DemoBanner from "@/components/DemoBanner";
import StudentSidebar, { type StudentViewKey } from "@/components/student/StudentSidebar";
import TextAvatar from "@/components/TextAvatar";
import AssessmentResultsSection from "@/components/assessment/AssessmentResultsSection";
import ProfileSummaryBoard from "@/components/assessment/ProfileSummaryBoard";
import AssessmentAttributionCard from "@/components/assessment/AssessmentAttributionCard";
import ProfileSectionHeader from "@/components/assessment/ProfileSectionHeader";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import TagSelector, { type TagCategory, TAG_CHIP_COLORS } from "@/components/TagSelector";
import ImageUploadBox from "@/components/ImageUploadBox";
import EvaluationWordCloud from "@/components/EvaluationWordCloud";
import EvaluationTexts from "@/components/EvaluationTexts";
import { useSession } from "@/hooks/useSession";
import { useAssessmentResults } from "@/hooks/useAssessmentResults";
import { useFileUrl } from "@/hooks/useFileUrl";
import { safeImageUrl } from "@/lib/sanitize";
import { submitProfile } from "@/lib/profile-submit";
import {
  EVALUATION_COUNT,
  MAX_EVALUATION_TEXT_LENGTH,
  extractEvaluationWords,
} from "@/lib/evaluation-text";
import { MAX_RESULT_VERSIONS } from "@/lib/assessment-flow";
import { latestCompletedOf } from "@/lib/assessment-list";
import {
  assessmentCodeFromDetailId,
  buildProfileSummary,
  PROFILE_INFO_ID,
  type SummaryCard,
} from "@/lib/profile-summary";
import { toThumbnailUrl } from "@/lib/thumbnail-utils";
import { buildProfileCompletion } from "@/lib/profile-completion";
import type { WordCloudItem } from "@/types";

interface MyProfile {
  name: string;
  user_code: string;
  class_name: string;
  tags: string[];
  avatar_url: string;
  /** 历史上传的评价词云图片；#162 起仅存量展示 */
  evaluation_url: string;
  evaluation_texts?: string[];
  evaluation_words?: WordCloudItem[];
  /** 文件所在存储后端（#111） */
  storage_id?: number;
  submitted_at: string | null;
}

/** 历史提交版本项（#95）：快照元数据来自 /api/shared/profile/submissions */
interface SubmissionHistoryItem {
  id: number;
  version: number;
  tags: string[];
  avatar_url: string;
  evaluation_url: string;
  evaluation_texts?: string[];
  evaluation_words?: WordCloudItem[];
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

/** 本组名单（#101）：来自 /api/shared/group，只含请求者所在组 */
interface GroupRosterMember {
  userId: number;
  userCode: string;
  name: string;
  avatarUrl: string | null;
  storageId: number;
  isMe: boolean;
  featureLabels: Record<string, string[]>;
}

interface GroupRoster {
  grouped: boolean;
  groupNo: number | null;
  memberCount: number;
  sources: { key: string; label: string; kind: string }[];
  members: GroupRosterMember[];
}

/** 资料完整度三项（#322 / #162）：hero 进度环、资料卡与速览卡共用同一口径 */
function profileCompletion(profile: MyProfile) {
  return buildProfileCompletion({
    tags: profile.tags,
    avatarUrl: profile.avatar_url,
    evaluationUrl: profile.evaluation_url,
    evaluationTexts: profile.evaluation_texts,
  });
}

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

/** 我的小组（#101）：本组成员名单，学生只读 */
function GroupPanel({
  group,
  loading,
  error,
  tagColorMap,
  onRetry,
}: {
  group: GroupRoster | null;
  loading: boolean;
  error: string | null;
  tagColorMap: Map<string, string>;
  onRetry: () => void;
}) {
  if (loading && !group) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5">
        <p className="text-sm text-muted" role="status">
          加载中...
        </p>
      </section>
    );
  }
  if (error) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-3">
        <ProfileSectionHeader label="我的小组" done={false} />
        <p className="text-sm text-danger-strong">{error}</p>
        <button
          type="button"
          onClick={onRetry}
          className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
        >
          重试
        </button>
      </section>
    );
  }
  if (!group || !group.grouped) {
    return (
      <section className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-2">
        <UsersRound className="w-8 h-8 text-muted mx-auto" aria-hidden />
        <p className="text-sm text-foreground font-medium">老师还没分组</p>
        <p className="text-xs text-muted">课堂上分组之后回到这里，就能看到本组成员的姓名、学号与标签。</p>
      </section>
    );
  }

  const sourceNames = (group.sources ?? []).map((s) => s.label).join("、");
  return (
    <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
      <div className="flex items-center gap-2 flex-wrap">
        <ProfileSectionHeader label="我的小组" />
        <span className="ml-auto text-sm font-semibold text-foreground">
          {group.groupNo === null ? "本组" : `第 ${group.groupNo} 组`} · {group.memberCount} 人
        </span>
      </div>
      {sourceNames && <p className="text-xs text-muted">按{sourceNames}相似度分组，标签由每位同学自己填写</p>}
      <ul className="space-y-3">
        {group.members.map((m) => {
          // 带上源 key：将来注册第二个特征源后，两个源里的同名标签不会撞 React key
          const labels = Object.entries(m.featureLabels).flatMap(([source, values]) =>
            values.map((tag) => ({ key: `${source}:${tag}`, tag }))
          );
          return (
            <li key={m.userId} className="flex items-start gap-3">
              <TextAvatar name={m.name} avatarUrl={m.avatarUrl} storageId={m.storageId} size="md" />
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="min-w-0 truncate text-sm font-medium text-foreground">{m.name}</span>
                  {m.isMe && (
                    <span className="px-1.5 py-0.5 rounded-full text-[10px] font-medium bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300">
                      我
                    </span>
                  )}
                  <span className="ml-auto flex-shrink-0 font-mono text-xs text-muted">{m.userCode}</span>
                </div>
                {labels.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-1.5">
                    {labels.map(({ key, tag }) => (
                      <span
                        key={key}
                        className={`px-2 py-0.5 rounded-full text-xs ${tagColorMap.get(tag) ?? TAG_CHIP_COLORS[0]}`}
                      >
                        {tag}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

/**
 * 「我的档案资料」卡（#322）：标签（按分类三色、全量展示）+ 他人评价（#162 文字优先，
 * 历史图片兜底）+ 三项完成度 + 提交时间合并为一张卡，卡尾放主操作「修改数据」。
 */
function ProfileOverviewCard({
  profile,
  categories,
  evaluationUrl,
  submissionClosed,
  submissionDeadline,
  onEdit,
  onPreview,
  highlight = false,
}: {
  profile: MyProfile;
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
        <p className="text-xs text-amber-600 dark:text-amber-400">
          {submissionDeadline ? `档案提交已于 ${submissionDeadline} 截止，无法再修改` : "档案提交已截止，无法再修改"}
        </p>
      )}
    </section>
  );
}

/** 学生面板：探索档案 · 罗盘进度——信息通览 + 就地修改 + 预留侧边栏 */
export default function StudentDashboardPage() {
  const router = useRouter();
  const { session, checking } = useSession();

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);

  // 侧边栏：初始收起，挂载后按视口宽度决定桌面默认展开（避免 hydration 不一致）
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- 桌面默认展开需挂载后按视口判断 */
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 编辑模式状态
  const [editing, setEditing] = useState(false);
  const [categories, setCategories] = useState<TagCategory[]>([]);
  const [maxCustomTags, setMaxCustomTags] = useState<number | undefined>(undefined);
  // 图片体积上限（#206）：选图前预检用，随 /api/tags 下发；服务端校验仍是最终防线
  const [avatarMaxMb, setAvatarMaxMb] = useState<number | undefined>(undefined);
  // 提交时限（#96）：截止后禁用修改/提交入口，服务端状态为准（经 /api/tags 下发）
  const [submissionClosed, setSubmissionClosed] = useState(false);
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  // 三条他人评价（#162）：顺序固定，保存时服务端再次校验
  const [editEvaluations, setEditEvaluations] = useState<string[]>(["", "", ""]);
  // 延迟上传：选图只暂存 File，确认保存时才真正上传（#162 起仅头像）
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  // 保存前重取截止状态的进行中标记：其间禁用保存与取消，避免出现「已取消却弹出确认框」
  const [checkingDeadline, setCheckingDeadline] = useState(false);

  // 通览态图片放大预览
  const [lightbox, setLightbox] = useState<string | null>(null);

  // 测评数据（#323）：页面统一拉取一次，速览卡与折叠详情卡共用（不再由结果区自己 fetch）
  const assessment = useAssessmentResults(session?.role === "student");
  // 速览卡「查看详情」的联动状态：受控展开 + 定位后短暂高亮。
  // 展开态用集合而不是单个 code——期 1 每张折叠卡各自独立，两套结果可以同时展开，这里不能退化成手风琴。
  const [expandedCodes, setExpandedCodes] = useState<string[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  // 折叠卡展开/收起（受控）：速览卡与卡片自身的折叠按钮改同一份状态
  const setCardOpen = useCallback(
    (code: string, open: boolean) => {
      setExpandedCodes((prev) =>
        open ? (prev.includes(code) ? prev : [...prev, code]) : prev.filter((item) => item !== code)
      );
    },
    []
  );

  // 历史提交版本（#95）：独立 Tab，首次切入时懒加载；恢复生成新版本不回写旧记录
  const [activeView, setActiveView] = useState<StudentViewKey>("profile");
  const [historySubmissions, setHistorySubmissions] = useState<SubmissionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  // 我的小组（#101）：侧边栏进入，首次切入时懒加载；未分组与加载失败是两种不同状态
  const [group, setGroup] = useState<GroupRoster | null>(null);
  const [groupLoading, setGroupLoading] = useState(false);
  const [groupError, setGroupError] = useState<string | null>(null);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  // 标签三色映射（#95）：历史版本标签按分类着色，与「我的标签」展示态一致；未匹配分类（如已删除标签）兜底第一种颜色
  const tagColorMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((cat, catIdx) => {
      const color = TAG_CHIP_COLORS[catIdx % TAG_CHIP_COLORS.length];
      cat.tags.forEach((t) => map.set(t.name, color));
    });
    return map;
  }, [categories]);

  // 编辑态词云预览：与最终保存使用同一套服务端规则；仅作实时反馈
  const editEvaluationWords = useMemo(
    () => extractEvaluationWords(editEvaluations),
    [editEvaluations]
  );

  // 文件展示地址解析（#111）：本地代理路径原样使用，云后端自动换签名 URL
  const avatarResolved = useFileUrl(profile?.avatar_url, profile?.storage_id);
  const evaluationResolved = useFileUrl(profile?.evaluation_url, profile?.storage_id);

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  useEffect(() => {
    if (!checking && (!session || session.role !== "student")) {
      router.replace("/login");
    }
  }, [checking, session, router]);

  const loadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shared/profile");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "档案加载失败");
      setProfile(data);
    } catch (err) {
      console.error("Failed to load profile:", err);
      toast.error(err instanceof Error ? err.message : "档案加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载标签分类（展示态「我的标签」三色分组 + 编辑态复用）+ 自定义标签上限（#94）+ 提交截止状态（#96）
  // + 图片体积上限（#206，选图前预检）
  // 返回本次请求实测的截止状态：调用方要按最新值判分支，不能读可能滞后的 state
  const loadCategories = useCallback(async (): Promise<{ ok: boolean; closed: boolean }> => {
    try {
      const res = await fetch("/api/tags");
      const data = await res.json();
      if (res.ok) {
        setCategories(data.categories || []);
        setMaxCustomTags(typeof data.maxCustomTags === "number" ? data.maxCustomTags : undefined);
        setAvatarMaxMb(typeof data.maxAvatarSizeMb === "number" ? data.maxAvatarSizeMb : undefined);
        const closed = data.submissionClosed === true;
        setSubmissionClosed(closed);
        setSubmissionDeadline(typeof data.submissionDeadline === "string" ? data.submissionDeadline : null);
        return { ok: true, closed };
      }
      return { ok: false, closed: false };
    } catch (err) {
      console.error("Failed to load tags:", err);
      return { ok: false, closed: false };
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- load profile after session check */
  useEffect(() => {
    if (session?.role === "student") {
      loadProfile();
      loadCategories();
    }
  }, [session, loadProfile, loadCategories]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const hasSubmitted = !!profile?.submitted_at;

  // hero「第 N 次测评与完成时间」（#322）：取最近一次完成的量表，与「我的测评」共用同一条规则
  const latestAssessment = useMemo(
    () => latestCompletedOf(assessment.data.scales),
    [assessment.data.scales]
  );

  // 速览四卡（#323）：由同一份数据算出，与折叠详情共用 assessment-view 的 builders，口径不会分叉
  const summary = useMemo(
    () =>
      buildProfileSummary({
        profile: profile
          ? {
              tags: profile.tags,
              avatarUrl: profile.avatar_url,
              evaluationUrl: profile.evaluation_url,
              evaluationTexts: profile.evaluation_texts,
              submitted: Boolean(profile.submitted_at),
            }
          : null,
        scales: assessment.data.scales,
        results: assessment.data.payloads,
        careers: assessment.data.careers,
        listFailed: assessment.failed,
        failedCodes: assessment.data.failedCodes,
        careersFailed: assessment.data.careersFailed,
      }),
    [profile, assessment.data, assessment.failed]
  );

  const startEdit = useCallback(async () => {
    if (!profile) return;
    // 从「我的小组 / 历史提交」点 hero 的修改入口时，先切回档案视图，保存后才看得到结果
    setActiveView("profile");
    setEditTags(profile.tags);
    setAvatarFile(null);
    setEditEvaluations(
      profile.evaluation_texts?.length === EVALUATION_COUNT
        ? [...profile.evaluation_texts]
        : ["", "", ""]
    );
    setEditing(true);
    // 分类为空时等待加载（编辑态有「标签加载中...」占位）；已有分类则后台刷新，
    // 顺带同步提交截止状态（#96）——#168 起面板内提交是唯一入口，不能让截止态陈旧
    if (categories.length === 0) {
      const { ok } = await loadCategories();
      if (!ok) toast.error("标签加载失败");
    } else {
      void loadCategories();
    }
  }, [profile, categories.length, loadCategories]);

  const toggleTag = (tag: string) => {
    setEditTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const removeTag = (tag: string) => {
    setEditTags((prev) => prev.filter((t) => t !== tag));
  };

  // 速览卡「查看详情」（#323）：滚动到目标 + 短暂高亮（1800ms 后自动淡出）
  const focusDetail = useCallback((targetId: string) => {
    window.requestAnimationFrame(() => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ block: "start", behavior: "smooth" });
      setHighlightId(targetId);
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
      highlightTimer.current = window.setTimeout(() => setHighlightId(null), 1800);
    });
  }, []);

  useEffect(
    () => () => {
      if (highlightTimer.current !== null) window.clearTimeout(highlightTimer.current);
    },
    []
  );

  // 摘要卡点击的总入口：进编辑态 / 展开并定位详情（「去测评」由速览卡直接渲染成链接，不经这里）
  const handleSummaryAction = useCallback(
    (card: SummaryCard) => {
      const { cta } = card;
      if (cta.action === "edit") {
        if (!editing) void startEdit();
        return;
      }
      if (!cta.targetId) return;
      if (editing) {
        toast("请先保存或取消当前编辑");
        return;
      }
      const scaleCode = assessmentCodeFromDetailId(cta.targetId);
      if (scaleCode) setCardOpen(scaleCode, true);
      setActiveView("profile");
      focusDetail(cta.targetId);
    },
    [editing, startEdit, focusDetail, setCardOpen]
  );

  // #208：标签必填；#162：三条他人评价必填（仅历史图片账户在三条留空时保留旧图）
  const hasEditTags = editTags.length > 0;
  const filledEditEvaluations = editEvaluations.filter((text) => text.trim()).length;

  // 保存前重取截止状态（#96/#168）：编辑态可以停留很久，进编辑时同步过的状态会过期。
  // 过期时保存会先上传图片、再由服务端 403 拦下，留下一份无主上传，学生也要填满一屏才被拒
  const requestSave = async () => {
    if (!hasEditTags) {
      toast.warning("请至少选择一个标签");
      return;
    }
    if (
      filledEditEvaluations !== 0 &&
      filledEditEvaluations !== EVALUATION_COUNT
    ) {
      toast.warning("请完整填写三条他人评价");
      return;
    }
    if (filledEditEvaluations === 0 && !profile?.evaluation_url) {
      toast.warning("请完整填写三条他人评价");
      return;
    }
    setCheckingDeadline(true);
    try {
      const { ok, closed } = await loadCategories();
      if (ok && closed) {
        toast.error("档案提交已截止，无法保存");
        return;
      }
    } finally {
      setCheckingDeadline(false);
    }
    // 取不到截止状态时不阻断：服务端 403 仍是最终防线，不因一次请求失败否定学生的输入
    setConfirming(true);
  };

  // 加载历史提交（#95）：首次切入历史 Tab 时拉取
  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/shared/profile/submissions");
      const data = await res.json();
      if (res.ok) {
        setHistorySubmissions(data.submissions || []);
      } else {
        toast.error(data.error || "历史记录加载失败");
      }
    } catch (err) {
      console.error("Failed to load history:", err);
      toast.error("历史记录加载失败");
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  // 我的小组（#101）：侧边栏进入，首次切入时懒加载本组名单
  const loadGroup = useCallback(async () => {
    setGroupLoading(true);
    setGroupError(null);
    try {
      const res = await fetch("/api/shared/group");
      const data = await res.json();
      if (res.status === 401 || res.status === 403) {
        // 端点回的是英文鉴权原文，直接摊给学生看等于报了个不存在的错误
        setGroup(null);
        setGroupError("登录状态已失效，请重新登录");
      } else if (res.ok) {
        setGroup(data as GroupRoster);
      } else {
        setGroup(null);
        setGroupError(data.error || "本组名单加载失败");
      }
    } catch (err) {
      console.error("Failed to load group:", err);
      setGroup(null);
      setGroupError("本组名单加载失败");
    } finally {
      setGroupLoading(false);
    }
  }, []);

  const switchView = (view: StudentViewKey) => {
    // 编辑态不切走：图片预览与标签输入的一半内容存在于子组件内部状态，
    // 卸载再回来会显示旧图而 state 里已是新文件，学生按最后一次提示保存就送错了图
    if (editing && view !== "profile") {
      toast("请先保存或取消当前编辑");
      return;
    }
    setActiveView(view);
    if (view === "history" && historySubmissions.length === 0 && !historyLoading) {
      void loadHistory();
    }
    // 小组名单每次进入都重取：老师可能在学生看页面期间已经分组或重新分组
    if (view === "group" && !groupLoading) {
      void loadGroup();
    }
  };

  // 恢复历史版本（#95）：以目标快照生成新版本（审计链完整），随后刷新档案与列表
  const restoreVersion = async (submissionId: number) => {
    setRestoringId(submissionId);
    try {
      const res = await fetch("/api/shared/profile/submissions/restore", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ submissionId }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "恢复失败");
      toast.success(data.message || "恢复成功");
      await loadProfile();
      await loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setRestoringId(null);
    }
  };

  const confirmSave = async () => {
    setConfirming(false);
    setSaving(true);
    try {
      // 确认保存后才上传图片（取消编辑不产生任何服务端变更）
      await submitProfile({
        studentId: profile!.user_code,
        tags: editTags,
        avatarFile,
        existingAvatarUrl: profile!.avatar_url,
        evaluationTexts: editEvaluations,
      });
      toast.success(hasSubmitted ? "修改已保存" : "档案已提交");
      setEditing(false);
      setAvatarFile(null);
      setEditEvaluations(["", "", ""]);
      await loadProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (checking || !session || session.role !== "student" || loading) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-muted">加载中...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-3">
        <p className="text-sm text-muted">档案加载失败</p>
        <button
          onClick={loadProfile}
          className="px-4 py-1.5 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg"
        >
          重试
        </button>
      </div>
    );
  }

  const avatarPreview = safeImageUrl(avatarResolved);
  const evaluationPreview = safeImageUrl(evaluationResolved);

  // 档案完成度：兴趣标签 / 头像 / 他人评价（进度环 x/3；#322 与资料卡共用同一实现）
  const completion = profileCompletion(profile).filter((item) => item.done).length;

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title="学生面板" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <DemoBanner />

      {/* 注意：此 flex 容器不设任何 overflow，避免破坏侧边栏 sticky */}
      <div className="flex">
        <StudentSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          activeView={activeView}
          onSelect={switchView}
        />

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 animate-[fade-in_0.2s_ease-out]">
          <div className="max-w-3xl mx-auto space-y-5">
            {/* Hero：深绿品牌区——头像 + 身份 + 状态印章 + 完成度环 + 就地修改（#322 精简） */}
            <section className="bg-brand rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-start gap-4 sm:gap-5">
                {avatarPreview ? (
                  <img
                    src={avatarPreview}
                    alt="头像"
                    onClick={() => setLightbox(avatarPreview)}
                    className="w-16 h-16 sm:w-20 sm:h-20 rounded-full object-cover border-2 border-accent/70 cursor-zoom-in flex-shrink-0"
                  />
                ) : (
                  <div className="w-16 h-16 sm:w-20 sm:h-20 rounded-full bg-white/15 border-2 border-white/20 flex items-center justify-center text-white font-bold text-2xl flex-shrink-0">
                    {profile.name.slice(0, 1)}
                  </div>
                )}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2.5 flex-wrap">
                    <h1 className="text-2xl font-extrabold text-white leading-tight">{profile.name}</h1>
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
                    <span className="px-2.5 py-0.5 bg-white/15 text-white/90 rounded-full text-xs">
                      {profile.class_name}
                    </span>
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
                <div className="flex flex-shrink-0 flex-col items-end gap-2">
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
                      onClick={startEdit}
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

            {/* 速览四卡（#323）：hero 之下的结论区，点「查看详情」展开并滚动到对应内容 */}
            <ProfileSummaryBoard
              summary={summary}
              loading={assessment.loading}
              onAction={handleSummaryAction}
              tagColors={tagColorMap}
            />

            {/* 测评结果区（#224 + #292 + #322 + #323）：折叠详情，与速览共用同一份数据 */}
            <AssessmentResultsSection
              data={assessment.data}
              loading={assessment.loading}
              failed={assessment.failed}
              onRetry={assessment.reload}
              expandedCodes={expandedCodes}
              onExpandedChange={setCardOpen}
              highlightId={highlightId}
            />

            {/* Tab 导航（#322 上移）：速览区之后、资料区之前，保证「历史提交」在 1 屏内可达；历史提交仍懒加载 */}
            {!editing && hasSubmitted && activeView !== "group" && (
              <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
                <button
                  onClick={() => switchView("profile")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === "profile"
                      ? "bg-card text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  我的档案
                </button>
                <button
                  onClick={() => switchView("history")}
                  className={`flex-1 py-2 rounded-lg text-sm font-medium transition-colors ${
                    activeView === "history"
                      ? "bg-card text-gray-900 dark:text-gray-100 shadow-sm"
                      : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
                  }`}
                >
                  历史提交
                </button>
              </div>
            )}

            {activeView === "group" ? (
              <GroupPanel
                group={group}
                loading={groupLoading}
                error={groupError}
                tagColorMap={tagColorMap}
                onRetry={() => void loadGroup()}
              />
            ) : !editing ? (
              hasSubmitted ? (
                activeView === "profile" ? (
                  <ProfileOverviewCard
                    profile={profile}
                    categories={categories}
                    evaluationUrl={evaluationPreview}
                    submissionClosed={submissionClosed}
                    submissionDeadline={submissionDeadline}
                    onEdit={startEdit}
                    onPreview={setLightbox}
                    highlight={highlightId === PROFILE_INFO_ID}
                  />
                ) : (
                  /* 历史提交（#95）：独立 Tab，恢复按钮截止后隐藏 */
                  <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                    <ProfileSectionHeader label="历史提交" />
                    {historyLoading ? (
                      <p className="text-sm text-muted">加载中...</p>
                    ) : historySubmissions.length === 0 ? (
                      <p className="text-sm text-muted">暂无历史提交</p>
                    ) : (
                      <ul className="space-y-2">
                        {historySubmissions.map((s) => (
                          <HistoryItem
                            key={s.id}
                            submission={s}
                            restoring={restoringId === s.id}
                            closed={submissionClosed}
                            tagColorMap={tagColorMap}
                            onRestore={restoreVersion}
                          />
                        ))}
                      </ul>
                    )}
                  </section>
                )
              ) : (
                /* 从未提交：引导卡，点「开始填写」就地进入编辑态（#168 起不再跳转表单页） */
                <div className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-4">
                  <div className="w-14 h-14 bg-brand rounded-2xl flex items-center justify-center mx-auto">
                    <SquarePen className="w-7 h-7 text-accent" strokeWidth={2} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">你还没有提交职业探索档案</h2>
                    <p className="text-sm text-muted mt-1">先选好兴趣标签（必填），再填写三条他人评价；头像可选填，让老师了解别人眼中的你</p>
                  </div>
                  <button
                    onClick={startEdit}
                    disabled={submissionClosed}
                    className="px-6 py-2.5 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    开始填写
                  </button>
                  {submissionClosed && (
                    <p className="text-xs text-amber-600 dark:text-amber-400">
                      档案提交已于 {submissionDeadline} 截止
                    </p>
                  )}
                </div>
              )
            ) : (
              /* 编辑模式（hero 保留在顶部） */
              <div className="space-y-5">
                <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                  <ProfileSectionHeader label={hasSubmitted ? "修改标签" : "选择标签"} marker="required" />
                  {categories.length === 0 ? (
                    <p className="text-sm text-muted py-4 text-center">标签加载中...</p>
                  ) : (
                    <TagSelector
                      categories={categories}
                      selectedTags={editTags}
                      onToggle={toggleTag}
                      onRemove={removeTag}
                      maxCustomTags={maxCustomTags}
                    />
                  )}
                </section>

                <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                  <ProfileSectionHeader label="头像" marker="optional" />
                  <div className="max-w-xs">
                    <ImageUploadBox
                      initialUrl={avatarPreview ?? undefined}
                      aspect="square"
                      emptyHint="点击上传头像"
                      maxSizeMb={avatarMaxMb}
                      onFileSelected={setAvatarFile}
                    />
                  </div>
                </section>

                <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                  <ProfileSectionHeader label="他人评价" marker="required" />
                  <p className="text-xs text-muted">
                    请邀请三位不同的人分别写一段对你的评价（每条 1–{MAX_EVALUATION_TEXT_LENGTH} 字），由你统一提交。
                    评价人姓名不会展示，请提醒对方不要在正文中写姓名。
                  </p>

                  {profile.evaluation_url && !editEvaluations.some((text) => text.trim()) && (
                    <div className="space-y-2 rounded-lg border border-amber-200 bg-amber-50/60 p-3 dark:border-amber-900/50 dark:bg-amber-900/10">
                      <p className="text-xs text-amber-700 dark:text-amber-300">
                        当前显示的是历史图片。保存时三条留空将保留旧图；填写三条后替换为自动生成的词云。
                      </p>
                      {evaluationPreview && (
                        <img
                          src={evaluationPreview}
                          alt="历史评价词云图片"
                          className="h-20 w-32 rounded-lg border border-border-soft object-cover"
                        />
                      )}
                    </div>
                  )}

                  <div className="space-y-3">
                    {editEvaluations.map((text, index) => (
                      <div key={index} className="space-y-1.5">
                        <div className="flex items-center justify-between gap-3">
                          <label
                            htmlFor={`evaluation-text-${index}`}
                            className="text-xs font-medium text-gray-700 dark:text-gray-200"
                          >
                            评价{index + 1}
                          </label>
                          <span className="text-[11px] text-muted">
                            {Array.from(text).length}/{MAX_EVALUATION_TEXT_LENGTH}
                          </span>
                        </div>
                        <textarea
                          id={`evaluation-text-${index}`}
                          value={text}
                          maxLength={MAX_EVALUATION_TEXT_LENGTH}
                          rows={3}
                          onChange={(event) => {
                            const next = [...editEvaluations];
                            next[index] = event.target.value;
                            setEditEvaluations(next);
                          }}
                          placeholder="写下这位评价人对你的评价..."
                          className="w-full resize-y rounded-lg border border-gray-200 bg-card px-3 py-2 text-sm text-foreground placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-focus-ring dark:border-gray-700"
                        />
                      </div>
                    ))}
                  </div>

                  <div className="space-y-2">
                    <p className="text-xs text-muted">词云预览（根据三条评价自动生成）</p>
                    <EvaluationWordCloud
                      words={editEvaluationWords}
                      height={240}
                      emptyText="填写评价后这里会生成词云"
                    />
                  </div>
                </section>

                <div className="flex gap-3">
                  <button
                    onClick={() => setEditing(false)}
                    disabled={saving || checkingDeadline}
                    className="flex-1 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-200 font-medium rounded-xl transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={requestSave}
                    disabled={saving || checkingDeadline || submissionClosed}
                    className="flex-1 py-3 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
                  >
                    {saving
                      ? hasSubmitted
                        ? "保存中..."
                        : "提交中..."
                      : checkingDeadline
                        ? "检查中..."
                        : hasSubmitted
                          ? "保存修改"
                          : "提交档案"}
                  </button>
                </div>
                {submissionClosed && (
                  <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                    档案提交已于 {submissionDeadline} 截止，无法保存
                  </p>
                )}
              </div>
            )}

            {/* 页尾授权与免责（#322）：全页只出现一次，结果卡内只留指针；折叠但保留 DOM 文本 */}
            {assessment.data.scales.length > 0 && (
              <AssessmentAttributionCard
                collapsible
                scales={assessment.data.scales}
                careersAttribution={assessment.data.careersAttribution}
              />
            )}
          </div>
        </main>
      </div>

      {/* 图片放大预览（点击遮罩 / × / Esc 关闭）；z-[100] 高于全局 UserMenu，避免关闭按钮被遮挡 */}
      {lightbox && (
        <div
          className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4"
          onClick={() => setLightbox(null)}
        >
          <img
            src={lightbox}
            alt="放大预览"
            onClick={(e) => e.stopPropagation()}
            className="max-w-full max-h-full object-contain rounded-lg"
          />
          <button
            onClick={() => setLightbox(null)}
            aria-label="关闭预览"
            className="absolute top-4 right-4 w-9 h-9 rounded-full bg-white/15 hover:bg-white/30 text-white flex items-center justify-center transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>
      )}

      <ConfirmDialog
        open={confirming}
        title={hasSubmitted ? "确认修改" : "确认提交"}
        variant={hasSubmitted ? "warning" : "default"}
        confirmText={hasSubmitted ? "确认保存" : "确认提交"}
        message={
          hasSubmitted
            ? "保存后将覆盖你已提交的档案数据（标签、头像、三条他人评价），确定继续吗？"
            : "提交后生成你的职业探索档案，之后仍可在面板内查看和修改，确定提交吗？"
        }
        onConfirm={confirmSave}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
