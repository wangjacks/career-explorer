"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import NavigationBar from "@/components/NavigationBar";
import ClassesTab from "@/components/admin/ClassesTab";
import StudentsTab from "@/components/admin/StudentsTab";
import TeacherHomeTab from "@/components/admin/TeacherHomeTab";
import OverviewTab from "@/components/admin/OverviewTab";
import ProfilesTab from "@/components/admin/ProfilesTab";
import DashboardTab from "@/components/admin/DashboardTab";
import ExportTab from "@/components/admin/ExportTab";
import TagsTab from "@/components/admin/TagsTab";
import { useSession } from "@/hooks/useSession";
import type { Student, Stats, PagedData } from "@/hooks/useAdminAuth";

type Tab = "home" | "overview" | "dashboard" | "export" | "profiles" | "students" | "classes" | "tags";
type TabGroup = "home" | "data" | "manage";

/** 教师面板：主页 + 数据中心（概览/大屏/导出）+ 数据管理（数据列表/学生/班级/标签） */
export default function TeacherDashboardPage() {
  const router = useRouter();
  const { session, checking } = useSession();

  const [activeGroup, setActiveGroup] = useState<TabGroup>("home");
  const [activeTab, setActiveTab] = useState<Tab>("home");
  // 记录各组最后停留的子 Tab，切回时恢复
  const lastTabOfGroup = useRef<Partial<Record<TabGroup, Tab>>>({});

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
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  const TAB_GROUPS: { key: TabGroup; label: string; tabs: { key: Tab; label: string; badge?: string }[] }[] = [
    {
      key: "home",
      label: "主页",
      tabs: [{ key: "home", label: "主页" }],
    },
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
      key: "manage",
      label: "数据管理",
      tabs: [
        { key: "profiles", label: "数据列表" },
        { key: "students", label: "学生管理", badge: `${students.length} 名` },
        { key: "classes", label: "班级管理" },
        { key: "tags", label: "标签管理" },
      ],
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
      <NavigationBar title="教师面板" showHome />

      {/* Tab Navigation：一级分组 + 二级子 Tab（移动端与桌面端同款两级按钮） */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-4 sm:gap-6">
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
            <nav className="flex flex-wrap gap-3 sm:gap-4 border-t border-gray-50">
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
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
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
      </main>
    </div>
  );
}
