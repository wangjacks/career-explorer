"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import {
  BarChart3,
  Download,
  GraduationCap,
  Home,
  MonitorPlay,
  School,
  SlidersHorizontal,
  Table,
  Tags,
  Users,
} from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import PanelSidebar, { type PanelSidebarGroup } from "@/components/dashboard/PanelSidebar";
import ClassesTab from "@/components/admin/ClassesTab";
import StudentsTab from "@/components/admin/StudentsTab";
import TeacherHomeTab from "@/components/admin/TeacherHomeTab";
import OverviewTab from "@/components/admin/OverviewTab";
import ProfilesTab from "@/components/admin/ProfilesTab";
import DashboardTab from "@/components/admin/DashboardTab";
import ExportTab from "@/components/admin/ExportTab";
import TagsTab from "@/components/admin/TagsTab";
import ProfileConfigTab from "@/components/admin/ProfileConfigTab";
import { useSession } from "@/hooks/useSession";
import type { Student, Stats, PagedData } from "@/hooks/useAdminAuth";

type Tab = "home" | "overview" | "dashboard" | "export" | "profiles" | "students" | "classes" | "tags" | "profile-config";

/** 教师面板：分组侧边栏导航（主页 + 数据中心 + 数据管理） */
export default function TeacherDashboardPage() {
  const router = useRouter();
  const { session, checking } = useSession();

  const [activeTab, setActiveTab] = useState<Tab>("home");
  // 侧边栏：初始收起，挂载后按视口宽度决定桌面默认展开（避免 hydration 不一致）
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

  const loadProfiles = useCallback(async (p: number): Promise<PagedData | null> => {
    try {
      const res = await fetch(`/api/manage/profiles?page=${p}`);
      if (res.ok) return await res.json();
    } catch (err) {
      console.error("Failed to load profiles:", err);
    }
    return null;
  }, []);

  useEffect(() => {
    if (!checking && (!session || session.role !== "teacher")) {
      router.replace("/login");
    }
  }, [checking, session, router]);

  /* eslint-disable react-hooks/set-state-in-effect -- load students once teacher session confirmed */
  useEffect(() => {
    if (!checking && session?.role === "teacher") {
      refreshStudents();
    }
  }, [checking, session, refreshStudents]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (checking || !session || session.role !== "teacher") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-gray-400 dark:text-gray-500">加载中...</p>
      </div>
    );
  }

  const MENU_GROUPS: PanelSidebarGroup[] = [
    {
      items: [{ key: "home", label: "主页", icon: Home }],
    },
    {
      label: "数据中心",
      items: [
        { key: "overview", label: "数据概览", icon: BarChart3 },
        { key: "dashboard", label: "数据大屏", icon: MonitorPlay },
        { key: "export", label: "数据导出", icon: Download },
      ],
    },
    {
      label: "数据管理",
      items: [
        { key: "profiles", label: "数据列表", icon: Table },
        {
          key: "students",
          label: "学生管理",
          icon: Users,
          badge: students.length > 0 ? `${students.length} 名` : undefined,
        },
        { key: "classes", label: "班级管理", icon: School },
        { key: "tags", label: "标签管理", icon: Tags },
      ],
    },
    {
      label: "系统设置",
      items: [{ key: "profile-config", label: "功能设置", icon: SlidersHorizontal }],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title="教师面板" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />

      {/* 注意：此 flex 容器不设任何 overflow，避免破坏侧边栏 sticky */}
      <div className="flex">
        <PanelSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          role={{ icon: GraduationCap, label: "教师", sub: session.name }}
          groups={MENU_GROUPS}
          activeKey={activeTab}
          onSelect={(key) => setActiveTab(key as Tab)}
        />

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 animate-[fade-in_0.2s_ease-out]">
          <div className="max-w-6xl mx-auto space-y-8">
            {activeTab === "home" && <TeacherHomeTab teacherName={session.name} students={students} />}

            {activeTab === "overview" && (
              <OverviewTab
                installed={true}
                loadStats={loadStats}
                loadProfiles={loadProfiles}
                students={students}
                showProfiles={false}
              />
            )}

            {activeTab === "dashboard" && <DashboardTab />}

            {activeTab === "export" && <ExportTab />}

            {activeTab === "profiles" && <ProfilesTab />}

            {activeTab === "students" && (
              <StudentsTab
                role="teacher"
                students={students}
                loadError={studentsError}
                onRetry={refreshStudents}
                onStudentsChanged={refreshStudents}
              />
            )}

            {activeTab === "classes" && <ClassesTab mode="teacher" teacherUid={session.uid} />}

            {activeTab === "tags" && <TagsTab />}

            {activeTab === "profile-config" && <ProfileConfigTab />}
          </div>
        </main>
      </div>
    </div>
  );
}
