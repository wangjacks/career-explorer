"use client";

import OverviewTab from "@/components/admin/OverviewTab";
import { useAdminPanel } from "@/components/dashboard/AdminPanelContext";

/** 管理面板「数据概览」（#361）：数据与鉴权由 `admin/layout.tsx` 提供 */
export default function AdminOverviewPage() {
  const { installed, loadStats, loadProfiles, students } = useAdminPanel();

  return (
    <OverviewTab
      installed={installed}
      loadStats={loadStats}
      loadProfiles={loadProfiles}
      students={students}
    />
  );
}
