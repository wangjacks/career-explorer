"use client";

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { toast } from "sonner";
import { SquarePen, X } from "lucide-react";
import { useAssessmentResults } from "@/hooks/useAssessmentResults";
import { useFileUrl } from "@/hooks/useFileUrl";
import { useStudentProfileData } from "@/hooks/useStudentProfileData";
import { safeImageUrl } from "@/lib/sanitize";
import { submitProfile } from "@/lib/profile-submit";
import {
  EVALUATION_COUNT,
  MAX_EVALUATION_TEXT_LENGTH,
  extractEvaluationWords,
} from "@/lib/evaluation-text";
import { shouldRenderAssessmentResults } from "@/lib/assessment-view";
import { latestCompletedOf } from "@/lib/assessment-list";
import {
  assessmentCodeFromDetailId,
  buildProfileSummary,
  PROFILE_INFO_ID,
  type SummaryCard,
} from "@/lib/profile-summary";
import { profileCompletion } from "@/lib/profile-completion";
import { profileStickyAction } from "@/lib/profile-ui";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import TagSelector, { TAG_CHIP_COLORS } from "@/components/TagSelector";
import ImageUploadBox from "@/components/ImageUploadBox";
import EvaluationWordCloud from "@/components/EvaluationWordCloud";
import ProfileSectionHeader from "@/components/assessment/ProfileSectionHeader";
import AssessmentResultsSection from "@/components/assessment/AssessmentResultsSection";
import ProfileSummaryBoard from "@/components/assessment/ProfileSummaryBoard";
import AssessmentAttributionCard from "@/components/assessment/AssessmentAttributionCard";
import StudentHero from "@/components/student/StudentHero";
import ProfileOverviewCard from "@/components/student/ProfileOverviewCard";
import StudentPanelTabs from "@/components/student/StudentPanelTabs";
import { useStudentPanel } from "@/components/student/StudentPanelContext";

function ProfileLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <p className="text-sm text-muted">加载中...</p>
    </div>
  );
}

/** 学生面板「我的档案」（#361）：根路径即本页，历史提交是 `/history` 子路由 */
function StudentProfilePageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { canNavigate, setNavGuard, sidebarOpen } = useStudentPanel();
  const {
    profile,
    loading,
    loadFailed,
    categories,
    categoriesState,
    maxCustomTags,
    avatarMaxMb,
    submissionClosed,
    submissionDeadline,
    reloadProfile,
    reloadCategories,
  } = useStudentProfileData();

  // 测评数据（#323）：页面统一拉取一次，速览卡与折叠详情卡共用（不再由结果区自己 fetch）
  const assessment = useAssessmentResults(true);

  // 编辑模式状态
  const [editing, setEditing] = useState(false);
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

  // 速览卡「查看详情」的联动状态：受控展开 + 定位后短暂高亮。
  // 展开态用集合而不是单个 code——每张折叠卡各自独立，两套结果可以同时展开，这里不能退化成手风琴。
  const [expandedCodes, setExpandedCodes] = useState<string[]>([]);
  const [highlightId, setHighlightId] = useState<string | null>(null);
  const highlightTimer = useRef<number | null>(null);

  const avatarResolved = useFileUrl(profile?.avatar_url, profile?.storage_id);
  const evaluationResolved = useFileUrl(profile?.evaluation_url, profile?.storage_id);
  const avatarPreview = safeImageUrl(avatarResolved);
  const evaluationPreview = safeImageUrl(evaluationResolved);

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

  useEffect(() => {
    if (!lightbox) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setLightbox(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [lightbox]);

  // 折叠卡展开/收起（受控）：速览卡与卡片自身的折叠按钮改同一份状态
  const setCardOpen = useCallback(
    (code: string, open: boolean) => {
      setExpandedCodes((prev) =>
        open ? (prev.includes(code) ? prev : [...prev, code]) : prev.filter((item) => item !== code)
      );
    },
    []
  );

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
        submissionClosed,
        submissionDeadline,
      }),
    [profile, assessment.data, assessment.failed, submissionClosed, submissionDeadline]
  );

  // 测评区（速览四卡 + 结果详情 + 页尾授权）只在「我的档案」路由、非编辑态渲染（#344）：
  // 历史 / 小组路由与编辑态不挂载，避免无关结果卡挤占视图内容与填写干扰
  const showAssessmentResults = shouldRenderAssessmentResults("profile", editing);

  const startEdit = useCallback(async () => {
    if (!profile) return;
    // 直接深链 `?edit=1` 也要受截止门控：入口按钮虽已置灰，URL 仍可绕过
    if (submissionClosed) {
      toast.error("档案提交已截止，无法修改");
      return;
    }
    setEditTags(profile.tags);
    setAvatarFile(null);
    setEditEvaluations(
      profile.evaluation_texts?.length === EVALUATION_COUNT
        ? [...profile.evaluation_texts]
        : ["", "", ""]
    );
    setEditing(true);
    // 尚未就绪时等待加载（编辑态按状态显示加载/失败占位）；已就绪则后台刷新，
    // 顺带同步提交截止状态（#96）——#168 起面板内提交是唯一入口，不能让截止态陈旧
    if (categoriesState !== "ready") {
      const { ok } = await reloadCategories();
      if (!ok) toast.error("标签加载失败");
    } else {
      void reloadCategories();
    }
  }, [profile, submissionClosed, categoriesState, reloadCategories]);

  // 编辑态导航守卫（#361）：侧边栏 / 历史提交 Link 跳转前询问，避免一半输入丢失
  useEffect(() => {
    if (!editing) {
      setNavGuard(null);
      return;
    }
    setNavGuard(() => {
      toast("请先保存或取消当前编辑");
      return false;
    });
    return () => setNavGuard(null);
  }, [editing, setNavGuard]);

  // 历史 / 小组页 hero 的「修改」跳到 `?edit=1`（#361）：profile 就绪后自动进入编辑态并清掉查询参数
  const editQueryHandled = useRef(false);
  const editRequested = searchParams.get("edit") === "1";
  /* eslint-disable react-hooks/set-state-in-effect -- ?edit=1 深链需在 profile / 截止状态就绪后进入编辑态 */
  useEffect(() => {
    // 等标签接口回来再判截止态：否则可能先按旧状态打开编辑表单
    if (!editRequested || editQueryHandled.current || !profile || editing || categoriesState === "loading") {
      return;
    }
    editQueryHandled.current = true;
    router.replace("/dashboard/student", { scroll: false });
    if (submissionClosed) {
      toast.error("档案提交已截止，无法修改");
      return;
    }
    void startEdit();
  }, [editRequested, profile, editing, categoriesState, submissionClosed, router, startEdit]);
  /* eslint-enable react-hooks/set-state-in-effect */

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
        // 截止后速览卡的编辑入口已置灰（正常点不到）；这里再兜一层，避免状态过期时绕过门控
        if (cta.disabled) return;
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
    if (filledEditEvaluations !== 0 && filledEditEvaluations !== EVALUATION_COUNT) {
      toast.warning("请完整填写三条他人评价");
      return;
    }
    if (filledEditEvaluations === 0 && !profile?.evaluation_url) {
      toast.warning("请完整填写三条他人评价");
      return;
    }
    setCheckingDeadline(true);
    try {
      const { ok, closed } = await reloadCategories();
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
      await reloadProfile();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "保存失败");
    } finally {
      setSaving(false);
    }
  };

  if (!profile) {
    if (loading || !loadFailed) return <ProfileLoading />;
    return (
      <div className="min-h-[40vh] flex flex-col items-center justify-center gap-3">
        <p className="text-sm text-muted">档案加载失败</p>
        <button
          onClick={() => void reloadProfile()}
          className="px-4 py-1.5 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg"
        >
          重试
        </button>
      </div>
    );
  }

  // 档案完成度：兴趣标签 / 头像 / 他人评价（进度环 x/3；#322 与资料卡共用同一实现）
  const completion = profileCompletion(profile).filter((item) => item.done).length;
  // #324：移动端底部 sticky「修改数据」（已归档 + 非编辑；截止后置灰并给提示）
  const stickyAction = profileStickyAction({
    hasSubmitted,
    editing,
    activeView: "profile",
    sidebarOpen,
    submissionClosed,
    submissionDeadline,
  });

  return (
    <>
      <div
        className={`space-y-5 ${
          stickyAction.visible ? "pb-[calc(7rem_+_env(safe-area-inset-bottom))] sm:pb-0" : ""
        }`}
      >
        <StudentHero
          profile={profile}
          hasSubmitted={hasSubmitted}
          completion={completion}
          latestAssessment={latestAssessment}
          editing={editing}
          submissionClosed={submissionClosed}
          submissionDeadline={submissionDeadline}
          onEdit={startEdit}
        />

        {/* 速览四卡（#323）：hero 之下的结论区，点「查看详情」展开并滚动到对应内容；
            与测评结果区同范围（#344）：历史 / 小组路由与编辑态不挂载 */}
        {showAssessmentResults && (
          <ProfileSummaryBoard
            summary={summary}
            loading={assessment.loading}
            onAction={handleSummaryAction}
            tagColors={tagColorMap}
          />
        )}

        {/* 测评结果区（#224 + #292 + #322 + #323）：折叠详情，与速览共用同一份数据；
            只在「我的档案」路由、非编辑态渲染（#344）——不挂载就不会新增取数，仍不受提交截止门控、不进档案版本快照 */}
        {showAssessmentResults && (
          <AssessmentResultsSection
            data={assessment.data}
            loading={assessment.loading}
            failed={assessment.failed}
            onRetry={assessment.reload}
            expandedCodes={expandedCodes}
            onExpandedChange={setCardOpen}
            highlightId={highlightId}
          />
        )}

        {/* Tab 导航（#322 上移）：速览区之后、资料区之前，保证「历史提交」在 1 屏内可达 */}
        {!editing && hasSubmitted && (
          <StudentPanelTabs active="profile" canNavigate={canNavigate} />
        )}

        {!editing ? (
          hasSubmitted ? (
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
                <p className="text-xs text-warning-text">
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
              {categoriesState === "loading" ? (
                <p className="text-sm text-muted py-4 text-center">标签加载中...</p>
              ) : categoriesState === "failed" ? (
                <div className="py-4 text-center space-y-3">
                  <p className="text-sm text-danger-strong">标签加载失败，请检查网络后重试</p>
                  <button
                    type="button"
                    onClick={() => void reloadCategories()}
                    className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
                  >
                    重试
                  </button>
                </div>
              ) : (
                <TagSelector
                  categories={categories}
                  selectedTags={editTags}
                  onToggle={(tag) =>
                    setEditTags((prev) =>
                      prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]
                    )
                  }
                  onRemove={(tag) => setEditTags((prev) => prev.filter((t) => t !== tag))}
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
              <p className="text-xs text-warning-text text-center">
                档案提交已于 {submissionDeadline} 截止，无法保存
              </p>
            )}
          </div>
        )}

        {/* 页尾授权与免责（#322）：全页只出现一次，结果卡内只留指针；与测评结果区同范围（#344） */}
        {showAssessmentResults && assessment.data.scales.length > 0 && (
          <AssessmentAttributionCard
            collapsible
            scales={assessment.data.scales}
            careersAttribution={assessment.data.careersAttribution}
          />
        )}
      </div>

      {/* 移动端底部 sticky「修改数据」（#324）：始终可达、不遮挡内容（主区已留底部 padding），
          截止后置灰并显示截止时间；桌面端仍用 hero / 资料卡内的入口 */}
      {stickyAction.visible && (
        <div
          className="fixed inset-x-0 bottom-0 z-40 border-t border-border-soft bg-card/95 px-4 pt-3 backdrop-blur sm:hidden"
          style={{ paddingBottom: "calc(0.75rem + env(safe-area-inset-bottom))" }}
        >
          <button
            type="button"
            onClick={startEdit}
            disabled={stickyAction.disabled}
            className="w-full rounded-xl bg-primary py-3 font-medium text-white transition-colors hover:bg-primary-strong disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring focus-visible:ring-offset-2"
          >
            {stickyAction.disabled ? "提交已截止" : "修改数据"}
          </button>
          {stickyAction.hint && (
            <p className="mt-1 text-center text-[11px] leading-snug text-warning-text">
              {stickyAction.hint}
            </p>
          )}
        </div>
      )}

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
    </>
  );
}

export default function StudentProfilePage() {
  return (
    <Suspense fallback={<ProfileLoading />}>
      <StudentProfilePageContent />
    </Suspense>
  );
}
