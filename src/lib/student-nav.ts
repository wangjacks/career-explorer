/**
 * 学生侧边栏导航数据（#222 / #101 / #361）：把「条目定义 + 高亮判定」从组件里抽成纯数据，
 * 组件只负责渲染图标与样式，判定口径可单测（`student-nav.test.ts`）。
 *
 * #361 起每个条目都是独立路由（`/dashboard/student`、`/group`、`/assessment`），
 * 「历史提交」是「我的档案」的子路由，仍高亮「我的档案」。
 *
 * 文档来源：`docs/architecture.md`「面板导航结构」。
 */

export type StudentNavKey = "profile" | "group" | "assessment" | "class" | "growth";

export const STUDENT_ROOT_PATH = "/dashboard/student";

/** 学生面板内的视图（历史提交是档案路由下的子页，不是侧边栏条目） */
export type StudentViewKey = "profile" | "history" | "group";

export interface StudentNavItem {
  key: StudentNavKey;
  label: string;
  /** 路由地址；占位项没有 */
  href?: string;
  /** 敬请期待（禁用占位） */
  soon?: boolean;
}

/** 侧边栏顺序：已上线的在前，占位项在后 */
export const STUDENT_NAV_ITEMS: readonly StudentNavItem[] = [
  { key: "profile", label: "我的档案", href: STUDENT_ROOT_PATH },
  { key: "group", label: "我的小组", href: `${STUDENT_ROOT_PATH}/group` },
  { key: "assessment", label: "职业测评", href: `${STUDENT_ROOT_PATH}/assessment` },
  { key: "class", label: "我的班级", soon: true },
  { key: "growth", label: "成长记录", soon: true },
];

/**
 * pathname → 当前侧边栏条目。
 *
 * - `/dashboard/student` 与 `/dashboard/student/history` 都算「我的档案」（历史提交是子视图）；
 * - 「我的小组」「职业测评」按路径前缀匹配，覆盖子路由（如答题页）；
 * - 未知路径回落到「我的档案」，与面板默认落点一致。
 */
export function studentActiveKey(pathname: string | null | undefined): StudentNavKey {
  if (!pathname) return "profile";
  const clean = pathname.replace(/\/+$/, "") || "/";
  if (clean === STUDENT_ROOT_PATH || clean === `${STUDENT_ROOT_PATH}/history`) return "profile";
  if (clean === `${STUDENT_ROOT_PATH}/group` || clean.startsWith(`${STUDENT_ROOT_PATH}/group/`)) {
    return "group";
  }
  if (
    clean === `${STUDENT_ROOT_PATH}/assessment` ||
    clean.startsWith(`${STUDENT_ROOT_PATH}/assessment/`)
  ) {
    return "assessment";
  }
  return "profile";
}

/** 侧边栏条目是否高亮（占位项永不 active；`pathname` 为 null 时不高亮） */
export function isStudentNavActive(
  pathname: string | null | undefined,
  item: StudentNavItem
): boolean {
  if (!pathname || item.soon || !item.href) return false;
  return studentActiveKey(pathname) === item.key;
}
