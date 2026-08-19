"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-sm text-gray-400">加载中...</p>
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
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />

      <NavigationBar title="后台管理" showHome />

      {/* Tab Navigation：一级分组 + 二级子 Tab */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          {/* Desktop: group tabs + sub tabs */}
          <div className="hidden md:block">
            <nav className="flex gap-6">
              {TAB_GROUPS.map((group) => (
                <button
                  key={group.key}
                  onClick={() => switchGroup(group.key)}
                  className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                    activeGroup === group.key
                      ? "border-green-500 text-green-600"
                      : "border-transparent text-gray-500 hover:text-gray-700"
                  }`}
                >
                  {group.label}
                </button>
              ))}
            </nav>
            {currentGroup.tabs.length > 1 && (
              <nav className="flex gap-4 border-t border-gray-50">
                {currentGroup.tabs.map((tab) => (
                  <button
                    key={tab.key}
                    onClick={() => setActiveTab(tab.key)}
                    className={`py-2 text-xs font-medium border-b-2 transition-colors ${
                      activeTab === tab.key
                        ? "border-green-500 text-green-600"
                        : "border-transparent text-gray-400 hover:text-gray-600"
                    }`}
                  >
                    {tab.label}
                    {tab.badge && (
                      <span className="ml-1.5 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-[10px]">
                        {tab.badge}
                      </span>
                    )}
                  </button>
                ))}
              </nav>
            )}
          </div>
          {/* Mobile: grouped dropdown select */}
          <div className="flex md:hidden py-3">
            <select
              value={`${activeGroup}:${activeTab}`}
              onChange={(e) => {
                const [group, tab] = e.target.value.split(":");
                setActiveGroup(group as TabGroup);
                setActiveTab(tab as Tab);
              }}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-green-300"
            >
              {TAB_GROUPS.map((group) => (
                <optgroup key={group.key} label={group.label}>
                  {group.tabs.map((tab) => (
                    <option key={tab.key} value={`${group.key}:${tab.key}`}>
                      {tab.label}
                      {tab.badge ? ` (${tab.badge})` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Not Installed Banner */}
        {installed === false && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
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
