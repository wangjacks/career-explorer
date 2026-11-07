"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { GraduationCap } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import type { PagedData, Stats, Student } from "@/hooks/useAdminAuth";
import { buildProfilesQueryString, type ProfileListQuery } from "@/lib/profile-query";
import NavigationBar from "@/components/NavigationBar";
import DemoBanner from "@/components/DemoBanner";
import PanelSidebar from "@/components/dashboard/PanelSidebar";
import { buildPanelGroups } from "@/components/dashboard/panel-nav-view";
import { TeacherPanelProvider, type TeacherPanelContextValue } from "@/components/dashboard/TeacherPanelContext";
import { TEACHER_NAV_ITEMS, panelPath, resolvePanelKey } from "@/lib/panel-nav";

/**
 * 教师面板外壳（#361）：登录守卫、侧边栏与学生名单上提到 layout，
 * 每个 Tab 是独立路由（根路径 = 主页），路由切换时外壳保持挂载、不重复拉名单。
 */
export default function TeacherLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, checking } = useSession();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- 桌面默认展开需挂载后按视口判断 */
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [students, setStudents] = useState<Student[]>([]);
  const [studentsError, setStudentsError] = useState(false);

  // 教师面板不复用 useAdminAuth（其登录检测仅认 admin），直接拉取数据（teacher 已放行）
  const refreshStudents = useCallback(async () => {
    try {
      const res = await fetch("/api/manage/students");
      if (!res.ok) throw new Error("加载学生失败");
      const data = await res.json();
      setStudents(data.data || []);
      setStudentsError(false);
    } catch (err) {
      console.error("Failed to load students:", err);
      setStudentsError(true);
    }
  }, []);

  const loadStats = useCallback(async (): Promise<Stats | null> => {
    try {
      const res = await fetch("/api/manage/stats");
      if (res.ok) return await res.json();
    } catch (err) {
      console.error("Failed to load stats:", err);
    }
    return null;
  }, []);

  const loadProfiles = useCallback(
    async (p: number, query?: ProfileListQuery): Promise<PagedData | null> => {
      try {
        const res = await fetch(`/api/manage/profiles?${buildProfilesQueryString(p, query)}`);
        if (res.ok) return await res.json();
        // #295：非 2xx 必须提示，否则表格停留在上一次结果，教师会以为筛选已生效
        const data = (await res.json().catch(() => null)) as { error?: string } | null;
        toast.error(data?.error ?? "档案列表加载失败，请调整筛选条件后重试");
      } catch (err) {
        console.error("Failed to load profiles:", err);
      }
      return null;
    },
    []
  );

  useEffect(() => {
    if (!checking && (!session || session.role !== "teacher")) {
      router.replace("/login");
    }
  }, [checking, session, router]);

  const sessionRole = session?.role;
  const sessionUid = session?.uid;

  /* eslint-disable react-hooks/set-state-in-effect -- load students once teacher session confirmed */
  useEffect(() => {
    if (sessionRole === "teacher") {
      refreshStudents();
    }
    // pathname 变化会让 useSession 重新校验，但这里只按角色 / uid 变化重取名单
  }, [sessionRole, sessionUid, refreshStudents]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const activeKey = resolvePanelKey(pathname, TEACHER_NAV_ITEMS);

  const navGroups = useMemo(
    () =>
      buildPanelGroups(TEACHER_NAV_ITEMS, {
        badges: { students: students.length > 0 ? `${students.length} 名` : undefined },
      }),
    [students.length]
  );

  const contextValue = useMemo<TeacherPanelContextValue | null>(() => {
    if (!session || session.role !== "teacher") return null;
    return {
      session,
      navGroups,
      students,
      studentsError,
      loadStats,
      loadProfiles,
      refreshStudents,
    };
  }, [session, navGroups, students, studentsError, loadStats, loadProfiles, refreshStudents]);

  if (!contextValue) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-muted">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title="教师面板" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <DemoBanner />

      {/* 注意：此 flex 容器不设任何 overflow，避免破坏侧边栏 sticky */}
      <div className="flex">
        <PanelSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          role={{ icon: GraduationCap, label: "教师", sub: contextValue.session.name }}
          groups={navGroups}
          activeKey={activeKey}
          onSelect={(key) => {
            const path = panelPath("teacher", key);
            if (path) router.push(path);
          }}
        />

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 animate-[fade-in_0.2s_ease-out]">
          <div className="max-w-6xl mx-auto space-y-8">
            <TeacherPanelProvider value={contextValue}>{children}</TeacherPanelProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
