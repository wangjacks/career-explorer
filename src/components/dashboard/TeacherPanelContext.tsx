"use client";

import { createContext, useContext } from "react";
import type { SessionInfo } from "@/hooks/useSession";
import type { PagedData, Stats, Student } from "@/hooks/useAdminAuth";
import type { ProfileListQuery } from "@/lib/profile-query";
import type { PanelSidebarGroup } from "@/components/dashboard/PanelSidebar";

/**
 * 教师面板共享上下文（#361）：会话、侧边栏导航、学生名单与 stats / profiles loader
 * 由 `teacher/layout.tsx` 统一持有，供「主页」「数据概览」「学生管理」路由页复用。
 */
export interface TeacherPanelContextValue {
  session: SessionInfo;
  navGroups: PanelSidebarGroup[];
  students: Student[];
  studentsError: boolean;
  loadStats: () => Promise<Stats | null>;
  loadProfiles: (page: number, query?: ProfileListQuery) => Promise<PagedData | null>;
  refreshStudents: () => Promise<void>;
}

const TeacherPanelContext = createContext<TeacherPanelContextValue | null>(null);

export function TeacherPanelProvider({
  value,
  children,
}: {
  value: TeacherPanelContextValue;
  children: React.ReactNode;
}) {
  return <TeacherPanelContext.Provider value={value}>{children}</TeacherPanelContext.Provider>;
}

/** 只能在 `teacher/layout.tsx` 的 Provider 内使用 */
export function useTeacherPanel(): TeacherPanelContextValue {
  const value = useContext(TeacherPanelContext);
  if (!value) {
    throw new Error("useTeacherPanel must be used inside TeacherPanelProvider");
  }
  return value;
}
