import type { Role } from "@/lib/token";

/**
 * 各角色登录后的默认落点。
 *
 * 单一来源（#317）：登录页与首页「开始探索」CTA 共用本表，避免「登录后去哪」和
 * 「首页按钮去哪」两处各写一份而漂移。`role-home.test.ts` 钉住两个页面都从这里取值。
 */
export const ROLE_HOME: Record<Role, string> = {
  admin: "/dashboard/admin",
  teacher: "/dashboard/teacher",
  student: "/dashboard/student",
};

/** 角色 → 落点；缺失或未知角色返回 undefined，由调用方决定兜底 */
export function roleHome(role: string | null | undefined): string | undefined {
  if (role === "admin" || role === "teacher" || role === "student") {
    return ROLE_HOME[role];
  }
  return undefined;
}

/** 会话判定的最小输入：`verifyToken` 返回值的结构子集（`demo` 仅是数据作用域标记） */
export interface SessionLike {
  valid: boolean;
  role?: string;
  demo?: boolean;
}

/**
 * 首页「开始探索」的目标地址（服务端一次判定）。
 *
 * 只有验签通过的已知角色才直达本人面板；未登录、cookie 过期/签名无效、
 * 角色缺失或异常值一律去 `/login`——不猜角色，尤其不能把非学生送进学生面板。
 */
export function resolveExploreHref(session: SessionLike): string {
  if (!session.valid) return "/login";
  return roleHome(session.role) ?? "/login";
}
