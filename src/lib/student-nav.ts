/**
 * 学生侧边栏导航数据（#222 / #101）：把「条目定义 + 高亮判定」从组件里抽成纯数据，
 * 组件只负责渲染图标与样式，判定口径可单测（`student-nav.test.ts`）。
 *
 * 文档来源：`docs/architecture.md`「面板导航结构」。
 */

export type StudentNavKey = "profile" | "group" | "assessment" | "class" | "growth";

export interface StudentNavItem {
  key: StudentNavKey;
  label: string;
  /** 路由地址；页内视图项在未传 onSelect 时作为回退链接 */
  href?: string;
  /** 是否为页内视图（需要 StudentSidebar 传 activeView / onSelect 做视图切换） */
  view?: boolean;
  /** 敬请期待（禁用占位） */
  soon?: boolean;
}

/** 侧边栏顺序：已上线的在前，占位项在后 */
export const STUDENT_NAV_ITEMS: readonly StudentNavItem[] = [
  { key: "profile", label: "我的档案", href: "/dashboard/student", view: true },
  { key: "group", label: "我的小组", href: "/dashboard/student", view: true },
  { key: "assessment", label: "职业测评", href: "/dashboard/student/assessment" },
  { key: "class", label: "我的班级", soon: true },
  { key: "growth", label: "成长记录", soon: true },
];

/**
 * 外链项高亮判定（按 pathname）。
 *
 * - 「我的档案」作为页内视图，高亮由 StudentSidebar 的 activeView 决定，不在此判定；
 * - 职业测评按**前缀**匹配，让子路由（如答题页 `/dashboard/student/assessment/quiz`）
 *   仍归属同一个侧边栏条目；
 * - 占位项与页内视图项永不通过此函数高亮；`pathname` 为 null（尚未挂载）时不高亮。
 */
export function isStudentNavActive(pathname: string | null | undefined, item: StudentNavItem): boolean {
  if (!pathname || item.soon || !item.href || item.view) return false;
  if (pathname === item.href) return true;
  return pathname.startsWith(`${item.href}/`);
}
