"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import NavigationBar from "@/components/NavigationBar";
import ClassesTab from "@/components/admin/ClassesTab";
import StudentsTab from "@/components/admin/StudentsTab";
import { useSession } from "@/hooks/useSession";
import type { Student } from "@/hooks/useAdminAuth";

type Tab = "classes" | "students";

/** 教师面板：班级管理（仅可维护自己创建的班级）+ 学生管理（可管理所有班级学生） */
export default function TeacherDashboardPage() {
  const router = useRouter();
  const { session, checking } = useSession();
  const [activeTab, setActiveTab] = useState<Tab>("classes");
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsError, setStudentsError] = useState(false);

  // 教师面板不复用 useAdminAuth（其登录检测仅认 admin），直接拉取学生数据（teacher 已放行）
  const refreshStudents = useCallback(async () => {
    try {
      const res = await fetch("/api/admin/students");
      if (!res.ok) throw new Error("加载学生失败");
      const data = await res.json();
      setStudents(data.data || []);
      setStudentsError(false);
    } catch (err) {
      console.error("Failed to load students:", err);
      setStudentsError(true);
    }
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

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: "classes", label: "班级管理" },
    { key: "students", label: "学生管理", badge: `${students.length} 名` },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />
      <NavigationBar title="教师面板" showHome />

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          {/* Desktop: horizontal tabs */}
          <nav className="hidden md:flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-green-500 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
                {tab.badge && (
                  <span className="ml-2 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
          {/* Mobile: dropdown select */}
          <div className="flex md:hidden py-3">
            <select
              value={activeTab}
              onChange={(e) => setActiveTab(e.target.value as Tab)}
              className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm font-medium text-gray-700 bg-white focus:outline-none focus:ring-2 focus:ring-green-300"
            >
              {tabs.map((tab) => (
                <option key={tab.key} value={tab.key}>
                  {tab.label}
                  {tab.badge ? ` (${tab.badge})` : ""}
                </option>
              ))}
            </select>
          </div>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {activeTab === "classes" && <ClassesTab mode="teacher" teacherUid={session.uid} />}
        {activeTab === "students" && (
          <StudentsTab
            role="teacher"
            students={students}
            loadError={studentsError}
            onRetry={refreshStudents}
            onStudentsChanged={refreshStudents}
          />
        )}
      </main>
    </div>
  );
}
