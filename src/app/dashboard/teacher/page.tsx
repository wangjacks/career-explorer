"use client";

import { useRouter } from "next/navigation";
import TeacherHomeTab from "@/components/admin/TeacherHomeTab";
import { useTeacherPanel } from "@/components/dashboard/TeacherPanelContext";
import { panelPath } from "@/lib/panel-nav";

/** 教师面板「主页」（#361）：根路径即主页，快捷入口跳到对应 Tab 路由 */
export default function TeacherHomePage() {
  const router = useRouter();
  const { session, navGroups } = useTeacherPanel();

  return (
    <TeacherHomeTab
      teacherName={session.name}
      groups={navGroups}
      onNavigate={(key) => {
        const path = panelPath("teacher", key);
        if (path) router.push(path);
      }}
    />
  );
}
