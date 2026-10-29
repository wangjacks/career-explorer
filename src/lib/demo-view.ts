/**
 * 演示视图模型（#256）：面板路径与切换目标。
 * 仓库无 DOM 测试环境，界面逻辑先落这里再做组件（同 assessment-view 约定）。
 * 角色中文标签统一取自 `role-labels`（#329），此处不再定义。
 */
import type { Role } from "@/lib/token";
import { ROLE_LABELS } from "./role-labels";

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
