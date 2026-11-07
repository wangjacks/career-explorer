"use client";

import SettingsTab from "@/components/admin/SettingsTab";
import { useAdminPanel } from "@/components/dashboard/AdminPanelContext";

/** 管理面板「数据源设置」（#361） */
export default function AdminSettingsPage() {
  const { dbConfig, settingsError, refreshSettings, onConfigSaved } = useAdminPanel();

  return (
    <SettingsTab
      dbConfig={dbConfig}
      loadError={settingsError}
      onRetry={refreshSettings}
      onConfigSaved={onConfigSaved}
    />
  );
}
