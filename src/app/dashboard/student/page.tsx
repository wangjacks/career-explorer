"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import NavigationBar from "@/components/NavigationBar";
import ConfirmDialog from "@/components/admin/ConfirmDialog";
import TagSelector, { type TagCategory } from "@/components/TagSelector";
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

function StatusBadge({ done }: { done: boolean }) {
  return done ? (
    <span className="px-2 py-0.5 bg-green-50 text-green-600 rounded-full text-xs font-medium">已提交</span>
  ) : (
    <span className="px-2 py-0.5 bg-gray-100 text-gray-400 rounded-full text-xs font-medium">未提交</span>
  );
}

/** 学生面板：信息通览 + 就地修改（不跳转表单流程） */
export default function StudentDashboardPage() {
  const router = useRouter();
  const { session, checking } = useSession();

  const [profile, setProfile] = useState<MyProfile | null>(null);
  const [loading, setLoading] = useState(true);

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
      const res = await fetch("/api/profile");
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

  /* eslint-disable react-hooks/set-state-in-effect -- load profile after session check */
  useEffect(() => {
    if (session?.role === "student") {
      loadProfile();
    }
  }, [session, loadProfile]);
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

      const res = await fetch("/api/profile", {
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  if (!profile) {
    return (
      <div className="min-h-screen bg-gray-50 flex flex-col items-center justify-center px-4 gap-3">
        <p className="text-sm text-gray-400">档案加载失败</p>
        <button
          onClick={loadProfile}
          className="px-4 py-1.5 bg-green-500 hover:bg-green-600 text-white text-sm rounded-lg"
        >
          重试
        </button>
      </div>
    );
  }

  const avatarPreview = safeImageUrl(profile.avatar_url);
  const evaluationPreview = safeImageUrl(profile.evaluation_url);

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />
      <NavigationBar title="学生面板" showHome />

      <main className="max-w-3xl mx-auto px-4 sm:px-6 py-8 space-y-6">
        {/* 个人信息卡 */}
        <div className="bg-white rounded-xl border border-gray-100 p-5">
          <div className="flex items-center gap-4">
            {avatarPreview ? (
              <img
                src={avatarPreview}
                alt="头像"
                onClick={() => setLightbox(avatarPreview)}
                className="w-14 h-14 rounded-full object-cover border border-gray-200 cursor-zoom-in"
              />
            ) : (
              <div className="w-14 h-14 rounded-full bg-green-100 flex items-center justify-center text-green-600 font-bold text-lg">
                {profile.name.slice(0, 1)}
              </div>
            )}
            <div>
              <h1 className="text-lg font-bold text-gray-900">{profile.name}</h1>
              <p className="text-sm text-gray-400 font-mono">{profile.user_code}</p>
            </div>
            <span className="ml-auto px-3 py-1 bg-blue-50 text-blue-600 rounded-full text-sm">
              {profile.class_name}
            </span>
          </div>
        </div>

        {!editing ? (
          <>
            {hasSubmitted ? (
              <>
                {/* 提交状态卡 */}
                <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
                  <div className="flex items-center justify-between">
                    <h2 className="text-sm font-semibold text-gray-800">提交状态</h2>
                    <span className="text-xs text-gray-400">提交于 {profile.submitted_at}</span>
                  </div>
                  <div className="space-y-3 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">兴趣标签</span>
                      <StatusBadge done={profile.tags.length > 0} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">头像</span>
                      <StatusBadge done={!!profile.avatar_url} />
                    </div>
                    <div className="flex items-center justify-between">
                      <span className="text-gray-600">评价词云</span>
                      <StatusBadge done={!!profile.evaluation_url} />
                    </div>
                  </div>

                  {/* 内容预览 */}
                  {profile.tags.length > 0 && (
                    <div className="pt-2 border-t border-gray-50">
                      <p className="text-xs text-gray-400 mb-2">我的标签</p>
                      <div className="flex flex-wrap gap-1.5">
                        {profile.tags.map((tag) => (
                          <span key={tag} className="px-2.5 py-1 bg-green-50 text-green-700 rounded-full text-xs">
                            {tag}
                          </span>
                        ))}
                      </div>
                    </div>
                  )}
                  {evaluationPreview && (
                    <div className="pt-2 border-t border-gray-50">
                      <p className="text-xs text-gray-400 mb-2">评价词云（点击放大）</p>
                      <img
                        src={evaluationPreview}
                        alt="评价词云"
                        onClick={() => setLightbox(evaluationPreview)}
                        className="w-full max-w-sm rounded-lg border border-gray-100 cursor-zoom-in"
                      />
                    </div>
                  )}
                </div>

                <button
                  onClick={startEdit}
                  className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
                >
                  修改数据
                </button>
              </>
            ) : (
              /* 从未提交：引导卡 */
              <div className="bg-white rounded-xl border border-gray-100 p-8 text-center space-y-4">
                <div className="w-14 h-14 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
                  <svg className="w-7 h-7 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                  </svg>
                </div>
                <div>
                  <h2 className="text-base font-semibold text-gray-800">你还没有提交职业探索档案</h2>
                  <p className="text-sm text-gray-500 mt-1">完成标签选择、头像与评价词云上传，让老师了解你的职业兴趣方向</p>
                </div>
                <button
                  onClick={goSubmit}
                  className="px-6 py-2.5 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-xl transition-colors"
                >
                  去提交
                </button>
              </div>
            )}
          </>
        ) : (
          /* 编辑模式 */
          <div className="space-y-6">
            <div className="bg-white rounded-xl border border-gray-100 p-5 space-y-4">
              <h2 className="text-sm font-semibold text-gray-800">修改标签</h2>
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
            </div>

            <div className="bg-white rounded-xl border border-gray-100 p-5">
              <h2 className="text-sm font-semibold text-gray-800 mb-4">修改头像与评价词云</h2>
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
            </div>

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
                className="flex-1 py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
              >
                {saving ? "保存中..." : "保存修改"}
              </button>
            </div>
          </div>
        )}
      </main>

      {/* 图片放大预览（点击遮罩 / × / Esc 关闭）；z-[100] 高于全局 UserMenu(z-60)，避免关闭按钮被遮挡 */}
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
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
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
