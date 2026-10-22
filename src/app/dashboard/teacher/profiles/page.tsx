"use client";

import ProfilesTab from "@/components/admin/ProfilesTab";
import { useTeacherPanel } from "@/components/dashboard/TeacherPanelContext";

/** 教师面板「数据列表」（#361） */
export default function TeacherProfilesPage() {
  const { session } = useTeacherPanel();

  return <ProfilesTab mode="teacher" teacherUid={session.uid} />;
}
