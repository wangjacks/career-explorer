"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { useStudentProfileData } from "@/hooks/useStudentProfileData";
import { profileCompletion } from "@/lib/profile-completion";
import { TAG_CHIP_COLORS } from "@/components/TagSelector";
import { useStudentPanel } from "@/components/student/StudentPanelContext";
import StudentHero from "@/components/student/StudentHero";
import StudentPanelTabs from "@/components/student/StudentPanelTabs";
import HistoryList from "@/components/student/HistoryList";
import type { SubmissionHistoryItem } from "@/types/student-profile";

function PageLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <p className="text-sm text-muted">加载中...</p>
    </div>
  );
}

/** 学生面板「历史提交」（#361）：独立路由 `/dashboard/student/history`，侧边栏仍高亮「我的档案」 */
export default function StudentHistoryPage() {
  const router = useRouter();
  const { canNavigate } = useStudentPanel();
  const {
    profile,
    loading,
    loadFailed,
    categories,
    submissionClosed,
    submissionDeadline,
    reloadProfile,
  } = useStudentProfileData();

  const [submissions, setSubmissions] = useState<SubmissionHistoryItem[]>([]);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [restoringId, setRestoringId] = useState<number | null>(null);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const res = await fetch("/api/shared/profile/submissions");
      const data = await res.json();
      if (res.ok) {
        setSubmissions(data.submissions || []);
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

  /* eslint-disable react-hooks/set-state-in-effect -- 路由页挂载即取历史；数据与档案页互不阻塞 */
  useEffect(() => {
    void loadHistory();
  }, [loadHistory]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 从未提交就没有历史版本：直接回档案页，避免出现一个永远空着的路由
  useEffect(() => {
    if (!loading && profile && !profile.submitted_at) {
      router.replace("/dashboard/student");
    }
  }, [loading, profile, router]);

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
      await reloadProfile();
      await loadHistory();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "恢复失败");
    } finally {
      setRestoringId(null);
    }
  };

  const tagColorMap = useMemo(() => {
    const map = new Map<string, string>();
    categories.forEach((cat, catIdx) => {
      const color = TAG_CHIP_COLORS[catIdx % TAG_CHIP_COLORS.length];
      cat.tags.forEach((t) => map.set(t.name, color));
    });
    return map;
  }, [categories]);

  if (!profile) {
    if (loading || !loadFailed) return <PageLoading />;
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

  const hasSubmitted = !!profile.submitted_at;
  const completion = profileCompletion(profile).filter((item) => item.done).length;

  if (!hasSubmitted) return <PageLoading />;

  return (
    <div className="space-y-5">
      <StudentHero
        profile={profile}
        hasSubmitted={hasSubmitted}
        completion={completion}
        editing={false}
        submissionClosed={submissionClosed}
        submissionDeadline={submissionDeadline}
        onEdit={() => router.push("/dashboard/student?edit=1")}
      />

      <StudentPanelTabs active="history" canNavigate={canNavigate} />

      <HistoryList
        submissions={submissions}
        loading={historyLoading}
        restoringId={restoringId}
        closed={submissionClosed}
        tagColorMap={tagColorMap}
        onRestore={restoreVersion}
      />
    </div>
  );
}
