"use client";

import { useMemo } from "react";
import { useRouter } from "next/navigation";
import { useStudentProfileData } from "@/hooks/useStudentProfileData";
import { useStudentPanel } from "@/components/student/StudentPanelContext";
import { profileCompletion } from "@/lib/profile-completion";
import { TAG_CHIP_COLORS } from "@/components/TagSelector";
import StudentHero from "@/components/student/StudentHero";
import GroupPanel from "@/components/student/GroupPanel";

function PageLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <p className="text-sm text-muted">加载中...</p>
    </div>
  );
}

/**
 * 学生面板「我的小组」（#361 / #346）：独立路由 `/dashboard/student/group`。
 * 组内数据由 GroupPanel 自己加载（每次进入重取），本页只负责外壳与标签配色；
 * 标记已读后通过面板上下文清零侧边栏红点。
 */
export default function StudentGroupPage() {
  const router = useRouter();
  const { profile, loading, loadFailed, categories, submissionClosed, submissionDeadline, reloadProfile } =
    useStudentProfileData();
  const { setGroupUnread } = useStudentPanel();

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

      <GroupPanel tagColorMap={tagColorMap} onUnreadChange={setGroupUnread} />
    </div>
  );
}
