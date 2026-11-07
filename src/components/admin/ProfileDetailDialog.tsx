"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Trash2, X } from "lucide-react";
import StorageImage from "@/components/StorageImage";
import TextAvatar from "@/components/TextAvatar";
import EvaluationTexts from "@/components/EvaluationTexts";
import EvaluationWordCloud from "@/components/EvaluationWordCloud";
import ProfileSummaryBoard, { FALLBACK_TAG_CLASS } from "@/components/assessment/ProfileSummaryBoard";
import ProfileSectionHeader from "@/components/assessment/ProfileSectionHeader";
import AssessmentResultsSection from "@/components/assessment/AssessmentResultsSection";
import AssessmentAttributionCard from "@/components/assessment/AssessmentAttributionCard";
import { useEscapeKey } from "@/hooks/useEscapeKey";
import { useTagColorMap } from "@/hooks/useTagColorMap";
import type { Profile } from "@/hooks/useAdminAuth";
import type { ProfileAssessmentScaleView } from "@/lib/profile-assessment";
import { PROFILE_INFO_ID, type SummaryCard } from "@/lib/profile-summary";
import {
  buildTeacherAssessmentDetail,
  buildTeacherCareers,
  buildTeacherProfileSummary,
  resolveSummaryActionTarget,
  type TeacherCareersPayload,
} from "@/lib/profile-detail-data";

interface SubmissionHistoryRow {
  id: number;
  version: number;
  tags: string[];
  avatar_url: string;
  evaluation_url: string;
  evaluation_texts?: string[];
  evaluation_words?: { text: string; weight: number }[];
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

interface Props {
  profile: Profile;
  /** 启用中的量表清单（列表接口随行下发，弹窗零额外测评请求） */
  scales: readonly ProfileAssessmentScaleView[];
  /** 是否展示「删除此记录」（沿用 #243 的归属判定） */
  canDelete: boolean;
  onClose: () => void;
  onRequestDelete: () => void;
}

/** 高于既有 z-index 层级的详情弹窗（与 UserMenu z-45 / ConfirmDialog z-50 同级） */
const OVERLAY_Z = "z-50";

/**
 * 教师端「档案详情」弹窗（#332）：与学生端「我的档案」**同构**。
 *
 * 结构与学生端一致：身份区 → 速览 2×2 → 测评详情（折叠）→ 版本历史（折叠，教师独有）
 * → 授权与免责（折叠）。速览卡 / 详情卡 / 授权卡全部来自 `src/components/assessment/`
 * 的**同一份共享组件**（本文件只包一层 dialog 与版本历史，不复制卡片实现）。
 *
 * 数据：身份 + 两份测评结果全部来自列表行（`assessmentResults` / `assessmentScales`），
 * 打开弹窗不额外请求测评接口；仅推荐职业走教师端只读端点（#332），版本历史沿用既有
 * `/api/manage/profiles/submissions`（教师端独有能力，不回归）。
 *
 * 可访问性：`role="dialog"` + `aria-modal` + `aria-labelledby`、Esc 关闭、Tab 焦点陷阱、
 * 打开时锁定页面滚动并聚焦弹窗内第一个可操作元素，关闭后焦点回到触发按钮。
 */
export default function ProfileDetailDialog({
  profile,
  scales,
  canDelete,
  onClose,
  onRequestDelete,
}: Props) {
  const panelRef = useRef<HTMLDivElement>(null);
  const restoreFocusRef = useRef<HTMLElement | null>(null);

  const detail = useMemo(
    () => buildTeacherAssessmentDetail(scales, profile.assessmentResults),
    [scales, profile.assessmentResults]
  );
  const hasHollandResult = useMemo(
    () => detail.scales.some((scale) => scale.scoringMode === "typological" && detail.payloads[scale.code]?.current),
    [detail]
  );

  // 推荐职业（可选端点）：仅霍兰德有当前结果时请求一次；失败只让这张卡降级
  const [careers, setCareers] = useState<ReturnType<typeof buildTeacherCareers>>({ careers: [], attribution: "" });
  // 初始态即 loading（有霍兰德结果才请求），避免在 effect 里同步 setState 触发级联渲染
  const [careersStatus, setCareersStatus] = useState<"idle" | "loading" | "ready" | "failed">(
    hasHollandResult && profile.userId != null ? "loading" : "idle"
  );

  // 版本历史（教师端独有）：打开弹窗时预取，计入「档案资料」卡的版本数
  const [historyRows, setHistoryRows] = useState<SubmissionHistoryRow[]>([]);
  const [historyLoading, setHistoryLoading] = useState(profile.userId != null);
  const [historyFailed, setHistoryFailed] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);

  // 标签分类三色（与学生端速览卡、版本历史同一份映射）
  const tagColors = useTagColorMap();

  const [expandedCodes, setExpandedCodes] = useState<string[]>([]);
  const [pendingScrollId, setPendingScrollId] = useState<string | null>(null);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const close = useCallback(() => {
    if (highlightTimer.current) clearTimeout(highlightTimer.current);
    onClose();
  }, [onClose]);

  useEscapeKey(true, close);

  // 焦点陷阱 + 滚动锁：打开时把焦点移进弹窗，关闭时交还给触发按钮
  useEffect(() => {
    restoreFocusRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const focusables = () =>
      Array.from(
        panel?.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        ) ?? []
      ).filter((element) => element.offsetParent !== null || element === panel);
    focusables()[0]?.focus();

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== "Tab") return;
      const items = focusables();
      if (items.length === 0) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      restoreFocusRef.current?.focus?.();
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
    };
  }, []);

  // 推荐职业：可选端点，失败静默降级（速览卡给「暂时没取到」而不是报错）
  useEffect(() => {
    if (!hasHollandResult || profile.userId == null) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/manage/profiles/careers?studentId=${profile.userId}`);
        const payload = (await res.json().catch(() => null)) as (TeacherCareersPayload & { error?: string }) | null;
        if (cancelled) return;
        if (!res.ok) {
          setCareersStatus("failed");
          return;
        }
        setCareers(buildTeacherCareers(payload));
        setCareersStatus("ready");
      } catch (err) {
        if (cancelled) return;
        console.error("推荐职业加载失败:", err);
        setCareersStatus("failed");
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [hasHollandResult, profile.userId]);

  // 版本历史：打开时预取（沿用既有端点；失败只让该区块显示重试提示）
  useEffect(() => {
    if (profile.userId == null) return;
    let cancelled = false;
    const run = async () => {
      try {
        const res = await fetch(`/api/manage/profiles/submissions?userId=${profile.userId}`);
        const payload = (await res.json().catch(() => null)) as { submissions?: SubmissionHistoryRow[] } | null;
        if (cancelled) return;
        if (res.ok) setHistoryRows(Array.isArray(payload?.submissions) ? payload.submissions : []);
        else setHistoryFailed(true);
      } catch (err) {
        if (cancelled) return;
        console.error("版本历史加载失败:", err);
        setHistoryFailed(true);
      } finally {
        if (!cancelled) setHistoryLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [profile.userId]);

  // 速览卡「查看详情」：展开对应折叠卡并滚动 + 短暂高亮（与学生端 #323 同一交互）
  const handleSummaryAction = useCallback((card: SummaryCard) => {
    const target = resolveSummaryActionTarget(card);
    if (!target) return;
    if (target.expandCode) {
      setExpandedCodes((previous) =>
        previous.includes(target.expandCode as string) ? previous : [...previous, target.expandCode as string]
      );
    }
    setPendingScrollId(target.targetId);
  }, []);

  useEffect(() => {
    if (!pendingScrollId) return;
    // 等展开态提交后再滚动，否则折叠卡没有高度、scrollIntoView 会落在错误位置
    const timer = setTimeout(() => {
      document.getElementById(pendingScrollId)?.scrollIntoView({ behavior: "smooth", block: "start" });
      setHighlightId(pendingScrollId);
      setPendingScrollId(null);
      if (highlightTimer.current) clearTimeout(highlightTimer.current);
      highlightTimer.current = setTimeout(() => setHighlightId(null), 1500);
    }, 60);
    return () => clearTimeout(timer);
  }, [pendingScrollId]);

  const versionCount = historyRows.length > 0 ? historyRows.length : undefined;
  const summary = useMemo(
    () =>
      buildTeacherProfileSummary({
        row: {
          ...profile,
          className: profile.className ?? null,
        },
        detail,
        careers: careers.careers,
        careersFailed: careersStatus === "failed",
        versionCount,
      }),
    [profile, detail, careers, careersStatus, versionCount]
  );

  const summaryLoading = hasHollandResult && careersStatus === "loading";
  const identityMeta = [
    { label: "学号", value: profile.studentId, mono: true },
    { label: "班级", value: profile.className || "未分班", mono: false },
    { label: "提交时间", value: profile.createdAt, mono: false },
    ...(versionCount ? [{ label: "档案版本", value: `共 ${versionCount} 个`, mono: false }] : []),
  ];

  return (
    <div
      className={`fixed inset-0 ${OVERLAY_Z} flex items-stretch justify-center bg-black/40 backdrop-blur-sm sm:items-center sm:px-4`}
      onClick={(event) => {
        if (event.target === event.currentTarget) close();
      }}
    >
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="profile-detail-title"
        className="flex h-full w-full flex-col overflow-hidden bg-card shadow-xl sm:h-auto sm:max-h-[85vh] sm:max-w-2xl sm:rounded-2xl"
      >
        {/* sticky 头部：标题 + 身份摘要 + 关闭 */}
        <header className="sticky top-0 z-10 flex items-start gap-3 border-b border-border-soft bg-card px-5 py-4">
          <TextAvatar name={profile.studentName} avatarUrl={profile.avatarUrl} storageId={profile.storageId} size="lg" />
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 id="profile-detail-title" className="truncate text-lg font-semibold text-foreground">
                档案详情
              </h2>
              <span className="rounded-full bg-green-50 px-2 py-0.5 text-[11px] font-medium text-green-700 dark:bg-green-900/30 dark:text-green-300">
                已归档
              </span>
            </div>
            <p className="truncate text-sm font-medium text-foreground">{profile.studentName || "—"}</p>
            <dl className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
              {identityMeta.map((item) => (
                <div key={item.label} className="flex items-center gap-1">
                  <dt className="text-muted">{item.label}</dt>
                  <dd className={`text-foreground ${item.mono ? "font-mono" : ""}`}>{item.value}</dd>
                </div>
              ))}
            </dl>
            {profile.tags.length > 0 && (
              <div className="flex flex-wrap gap-1 pt-0.5">
                {profile.tags.map((tag) => (
                  <span
                    key={tag}
                    className={`rounded-full px-2 py-0.5 text-[11px] ${tagColors.get(tag) ?? FALLBACK_TAG_CLASS}`}
                  >
                    {tag}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button
            type="button"
            onClick={close}
            aria-label="关闭档案详情"
            className="flex-shrink-0 rounded-lg p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 dark:hover:bg-gray-800 dark:hover:text-gray-200"
          >
            <X size={20} aria-hidden />
          </button>
        </header>

        {/* 内容滚动区：速览 → 测评详情 → 档案资料 → 版本历史 → 授权与免责 */}
        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4">
          <ProfileSummaryBoard
            summary={summary}
            loading={summaryLoading}
            tagColors={tagColors}
            onAction={handleSummaryAction}
          />

          <section className="space-y-3" aria-labelledby="profile-detail-assessment-heading">
            <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1" id="profile-detail-assessment-heading">
              <ProfileSectionHeader label="测评详情" />
              <span className="text-xs text-muted">默认收起；摘要卡「查看详情」会展开对应量表</span>
            </div>
            <AssessmentResultsSection
              viewer="teacher"
              data={detail}
              loading={false}
              failed={false}
              onRetry={() => undefined}
              expandedCodes={expandedCodes}
              onExpandedChange={(code, open) =>
                setExpandedCodes((previous) => (open ? [...new Set([...previous, code])] : previous.filter((item) => item !== code)))
              }
              highlightId={highlightId}
            />
            <p className="text-xs leading-relaxed text-muted">
              需要重测时，请该生登录后进入「职业测评」重新作答：每次提交都会生成新的当前报告，旧版本保留可查。
            </p>
          </section>

          {/* 档案资料（速览卡「档案资料」的定位锚点）：他人评价与词云（#162）保持现有能力 */}
          <section id={PROFILE_INFO_ID} className="space-y-3 scroll-mt-24">
            <ProfileSectionHeader label="档案资料 · 他人评价" />
            {(profile.evaluationTexts ?? []).filter((text) => text.trim()).length === 3 ? (
              <div className="space-y-3">
                <EvaluationWordCloud
                  words={profile.evaluationWords ?? []}
                  height={240}
                  emptyText="暂无可提取的关键词"
                />
                <EvaluationTexts texts={profile.evaluationTexts ?? []} collapsible={false} />
                {profile.evaluationUrl && (
                  <details>
                    <summary className="cursor-pointer select-none text-xs text-muted hover:text-foreground">
                      查看历史评价图片
                    </summary>
                    <StorageImage
                      url={profile.evaluationUrl}
                      storageId={profile.storageId}
                      alt=""
                      className="mt-2 w-full rounded-xl border border-gray-100"
                    />
                  </details>
                )}
              </div>
            ) : profile.evaluationUrl ? (
              <div className="space-y-1">
                <p className="text-xs text-muted">历史评价词云图片</p>
                <StorageImage
                  url={profile.evaluationUrl}
                  storageId={profile.storageId}
                  alt=""
                  className="w-full rounded-xl border border-gray-100"
                />
              </div>
            ) : (
              <p className="text-xs text-muted">该生还没有填写他人评价。</p>
            )}
          </section>

          {/* 版本历史（#95，教师端独有）：折叠展示，打开弹窗时已预取 */}
          <section className="space-y-2 border-t border-border-soft pt-3">
            <button
              type="button"
              onClick={() => setHistoryOpen((open) => !open)}
              aria-expanded={historyOpen}
              aria-controls="profile-version-history"
              className="flex w-full items-center justify-between text-sm font-semibold text-foreground"
            >
              <span>版本历史（{historyLoading ? "…" : historyFailed ? "暂时没取到" : historyRows.length}）</span>
              <span className="text-xs font-normal text-muted">{historyOpen ? "收起" : "展开"}</span>
            </button>
            {historyOpen && (
              <div id="profile-version-history" className="space-y-2">
                {historyLoading ? (
                  <p className="text-sm text-muted" role="status">
                    加载中...
                  </p>
                ) : historyFailed ? (
                  <p className="text-sm text-muted" role="status">
                    暂时没取到版本记录，稍后可以重新打开弹窗再看。
                  </p>
                ) : historyRows.length === 0 ? (
                  <p className="text-sm text-muted">暂无版本记录</p>
                ) : (
                  historyRows.map((row) => (
                    <div key={row.id} className="space-y-1.5 rounded-lg border border-border-soft p-2.5">
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-semibold text-foreground">版本 {row.version}</span>
                        {row.is_current === 1 ? (
                          <span className="rounded-full bg-green-50 px-1.5 py-0.5 text-[10px] font-medium text-green-600 dark:bg-green-900/30 dark:text-green-400">
                            当前
                          </span>
                        ) : (
                          <span className="rounded-full bg-gray-100 px-1.5 py-0.5 text-[10px] font-medium text-gray-500 dark:bg-gray-800 dark:text-gray-400">
                            历史
                          </span>
                        )}
                        <span className="ml-auto text-[10px] text-muted">{row.submitted_at}</span>
                      </div>
                      <div className="flex flex-wrap gap-1">
                        {row.tags.length === 0 ? (
                          <span className="text-[10px] text-muted">暂无标签</span>
                        ) : (
                          row.tags.map((tag) => (
                            <span
                              key={tag}
                              className={`rounded px-1.5 py-0.5 text-[10px] ${tagColors.get(tag) ?? FALLBACK_TAG_CLASS}`}
                            >
                              {tag}
                            </span>
                          ))
                        )}
                      </div>
                      {row.avatar_url && (
                        <StorageImage
                          url={row.avatar_url}
                          storageId={row.storage_id}
                          alt=""
                          className="h-8 w-8 rounded border border-border-soft object-cover"
                        />
                      )}
                      {(row.evaluation_texts ?? []).filter((text) => text.trim()).length === 3 ? (
                        <div className="space-y-1.5">
                          <EvaluationWordCloud words={row.evaluation_words ?? []} height={90} emptyText="暂无可提取的关键词" />
                          <EvaluationTexts texts={row.evaluation_texts ?? []} />
                        </div>
                      ) : row.evaluation_url ? (
                        <StorageImage
                          url={row.evaluation_url}
                          storageId={row.storage_id}
                          alt=""
                          className="h-8 w-14 rounded border border-border-soft object-cover"
                        />
                      ) : null}
                    </div>
                  ))
                )}
              </div>
            )}
          </section>

          {/* 授权与免责：与「测评中心 / 我的档案」同一份共享组件与文案，全弹窗只出现一次 */}
          <AssessmentAttributionCard
            scales={detail.attributionScales}
            careersAttribution={careers.attribution}
            collapsible
            defaultOpen={false}
          />
        </div>

        {/* sticky 底部：操作区 */}
        <footer className="sticky bottom-0 flex gap-2 border-t border-border-soft bg-card px-5 py-3">
          <button
            type="button"
            onClick={close}
            className="flex-1 rounded-lg bg-gray-100 py-2 text-sm font-medium text-gray-700 transition-colors hover:bg-gray-200 dark:bg-gray-800 dark:text-gray-200 dark:hover:bg-gray-700"
          >
            关闭
          </button>
          {canDelete && (
            <button
              type="button"
              onClick={onRequestDelete}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg bg-danger py-2 text-sm font-medium text-white transition-colors hover:bg-red-600"
            >
              <Trash2 size={14} aria-hidden />
              删除此记录
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}