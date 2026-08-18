"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import NavigationBar from "@/components/NavigationBar";
import ClassesTab from "@/components/admin/ClassesTab";
import { useSession } from "@/hooks/useSession";

/** 教师面板：班级管理（教师可创建班级，仅可维护自己创建的班级） */
export default function TeacherDashboardPage() {
  const router = useRouter();
  const { session, checking } = useSession();

  useEffect(() => {
    if (!checking && (!session || session.role !== "teacher")) {
      router.replace("/login");
    }
  }, [checking, session, router]);

  if (checking || !session || session.role !== "teacher") {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <p className="text-sm text-gray-400">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />
      <NavigationBar title="班级管理" showHome />
      <main className="max-w-6xl mx-auto px-6 py-8">
        <ClassesTab mode="teacher" teacherUid={session.uid} />
      </main>
    </div>
  );
}
