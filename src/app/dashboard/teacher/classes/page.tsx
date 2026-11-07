"use client";

import ClassesTab from "@/components/admin/ClassesTab";
import { useTeacherPanel } from "@/components/dashboard/TeacherPanelContext";

/** 教师面板「班级管理」（#361） */
export default function TeacherClassesPage() {
  const { session } = useTeacherPanel();

  return <ClassesTab mode="teacher" teacherUid={session.uid} />;
}
