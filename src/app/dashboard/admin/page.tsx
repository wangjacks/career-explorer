"use client";

import { useState, useEffect, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import {
  BarChart3,
  Database,
  Download,
  GraduationCap,
  MonitorPlay,
  School,
  ShieldCheck,
  SlidersHorizontal,
  Tags,
  TriangleAlert,
  Users,
} from "lucide-react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import type { DbConfig, Student } from "@/hooks/useAdminAuth";
import OverviewTab from "@/components/admin/OverviewTab";
import SettingsTab from "@/components/admin/SettingsTab";
import StudentsTab from "@/components/admin/StudentsTab";
import ExportTab from "@/components/admin/ExportTab";
import DashboardTab from "@/components/admin/DashboardTab";
import NavigationBar from "@/components/NavigationBar";
import PanelSidebar, { type PanelSidebarGroup } from "@/components/dashboard/PanelSidebar";
import TagsTab from "@/components/admin/TagsTab";
import ClassesTab from "@/components/admin/ClassesTab";
import TeachersTab from "@/components/admin/TeachersTab";
import ProfileConfigTab from "@/components/admin/ProfileConfigTab";

type Tab = "overview" | "dashboard" | "settings" | "students" | "classes" | "teachers" | "export" | "tags" | "profile-config";

/** 管理面板：分组侧边栏导航（数据中心 + 用户管理 + 系统设置） */
export default function AdminPage() {
  const router = useRouter();
  const {
    loggedIn,
    installed,
    setInstalled,
    loadStats,
    loadProfiles,
    loadSettings,
    loadStudents,
    initAfterLogin,
  } = useAdminAuth();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  // 侧边栏：初始收起，挂载后按视口宽度决定桌面默认展开（避免 hydration 不一致）
  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- 桌面默认展开需挂载后按视口判断 */
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsError, setStudentsError] = useState(false);
  const [settingsError, setSettingsError] = useState(false);

  const refreshStudents = useCallback(async () => {
    const data = await loadStudents();
    if (data !== null) {
      setStudents(data);
      setStudentsError(false);
    } else {
      setStudentsError(true);
    }
  }, [loadStudents]);

  const refreshSettings = useCallback(async () => {
    const data = await loadSettings();
    if (data) {
      setDbConfig(data);
      setSettingsError(false);
    } else {
      setSettingsError(true);
    }
  }, [loadSettings]);

  /* eslint-disable react-hooks/set-state-in-effect -- init after login */
  useEffect(() => {
    if (loggedIn) {
      refreshSettings();
      initAfterLogin().then((isInstalled) => {
        if (!isInstalled) {
          setActiveTab("settings");
        } else {
          refreshStudents();
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on login only
  }, [loggedIn]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 未登录（或非管理员）：统一跳转登录页（内嵌登录已退役）
  useEffect(() => {
    if (loggedIn === false) {
      router.replace("/login");
    }
  }, [loggedIn, router]);

  const onConfigSaved = async () => {
    setInstalled(true);
    await refreshSettings();
    await loadStats();
    await loadProfiles(1);
    await refreshStudents();
  };

  // 会话检测中 / 正在重定向到登录页：显示 loading 避免闪屏
  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-gray-400 dark:text-gray-500">加载中...</p>
      </div>
    );
  }

  const MENU_GROUPS: PanelSidebarGroup[] = [
    {
      label: "数据中心",
      items: [
        { key: "overview", label: "数据概览", icon: BarChart3 },
        { key: "dashboard", label: "数据大屏", icon: MonitorPlay },
        { key: "export", label: "数据导出", icon: Download },
      ],
    },
    {
      label: "用户管理",
      items: [
        {
          key: "students",
          label: "学生管理",
          icon: Users,
          badge: students.length > 0 ? `${students.length} 名` : undefined,
        },
        { key: "teachers", label: "教师管理", icon: GraduationCap },
        { key: "classes", label: "班级管理", icon: School },
        { key: "tags", label: "标签管理", icon: Tags },
      ],
    },
    {
      label: "系统设置",
      items: [
        { key: "settings", label: "数据源设置", icon: Database },
        { key: "profile-config", label: "功能设置", icon: SlidersHorizontal },
      ],
    },
  ];

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />

      <NavigationBar title="后台管理" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />

      {/* 注意：此 flex 容器不设任何 overflow，避免破坏侧边栏 sticky */}
      <div className="flex">
        <PanelSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          role={{ icon: ShieldCheck, label: "管理员" }}
          groups={MENU_GROUPS}
          activeKey={activeTab}
          onSelect={(key) => setActiveTab(key as Tab)}
        />

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 animate-[fade-in_0.2s_ease-out]">
          <div className="max-w-6xl mx-auto space-y-8">
            {/* Not Installed Banner */}
            {installed === false && (
              <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
                <TriangleAlert className="w-5 h-5 text-amber-600 flex-shrink-0" />
                <p className="text-sm text-amber-800">数据库未配置，请先在「数据源设置」中完成配置</p>
              </div>
            )}

            {activeTab === "overview" && (
              <OverviewTab
                installed={installed}
                loadStats={loadStats}
                loadProfiles={loadProfiles}
                students={students}
              />
            )}

            {activeTab === "dashboard" && (
              <DashboardTab />
            )}

            {activeTab === "settings" && (
              <SettingsTab
                dbConfig={dbConfig}
                loadError={settingsError}
                onRetry={refreshSettings}
                onConfigSaved={onConfigSaved}
              />
            )}

            {activeTab === "students" && (
              <StudentsTab
                students={students}
                loadError={studentsError}
                onRetry={refreshStudents}
                onStudentsChanged={refreshStudents}
              />
            )}

            {activeTab === "classes" && (
              <ClassesTab mode="admin" />
            )}

            {activeTab === "teachers" && (
              <TeachersTab />
            )}

            {activeTab === "export" && (
              <ExportTab />
            )}

            {activeTab === "tags" && (
              <TagsTab />
            )}

            {activeTab === "profile-config" && (
              <ProfileConfigTab />
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
