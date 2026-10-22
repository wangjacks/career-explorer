"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { ShieldCheck, TriangleAlert } from "lucide-react";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import type { DbConfig, Student } from "@/hooks/useAdminAuth";
import NavigationBar from "@/components/NavigationBar";
import DemoBanner from "@/components/DemoBanner";
import PanelSidebar from "@/components/dashboard/PanelSidebar";
import { buildPanelGroups } from "@/components/dashboard/panel-nav-view";
import { AdminPanelProvider, type AdminPanelContextValue } from "@/components/dashboard/AdminPanelContext";
import { isDemoHiddenTab } from "@/lib/demo-admin";
import {
  ADMIN_NAV_ITEMS,
  ADMIN_ROOT_PATH,
  panelNavItems,
  panelPath,
  resolvePanelKey,
} from "@/lib/panel-nav";

/**
 * 管理面板外壳（#361）：登录守卫、侧边栏、共享数据与安装提示。
 *
 * Tab 是独立路由（`/dashboard/admin/<tab>`，根路径 = 数据概览），刷新 / 深链都停在当前 Tab；
 * 本 layout 在路由切换时保持挂载，学生人数、安装状态与数据源设置只拉一次。
 */
export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const {
    loggedIn,
    demo,
    installed,
    setInstalled,
    loadStats,
    loadProfiles,
    loadSettings,
    loadStudents,
    initAfterLogin,
  } = useAdminAuth();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- 桌面默认展开需挂载后按视口判断 */
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [studentsError, setStudentsError] = useState(false);
  const [settingsError, setSettingsError] = useState(false);

  const refreshStudents = useCallback(async () => {
    const data = await loadStudents();
    if (data !== null) {
      setStudents(data);
      setStudentsError(false);
    } else {
      setStudentsError(true);
    }
  }, [loadStudents]);

  const refreshSettings = useCallback(async () => {
    const data = await loadSettings();
    if (data) {
      setDbConfig(data);
      setSettingsError(false);
    } else {
      setSettingsError(true);
    }
  }, [loadSettings]);

  /* eslint-disable react-hooks/set-state-in-effect -- init after login */
  useEffect(() => {
    if (!loggedIn) return;
    // demo-admin 无权读 settings（#274），也不必被未安装态导向已隐藏的数据源设置
    if (!demo) refreshSettings();
    initAfterLogin().then((isInstalled) => {
      if (!isInstalled) {
        if (!demo) router.replace(`${ADMIN_ROOT_PATH}/settings`);
      } else {
        refreshStudents();
      }
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on login only
  }, [loggedIn]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 未登录（或非管理员）：统一跳转登录页（内嵌登录已退役）
  useEffect(() => {
    if (loggedIn === false) {
      router.replace("/login");
    }
  }, [loggedIn, router]);

  const activeKey = resolvePanelKey(pathname, ADMIN_NAV_ITEMS);

  // 直接输入 URL 也要守住两类不可达 Tab：demo 隐藏项、未安装时的非设置页
  useEffect(() => {
    if (loggedIn !== true) return;
    if (demo && isDemoHiddenTab(activeKey)) {
      router.replace(ADMIN_ROOT_PATH);
      return;
    }
    if (installed === false && !demo && activeKey !== "settings") {
      router.replace(`${ADMIN_ROOT_PATH}/settings`);
    }
  }, [loggedIn, demo, installed, activeKey, router]);

  const onConfigSaved = useCallback(async () => {
    setInstalled(true);
    await refreshSettings();
    await loadStats();
    await loadProfiles(1);
    await refreshStudents();
  }, [setInstalled, refreshSettings, loadStats, loadProfiles, refreshStudents]);

  const menuGroups = useMemo(() => {
    const hiddenKeys = demo
      ? new Set(
          panelNavItems("admin")
            .filter((item) => isDemoHiddenTab(item.key))
            .map((item) => item.key)
        )
      : undefined;
    return buildPanelGroups(panelNavItems("admin"), {
      badges: { students: students.length > 0 ? `${students.length} 名` : undefined },
      hiddenKeys,
    });
  }, [demo, students.length]);

  const contextValue = useMemo<AdminPanelContextValue>(
    () => ({
      demo,
      installed,
      students,
      studentsError,
      dbConfig,
      settingsError,
      loadStats,
      loadProfiles,
      refreshStudents,
      refreshSettings,
      onConfigSaved,
    }),
    [
      demo,
      installed,
      students,
      studentsError,
      dbConfig,
      settingsError,
      loadStats,
      loadProfiles,
      refreshStudents,
      refreshSettings,
      onConfigSaved,
    ]
  );

  // 会话检测中 / 正在重定向到登录页：显示 loading 避免闪屏
  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-muted">加载中...</p>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <Toaster position="top-center" />

      <NavigationBar title="后台管理" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />
      <DemoBanner />

      {/* 注意：此 flex 容器不设任何 overflow，避免破坏侧边栏 sticky */}
      <div className="flex">
        <PanelSidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          role={{ icon: ShieldCheck, label: "管理员" }}
          groups={menuGroups}
          activeKey={activeKey}
          onSelect={(key) => {
            const path = panelPath("admin", key);
            if (path) router.push(path);
          }}
        />

        <main className="flex-1 min-w-0 px-4 sm:px-6 py-6 animate-[fade-in_0.2s_ease-out]">
          <div className="max-w-6xl mx-auto space-y-8">
            {/* Not Installed Banner（demo 会话无权进数据源设置，不提示） */}
            {installed === false && !demo && (
              <div className="bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 rounded-xl p-4 flex items-center gap-3">
                <TriangleAlert className="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0" />
                <p className="text-sm text-amber-800 dark:text-amber-300">数据库未配置，请先在「数据源设置」中完成配置</p>
              </div>
            )}

            <AdminPanelProvider value={contextValue}>{children}</AdminPanelProvider>
          </div>
        </main>
      </div>
    </div>
  );
}
