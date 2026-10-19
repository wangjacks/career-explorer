/**
 * 学生侧边栏导航数据（#222）：把「条目定义 + 高亮判定」从组件里抽成纯数据，
 * 组件只负责渲染图标与样式，判定口径可单测（`student-nav.test.ts`）。
 *
 * 文档来源：`docs/architecture.md`「面板导航结构」。
 */

export type StudentNavKey = "profile" | "assessment" | "class" | "growth";

export interface StudentNavItem {
  key: StudentNavKey;
  label: string;
  /** 有地址即可点击跳转；只有 `soon` 的条目没有 href */
  href?: string;
  /** 敬请期待（禁用占位）：保留在侧边栏，让学生知道后续会有 */
  soon?: boolean;
}

/** 侧边栏顺序：已上线的在前，占位项在后 */
export const STUDENT_NAV_ITEMS: readonly StudentNavItem[] = [
  { key: "profile", label: "我的档案", href: "/dashboard/student" },
  { key: "assessment", label: "职业测评", href: "/dashboard/student/assessment" },
  { key: "class", label: "我的班级", soon: true },
  { key: "growth", label: "成长记录", soon: true },
];

/**
 * 条目是否高亮。
 *
 * - 「我的档案」**只在自己那一页高亮**（精确匹配）——否则 `/dashboard/student/assessment`
 *   会把「我的档案」也点亮，两个条目同时 active；
 * - 其余条目按**前缀**匹配，让子路由（如答题页 `/dashboard/student/assessment/quiz`）
 *   仍归属同一个侧边栏条目；
 * - 占位项永不 active；`pathname` 为 null（尚未挂载）时不高亮。
 */
export function isStudentNavActive(pathname: string | null | undefined, item: StudentNavItem): boolean {
  if (!pathname || item.soon || !item.href) return false;
  if (pathname === item.href) return true;
  return item.href !== "/dashboard/student" && pathname.startsWith(`${item.href}/`);
}
