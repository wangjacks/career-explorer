"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { TriangleAlert } from "lucide-react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import type { DbConfig, Student } from "@/hooks/useAdminAuth";
import OverviewTab from "@/components/admin/OverviewTab";
import SettingsTab from "@/components/admin/SettingsTab";
import StudentsTab from "@/components/admin/StudentsTab";
import ExportTab from "@/components/admin/ExportTab";
import DashboardTab from "@/components/admin/DashboardTab";
import NavigationBar from "@/components/NavigationBar";
import TagsTab from "@/components/admin/TagsTab";
import ClassesTab from "@/components/admin/ClassesTab";
import TeachersTab from "@/components/admin/TeachersTab";

type Tab = "overview" | "dashboard" | "settings" | "students" | "classes" | "teachers" | "export" | "tags";
type TabGroup = "data" | "users" | "system";

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

  const [activeGroup, setActiveGroup] = useState<TabGroup>("data");
  const [activeTab, setActiveTab] = useState<Tab>("overview");
  // 记录各组最后停留的子 Tab，切回时恢复
  const lastTabOfGroup = useRef<Partial<Record<TabGroup, Tab>>>({});
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
          setActiveGroup("system");
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

  // 两级导航：一级分组（数据中心/用户管理/系统设置）+ 组内子 Tab
  const TAB_GROUPS: { key: TabGroup; label: string; tabs: { key: Tab; label: string; badge?: string }[] }[] = [
    {
      key: "data",
      label: "数据中心",
      tabs: [
        { key: "overview", label: "数据概览" },
        { key: "dashboard", label: "数据大屏" },
        { key: "export", label: "数据导出" },
      ],
    },
    {
      key: "users",
      label: "用户管理",
      tabs: [
        { key: "students", label: "学生管理", badge: `${students.length} 名` },
        { key: "teachers", label: "教师管理" },
        { key: "classes", label: "班级管理" },
        { key: "tags", label: "标签管理" },
      ],
    },
    {
      key: "system",
      label: "系统设置",
      tabs: [{ key: "settings", label: "数据源设置" }],
    },
  ];

  const currentGroup = TAB_GROUPS.find((g) => g.key === activeGroup) ?? TAB_GROUPS[0];

  const switchGroup = (group: TabGroup) => {
    if (group === activeGroup) return;
    lastTabOfGroup.current[activeGroup] = activeTab;
    setActiveGroup(group);
    const target = TAB_GROUPS.find((g) => g.key === group);
    if (target) {
      setActiveTab(lastTabOfGroup.current[group] ?? target.tabs[0].key);
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />

      <NavigationBar title="后台管理" showHome />

      {/* Tab Navigation：一级分组 + 二级子 Tab（移动端与桌面端同款两级按钮） */}
      <div className="bg-card border-b border-gray-100 dark:border-gray-700">
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-4 sm:gap-6">
            {TAB_GROUPS.map((group) => (
              <button
                key={group.key}
                onClick={() => switchGroup(group.key)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeGroup === group.key
                    ? "border-primary text-primary-strong dark:text-green-400"
                    : "border-transparent text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                }`}
              >
                {group.label}
              </button>
            ))}
          </nav>
          {currentGroup.tabs.length > 1 && (
            <nav className="flex flex-wrap gap-3 sm:gap-4 border-t border-gray-50 dark:border-gray-700/50">
              {currentGroup.tabs.map((tab) => (
                <button
                  key={tab.key}
                  onClick={() => setActiveTab(tab.key)}
                  className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                    activeTab === tab.key
                      ? "border-primary text-primary-strong dark:text-green-400"
                      : "border-transparent text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                  }`}
                >
                  {tab.label}
                  {tab.badge && (
                    <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 rounded text-[10px]">
                      {tab.badge}
                    </span>
                  )}
                </button>
              ))}
            </nav>
          )}
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
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
      </main>
    </div>
  );
}
