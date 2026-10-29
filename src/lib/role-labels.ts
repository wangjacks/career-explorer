import type { Role } from "@/lib/token";

/**
 * 角色中文标签单一来源（#329）。
 *
 * 演示横幅/切换器、用户菜单、审计日志与演示管理共用本表，避免各写一份导致
 * 文案漂移。`roleLabel` 对未知/缺失角色返回 undefined，由调用方保留原值兜底，
 * 与收口前的展示行为一致。
 */
export const ROLE_LABELS: Record<Role, string> = {
  admin: "管理员",
  teacher: "教师",
  student: "学生",
};

/** 角色 → 中文标签；未知或缺失角色返回 undefined，由调用方决定兜底 */
export function roleLabel(role: string | null | undefined): string | undefined {
  if (!role || !Object.hasOwn(ROLE_LABELS, role)) return undefined;
  return ROLE_LABELS[role as Role];
}
