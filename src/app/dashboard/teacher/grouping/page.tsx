"use client";

import GroupingTab from "@/components/admin/GroupingTab";
import { useTeacherPanel } from "@/components/dashboard/TeacherPanelContext";

/** 教师面板「课堂分组」（#361） */
export default function TeacherGroupingPage() {
  const { session } = useTeacherPanel();

  return <GroupingTab mode="teacher" teacherUid={session.uid} />;
}
