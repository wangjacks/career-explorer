"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { Compass, SquarePen, X } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import StudentSidebar from "@/components/student/StudentSidebar";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import TagSelector, { type TagCategory, TAG_CHIP_COLORS } from "@/components/TagSelector";
import ImageUploadBox from "@/components/ImageUploadBox";
import { useSession } from "@/hooks/useSession";
import { useFileUrl } from "@/hooks/useFileUrl";
import { safeImageUrl } from "@/lib/sanitize";
import { submitProfile } from "@/lib/profile-submit";
import { toThumbnailUrl } from "@/lib/thumbnail-utils";

interface MyProfile {
  name: string;
  user_code: string;
  class_name: string;
  tags: string[];
  avatar_url: string;
  evaluation_url: string;
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
  storage_id: number;
  submitted_at: string;
  is_current: number;
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

/** 分区小标（eyebrow）：琥珀竖条为纯装饰（琥珀不承载小字）；done 省略则不显示角标 */
function SectionHeader({ label, done }: { label: string; done?: boolean }) {
  return (
    <div className="flex items-center gap-2">
      <span className="w-1 h-4 rounded-full bg-accent" aria-hidden />
      <h2 className="text-sm font-semibold text-foreground">{label}</h2>
      {done !== undefined && (
        <span
          className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
            done
              ? "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
              : "bg-gray-100 text-muted dark:bg-gray-800"
          }`}
        >
          {done ? "✓ 已完成" : "待完成"}
        </span>
      )}
    </div>
  );
}

/** 历史版本条目（#95）：版本号 + 时间 + 当前标记 + 快照详情（标签/头像/词云）+ 恢复按钮 */
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
      {(avatarPreview || evaluationPreview) && (
        <div className="flex gap-2">
          {avatarPreview && (
            <img
              src={avatarPreview}
              alt={`版本 ${submission.version} 头像`}
              onError={() => setAvatarThumbFailed(true)}
              className="w-12 h-12 rounded-lg object-cover border border-border-soft"
            />
          )}
          {evaluationPreview && (
            <img
              src={evaluationPreview}
              alt={`版本 ${submission.version} 评价词云`}
              onError={() => setEvaluationThumbFailed(true)}
              className="h-12 w-20 rounded-lg object-cover border border-border-soft"
            />
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
  // 提交时限（#96）：截止后禁用修改/提交入口，服务端状态为准（经 /api/tags 下发）
  const [submissionClosed, setSubmissionClosed] = useState(false);
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  // 延迟上传：选图只暂存 File，确认保存时才真正上传
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [evaluationFile, setEvaluationFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // 通览态图片放大预览
  const [lightbox, setLightbox] = useState<string | null>(null);

  // 历史提交版本（#95）：独立 Tab，首次切入时懒加载；恢复生成新版本不回写旧记录
  const [activeView, setActiveView] = useState<"profile" | "history">("profile");
  const [historySubmissions, setHistorySubmissions] = useState<SubmissionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
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
  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/tags");
      const data = await res.json();
      if (res.ok) {
        setCategories(data.categories || []);
        setMaxCustomTags(typeof data.maxCustomTags === "number" ? data.maxCustomTags : undefined);
        setSubmissionClosed(data.submissionClosed === true);
        setSubmissionDeadline(typeof data.submissionDeadline === "string" ? data.submissionDeadline : null);
      }
    } catch (err) {
      console.error("Failed to load tags:", err);
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

  const goSubmit = () => {
    router.push("/form/create-profile");
  };

  const startEdit = async () => {
    if (!profile) return;
    setEditTags(profile.tags);
    setAvatarFile(null);
    setEvaluationFile(null);
    setEditing(true);
    if (categories.length > 0) return;
    try {
      const res = await fetch("/api/tags");
      const data = await res.json();
      if (res.ok) setCategories(data.categories || []);
    } catch (err) {
      console.error("Failed to load tags:", err);
      toast.error("标签加载失败");
    }
  };

  const toggleTag = (tag: string) => {
    setEditTags((prev) => (prev.includes(tag) ? prev.filter((t) => t !== tag) : [...prev, tag]));
  };

  const removeTag = (tag: string) => {
    setEditTags((prev) => prev.filter((t) => t !== tag));
  };

  const requestSave = () => {
    if (editTags.length === 0) {
      toast.warning("请至少选择一个标签");
      return;
    }
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

  const switchView = (view: "profile" | "history") => {
    setActiveView(view);
    if (view === "history" && historySubmissions.length === 0 && !historyLoading) {
      void loadHistory();
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
      // 确认保存后才上传图片（取消编辑不产生任何服务端变更）；与档案创建确认页共用提交工具
      await submitProfile({
        studentId: profile!.user_code,
        tags: editTags,
        avatarFile,
        evaluationFile,
        existingAvatarUrl: profile!.avatar_url,
        existingEvaluationUrl: profile!.evaluation_url,
      });
      toast.success("修改已保存");
      setEditing(false);
      setAvatarFile(null);
      setEvaluationFile(null);
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

  // 档案完成度：兴趣标签 / 头像 / 评价词云（进度环 x/3）
  const completion =
    (profile.tags.length > 0 ? 1 : 0) +
    (profile.avatar_url ? 1 : 0) +
    (profile.evaluation_url ? 1 : 0);

  // 标签按 API 返回的 categories 动态分组（组标题 category.name，三色循环）；未匹配任何分类的兜底单列
  const groupedTags = categories.map((cat, catIdx) => ({
    name: cat.name,
    color: TAG_CHIP_COLORS[catIdx % TAG_CHIP_COLORS.length],
    tags: cat.tags.filter((t) => profile.tags.includes(t.name)).map((t) => t.name),
  }));
  const groupedNames = new Set(groupedTags.flatMap((g) => g.tags));
  const ungrouped = profile.tags.filter((t) => !groupedNames.has(t));

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title="学生面板" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />

      {/* 注意：此 flex 容器不设任何 overflow，避免破坏侧边栏 sticky */}
      <div className="flex">
        <StudentSidebar open={sidebarOpen} onClose={() => setSidebarOpen(false)} />

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 animate-[fade-in_0.2s_ease-out]">
          <div className="max-w-3xl mx-auto space-y-5">
            {/* Hero：深绿品牌区——头像 + 身份 + 状态印章 + 罗盘进度环 */}
            <section className="bg-brand rounded-2xl p-5 sm:p-6 shadow-sm">
              <div className="flex items-center gap-4 sm:gap-5">
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
                    {profile.submitted_at && (
                      <span className="text-xs text-white/60">提交于 {profile.submitted_at}</span>
                    )}
                  </div>
                </div>
                <ProgressRing completion={completion} />
              </div>
            </section>

            {!editing ? (
              hasSubmitted ? (
                <>
                  {/* Tab 导航：我的档案 / 历史提交（#95） */}
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

                  {activeView === "profile" ? (
                    <>
                      {/* 我的标签（按 API 分类分组三色） */}
                      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                        <SectionHeader label="我的标签" done={profile.tags.length > 0} />
                        {profile.tags.length === 0 ? (
                          <p className="text-sm text-muted">暂无标签</p>
                        ) : (
                          <div className="space-y-3">
                            {groupedTags
                              .filter((g) => g.tags.length > 0)
                              .map((g) => (
                                <div key={g.name}>
                                  <p className="text-xs text-muted mb-1.5">{g.name}</p>
                                  <div className="flex flex-wrap gap-1.5">
                                    {g.tags.map((tag) => (
                                      <span key={tag} className={`px-2.5 py-1 rounded-full text-xs ${g.color}`}>
                                        {tag}
                                      </span>
                                    ))}
                                  </div>
                                </div>
                              ))}
                            {ungrouped.length > 0 && (
                              <div className="flex flex-wrap gap-1.5">
                                {ungrouped.map((tag) => (
                                  <span key={tag} className={`px-2.5 py-1 rounded-full text-xs ${TAG_CHIP_COLORS[0]}`}>
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            )}
                          </div>
                        )}
                      </section>

                      {/* 评价词云（预览可放大） */}
                      <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                        <SectionHeader label="评价词云" done={!!profile.evaluation_url} />
                        {evaluationPreview ? (
                          <img
                            src={evaluationPreview}
                            alt="评价词云"
                            onClick={() => setLightbox(evaluationPreview)}
                            className="w-full max-w-sm rounded-lg border border-border-soft cursor-zoom-in"
                          />
                        ) : (
                          <p className="text-sm text-muted">暂无评价词云</p>
                        )}
                      </section>

                      <button
                        onClick={startEdit}
                        disabled={submissionClosed}
                        className="w-full py-3 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
                      >
                        修改数据
                      </button>
                      {submissionClosed && (
                        <p className="text-xs text-amber-600 dark:text-amber-400 text-center">
                          档案提交已于 {submissionDeadline} 截止，无法再修改
                        </p>
                      )}
                    </>
                  ) : (
                    /* 历史提交（#95）：独立 Tab，恢复按钮截止后隐藏 */
                    <section className="bg-card rounded-xl border border-border-soft p-5 space-y-4">
                      <SectionHeader label="历史提交" />
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
                  )}
                </>
              ) : (
                /* 从未提交：引导卡 */
                <div className="bg-card rounded-xl border border-border-soft p-8 text-center space-y-4">
                  <div className="w-14 h-14 bg-brand rounded-2xl flex items-center justify-center mx-auto">
                    <SquarePen className="w-7 h-7 text-accent" strokeWidth={2} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-foreground">你还没有提交职业探索档案</h2>
                    <p className="text-sm text-muted mt-1">完成标签选择、头像与评价词云上传，让老师了解你的职业兴趣方向</p>
                  </div>
                  <button
                    onClick={goSubmit}
                    disabled={submissionClosed}
                    className="px-6 py-2.5 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    去提交
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
                  <SectionHeader label="修改标签" />
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
                  <SectionHeader label="头像与评价词云" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-xs text-muted">头像</p>
                      <ImageUploadBox
                        initialUrl={avatarPreview ?? undefined}
                        aspect="square"
                        emptyHint="点击上传头像"
                        onFileSelected={setAvatarFile}
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-muted">评价词云</p>
                      <ImageUploadBox
                        initialUrl={evaluationPreview ?? undefined}
                        aspect="wide"
                        emptyHint="点击上传评价词云"
                        onFileSelected={setEvaluationFile}
                      />
                    </div>
                  </div>
                </section>

                <div className="flex gap-3">
                  <button
                    onClick={() => setEditing(false)}
                    disabled={saving}
                    className="flex-1 py-3 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 disabled:opacity-50 text-gray-700 dark:text-gray-200 font-medium rounded-xl transition-colors"
                  >
                    取消
                  </button>
                  <button
                    onClick={requestSave}
                    disabled={saving}
                    className="flex-1 py-3 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
                  >
                    {saving ? "保存中..." : "保存修改"}
                  </button>
                </div>
              </div>
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
        title="确认修改"
        variant="warning"
        confirmText="确认保存"
        message="保存后将覆盖你已提交的档案数据（标签、头像、评价词云），确定继续吗？"
        onConfirm={confirmSave}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
