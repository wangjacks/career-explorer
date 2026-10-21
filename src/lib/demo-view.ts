/**
 * 演示视图模型（#256）：角色标签、面板路径与切换目标。
 * 仓库无 DOM 测试环境，界面逻辑先落这里再做组件（同 assessment-view 约定）。
 */
import type { Role } from "@/lib/token";

export const ROLE_LABELS: Record<Role, string> = {
  admin: "管理员",
  teacher: "教师",
  student: "学生",
};

export const ROLE_DASHBOARD: Record<Role, string> = {
  admin: "/dashboard/admin",
  teacher: "/dashboard/teacher",
  student: "/dashboard/student",
};

const ROLE_ORDER: readonly Role[] = ["admin", "teacher", "student"];

/** 仅服务端下发的 demo 标志为 true 时视为演示会话（生产会话恒 false） */
export function isDemoSession(session: { demo?: boolean } | null | undefined): boolean {
  return session?.demo === true;
}

/** 可切换目标：除当前角色外的其余角色，顺序固定 admin → teacher → student */
export function demoSwitchTargets(currentRole: string): { role: Role; label: string }[] {
  return ROLE_ORDER.filter((role) => role !== currentRole).map((role) => ({
    role,
    label: ROLE_LABELS[role],
  }));
}
