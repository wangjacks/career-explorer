"use client";

import { createContext, useContext } from "react";
import type { DbConfig, PagedData, Stats, Student } from "@/hooks/useAdminAuth";
import type { ProfileListQuery } from "@/lib/profile-query";

/**
 * 管理面板共享上下文（#361）：登录守卫、学生名单、数据源设置上提到 `admin/layout.tsx`，
 * 「数据概览」「学生管理」「数据源设置」三个路由页从这里取同一份数据，避免各自重复拉取。
 */
export interface AdminPanelContextValue {
  /** 演示会话：菜单按 DEMO_ALLOWED 隐藏，部分 Tab 不可直达 */
  demo: boolean;
  installed: boolean | null;
  students: Student[];
  studentsError: boolean;
  dbConfig: DbConfig | null;
  settingsError: boolean;
  loadStats: () => Promise<Stats | null>;
  loadProfiles: (page: number, query?: ProfileListQuery) => Promise<PagedData | null>;
  refreshStudents: () => Promise<void>;
  refreshSettings: () => Promise<void>;
  /** 数据源保存成功后的统一刷新（安装状态 / 设置 / 统计 / 档案首屏 / 学生数） */
  onConfigSaved: () => Promise<void>;
}

const AdminPanelContext = createContext<AdminPanelContextValue | null>(null);

export function AdminPanelProvider({
  value,
  children,
}: {
  value: AdminPanelContextValue;
  children: React.ReactNode;
}) {
  return <AdminPanelContext.Provider value={value}>{children}</AdminPanelContext.Provider>;
}

/** 只能在 `admin/layout.tsx` 的 Provider 内使用；越界使用直接抛错，避免静默拿空数据 */
export function useAdminPanel(): AdminPanelContextValue {
  const value = useContext(AdminPanelContext);
  if (!value) {
    throw new Error("useAdminPanel must be used inside AdminPanelProvider");
  }
  return value;
}
