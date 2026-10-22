"use client";

import { createContext, useContext } from "react";

/**
 * 学生面板上下文（#361）：layout 持有导航守卫，档案页在编辑态注册拦截函数，
 * 侧边栏与「历史提交」Link 跳转前统一询问——编辑中的一半输入不会因为误点 Tab 而丢失。
 */
export interface StudentPanelContextValue {
  /** 返回 false 表示当前页有未保存编辑，调用方应阻止跳转 */
  canNavigate: () => boolean;
  /** 注册 / 注销导航守卫；传 null 表示解除 */
  setNavGuard: (guard: (() => boolean) | null) => void;
  /** 移动端侧边抽屉是否打开：底部 sticky 操作条据此让位 */
  sidebarOpen: boolean;
  /** 「我的小组」未读公告数（#346）：侧边栏红点；小组页标记已读后清零 */
  groupUnread: number;
  setGroupUnread: (count: number) => void;
}

const StudentPanelContext = createContext<StudentPanelContextValue | null>(null);

export function StudentPanelProvider({
  value,
  children,
}: {
  value: StudentPanelContextValue;
  children: React.ReactNode;
}) {
  return <StudentPanelContext.Provider value={value}>{children}</StudentPanelContext.Provider>;
}

/** 只能在 `dashboard/student/(panel)/layout.tsx` 的 Provider 内使用 */
export function useStudentPanel(): StudentPanelContextValue {
  const value = useContext(StudentPanelContext);
  if (!value) {
    throw new Error("useStudentPanel must be used inside StudentPanelProvider");
  }
  return value;
}
