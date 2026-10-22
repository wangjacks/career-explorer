"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster } from "sonner";
import { useSession } from "@/hooks/useSession";
import NavigationBar from "@/components/NavigationBar";
import DemoBanner from "@/components/DemoBanner";
import StudentSidebar from "@/components/student/StudentSidebar";
import {
  StudentPanelProvider,
  type StudentPanelContextValue,
} from "@/components/student/StudentPanelContext";

/**
 * 学生面板外壳（#361）：登录守卫、侧边栏与学生导航上下文。
 *
 * 路由组 `(panel)` 只包「我的档案 / 历史提交 / 我的小组」三个页面；职业测评中心与答题页
 * 留在组外（答题页是专注布局、不带侧边栏），继续自管页面壳。根路径仍是「我的档案」。
 */
export default function StudentPanelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const { session, checking } = useSession();

  const [sidebarOpen, setSidebarOpen] = useState(false);
  /* eslint-disable react-hooks/set-state-in-effect -- 桌面默认展开需挂载后按视口判断 */
  useEffect(() => {
    if (window.matchMedia("(min-width: 768px)").matches) setSidebarOpen(true);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // 编辑态守卫：由档案页注册，侧边栏与「历史提交」Link 跳转前询问
  const navGuardRef = useRef<(() => boolean) | null>(null);
  const canNavigate = useCallback(() => navGuardRef.current?.() ?? true, []);
  const setNavGuard = useCallback((guard: (() => boolean) | null) => {
    navGuardRef.current = guard;
  }, []);

  useEffect(() => {
    if (!checking && (!session || session.role !== "student")) {
      router.replace("/login");
    }
  }, [checking, session, router]);

  const contextValue = useMemo<StudentPanelContextValue>(
    () => ({ canNavigate, setNavGuard, sidebarOpen }),
    [canNavigate, setNavGuard, sidebarOpen]
  );

  if (!session || session.role !== "student") {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <p className="text-sm text-muted">加载中...</p>
      </div>
    );
  }

  return (
    <StudentPanelProvider value={contextValue}>
      <div className="min-h-screen bg-background">
        <Toaster position="top-center" />
        <NavigationBar title="学生面板" showHome onToggleSidebar={() => setSidebarOpen((v) => !v)} />
        <DemoBanner />

        {/* 注意：此 flex 容器不设任何 overflow，避免破坏侧边栏 sticky */}
        <div className="flex">
          <StudentSidebar
            open={sidebarOpen}
            onClose={() => setSidebarOpen(false)}
            canNavigate={canNavigate}
          />

          <main className="flex-1 min-w-0 px-4 sm:px-6 pt-6 pb-6 animate-[fade-in_0.2s_ease-out]">
            <div className="max-w-3xl mx-auto">{children}</div>
          </main>
        </div>
      </div>
    </StudentPanelProvider>
  );
}
