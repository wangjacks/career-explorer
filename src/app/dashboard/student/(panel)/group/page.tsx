"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { useStudentProfileData } from "@/hooks/useStudentProfileData";
import { profileCompletion } from "@/lib/profile-completion";
import { TAG_CHIP_COLORS } from "@/components/TagSelector";
import StudentHero from "@/components/student/StudentHero";
import GroupPanel from "@/components/student/GroupPanel";
import type { GroupRoster } from "@/types/student-profile";

function PageLoading() {
  return (
    <div className="min-h-[40vh] flex items-center justify-center">
      <p className="text-sm text-muted">加载中...</p>
    </div>
  );
}

/** 学生面板「我的小组」（#361）：独立路由 `/dashboard/student/group`，每次进入重取自建分组结果 */
export default function StudentGroupPage() {
  const router = useRouter();
  const {
    profile,
    loading,
    loadFailed,
    categories,
    submissionClosed,
    submissionDeadline,
    reloadProfile,
  } = useStudentProfileData();

  const [group, setGroup] = useState<GroupRoster | null>(null);
  const [groupLoading, setGroupLoading] = useState(true);
  const [groupError, setGroupError] = useState<string | null>(null);

  // 我的小组（#101）：进入路由即取本组名单；老师可能在学生看页面期间已经分组或重新分组
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

  /* eslint-disable react-hooks/set-state-in-effect -- 路由页挂载即取小组名单 */
  useEffect(() => {
    void loadGroup();
  }, [loadGroup]);
  /* eslint-enable react-hooks/set-state-in-effect */

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

      <GroupPanel
        group={group}
        loading={groupLoading}
        error={groupError}
        tagColorMap={tagColorMap}
        onRetry={() => void loadGroup()}
      />
    </div>
  );
}
