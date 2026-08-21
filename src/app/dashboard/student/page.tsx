"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { Compass, SquarePen, X } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import StudentSidebar from "@/components/student/StudentSidebar";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import TagSelector, { type TagCategory, TAG_CHIP_COLORS } from "@/components/TagSelector";
import ImageUploadBox from "@/components/ImageUploadBox";
import { useSession } from "@/hooks/useSession";
import { safeImageUrl } from "@/lib/sanitize";

interface MyProfile {
  name: string;
  user_code: string;
  class_name: string;
  tags: string[];
  avatar_url: string;
  evaluation_url: string;
  submitted_at: string | null;
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
      <h2 className="text-sm font-semibold text-gray-800 dark:text-gray-100">{label}</h2>
      {done !== undefined && (
        <span
          className={`ml-auto px-2 py-0.5 rounded-full text-xs font-medium ${
            done
              ? "bg-green-50 text-green-600 dark:bg-green-900/30 dark:text-green-400"
              : "bg-gray-100 text-gray-400 dark:bg-gray-800 dark:text-gray-500"
          }`}
        >
          {done ? "✓ 已完成" : "待完成"}
        </span>
      )}
    </div>
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
  const [editTags, setEditTags] = useState<string[]>([]);
  // 延迟上传：选图只暂存 File，确认保存时才真正上传
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [evaluationFile, setEvaluationFile] = useState<File | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);

  // 通览态图片放大预览
  const [lightbox, setLightbox] = useState<string | null>(null);

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

  // 加载标签分类（展示态「我的标签」三色分组 + 编辑态复用）
  const loadCategories = useCallback(async () => {
    try {
      const res = await fetch("/api/tags");
      const data = await res.json();
      if (res.ok) setCategories(data.categories || []);
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
    if (!profile) return;
    // 预填学号，form/student 页首读该 key，免手输
    localStorage.setItem("career_demo_student_id", profile.user_code);
    router.push("/form/student");
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

  const confirmSave = async () => {
    setConfirming(false);
    setSaving(true);
    try {
      // 确认保存后才上传图片（取消编辑不产生任何服务端变更）
      const uploadImage = async (file: File, prefix: "avatar" | "evaluation"): Promise<string> => {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("prefix", prefix);
        formData.append("studentId", profile!.user_code);
        const res = await fetch("/api/upload", { method: "POST", body: formData });
        if (!res.ok) throw new Error("图片上传失败");
        const { url } = await res.json();
        return `${url}?t=${Date.now()}`;
      };

      const avatarUrl = avatarFile
        ? await uploadImage(avatarFile, "avatar")
        : profile!.avatar_url;
      const evaluationUrl = evaluationFile
        ? await uploadImage(evaluationFile, "evaluation")
        : profile!.evaluation_url;

      const res = await fetch("/api/shared/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tags: editTags,
          avatarUrl,
          evaluationUrl,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "保存失败");
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
        <p className="text-sm text-gray-400 dark:text-gray-500">加载中...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-background flex flex-col items-center justify-center px-4 gap-3">
        <p className="text-sm text-gray-400 dark:text-gray-500">档案加载失败</p>
        <button
          onClick={loadProfile}
          className="px-4 py-1.5 bg-primary hover:bg-primary-strong text-white text-sm rounded-lg"
        >
          重试
        </button>
      </div>
    );
  }

  const avatarPreview = safeImageUrl(profile.avatar_url);
  const evaluationPreview = safeImageUrl(profile.evaluation_url);

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
                  {/* 我的标签（按 API 分类分组三色） */}
                  <section className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
                    <SectionHeader label="我的标签" done={profile.tags.length > 0} />
                    {profile.tags.length === 0 ? (
                      <p className="text-sm text-gray-400 dark:text-gray-500">暂无标签</p>
                    ) : (
                      <div className="space-y-3">
                        {groupedTags
                          .filter((g) => g.tags.length > 0)
                          .map((g) => (
                            <div key={g.name}>
                              <p className="text-xs text-gray-400 dark:text-gray-500 mb-1.5">{g.name}</p>
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
                  <section className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
                    <SectionHeader label="评价词云" done={!!profile.evaluation_url} />
                    {evaluationPreview ? (
                      <img
                        src={evaluationPreview}
                        alt="评价词云"
                        onClick={() => setLightbox(evaluationPreview)}
                        className="w-full max-w-sm rounded-lg border border-gray-100 dark:border-gray-700 cursor-zoom-in"
                      />
                    ) : (
                      <p className="text-sm text-gray-400 dark:text-gray-500">暂无评价词云</p>
                    )}
                  </section>

                  <button
                    onClick={startEdit}
                    className="w-full py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
                  >
                    修改数据
                  </button>
                </>
              ) : (
                /* 从未提交：引导卡 */
                <div className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-8 text-center space-y-4">
                  <div className="w-14 h-14 bg-brand rounded-2xl flex items-center justify-center mx-auto">
                    <SquarePen className="w-7 h-7 text-accent" strokeWidth={2} />
                  </div>
                  <div>
                    <h2 className="text-base font-semibold text-gray-800 dark:text-gray-100">你还没有提交职业探索档案</h2>
                    <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">完成标签选择、头像与评价词云上传，让老师了解你的职业兴趣方向</p>
                  </div>
                  <button
                    onClick={goSubmit}
                    className="px-6 py-2.5 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-xl transition-colors"
                  >
                    去提交
                  </button>
                </div>
              )
            ) : (
              /* 编辑模式（hero 保留在顶部） */
              <div className="space-y-5">
                <section className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
                  <SectionHeader label="修改标签" />
                  {categories.length === 0 ? (
                    <p className="text-sm text-gray-400 py-4 text-center">标签加载中...</p>
                  ) : (
                    <TagSelector
                      categories={categories}
                      selectedTags={editTags}
                      onToggle={toggleTag}
                      onRemove={removeTag}
                    />
                  )}
                </section>

                <section className="bg-card rounded-xl border border-gray-100 dark:border-gray-700 p-5 space-y-4">
                  <SectionHeader label="头像与评价词云" />
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-6">
                    <div className="space-y-2">
                      <p className="text-xs text-gray-400">头像</p>
                      <ImageUploadBox
                        initialUrl={profile.avatar_url}
                        aspect="square"
                        emptyHint="点击上传头像"
                        onFileSelected={setAvatarFile}
                      />
                    </div>
                    <div className="space-y-2">
                      <p className="text-xs text-gray-400">评价词云</p>
                      <ImageUploadBox
                        initialUrl={profile.evaluation_url}
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
                    className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 disabled:opacity-50 text-gray-700 font-medium rounded-xl transition-colors"
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
