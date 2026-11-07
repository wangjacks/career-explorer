"use client";

import { useRouter } from "next/navigation";
import OverviewTab from "@/components/admin/OverviewTab";
import { useTeacherPanel } from "@/components/dashboard/TeacherPanelContext";
import { panelPath } from "@/lib/panel-nav";

/** 教师面板「数据概览」（#361） */
export default function TeacherOverviewPage() {
  const router = useRouter();
  const { students, loadStats, loadProfiles } = useTeacherPanel();

  return (
    <OverviewTab
      installed={true}
      loadStats={loadStats}
      loadProfiles={loadProfiles}
      students={students}
      showProfiles={false}
      mode="teacher"
      onNavigate={(key) => {
        const path = panelPath("teacher", key);
        if (path) router.push(path);
      }}
    />
  );
}
