/**
 * 面板导航路由配置（#361）：管理 / 教师面板的 Tab 定义集中在这里。
 *
 * 每项同时承载「侧边栏分组」与「路由路径」：侧边栏、教师主页快捷入口都从这里取数据，
 * 避免「导航加了、路由忘了」两处维护。图标只在渲染层映射（`panel-icons.ts`），本文件保持纯数据可单测。
 *
 * 根路径即默认 Tab（管理 = 数据概览、教师 = 主页），保持 `ROLE_HOME` 登录落点不变。
 */

export type PanelRole = "admin" | "teacher";

export interface PanelNavItemDef {
  key: string;
  /** 面板内绝对路径；根路径即默认 Tab */
  path: string;
  label: string;
  /** 侧边栏组头；省略 = 无组头单项（教师主页） */
  group?: string;
  /** 教师主页快捷入口的一句话说明（侧边栏不渲染） */
  description?: string;
}

export const ADMIN_ROOT_PATH = "/dashboard/admin";
export const TEACHER_ROOT_PATH = "/dashboard/teacher";

export const ADMIN_NAV_ITEMS: readonly PanelNavItemDef[] = [
  { key: "overview", path: ADMIN_ROOT_PATH, label: "数据概览", group: "数据中心" },
  { key: "screen", path: `${ADMIN_ROOT_PATH}/screen`, label: "数据大屏", group: "数据中心" },
  { key: "export", path: `${ADMIN_ROOT_PATH}/export`, label: "数据导出", group: "数据中心" },
  { key: "submissions", path: `${ADMIN_ROOT_PATH}/submissions`, label: "提交历史", group: "数据中心" },
  { key: "students", path: `${ADMIN_ROOT_PATH}/students`, label: "学生管理", group: "用户管理" },
  { key: "teachers", path: `${ADMIN_ROOT_PATH}/teachers`, label: "教师管理", group: "用户管理" },
  { key: "classes", path: `${ADMIN_ROOT_PATH}/classes`, label: "班级管理", group: "用户管理" },
  { key: "grouping", path: `${ADMIN_ROOT_PATH}/grouping`, label: "课堂分组", group: "用户管理" },
  { key: "tags", path: `${ADMIN_ROOT_PATH}/tags`, label: "标签管理", group: "用户管理" },
  { key: "settings", path: `${ADMIN_ROOT_PATH}/settings`, label: "数据源设置", group: "系统设置" },
  {
    key: "profile-config",
    path: `${ADMIN_ROOT_PATH}/profile-config`,
    label: "功能设置",
    group: "系统设置",
  },
  { key: "storage", path: `${ADMIN_ROOT_PATH}/storage`, label: "存储管理", group: "系统设置" },
  { key: "media", path: `${ADMIN_ROOT_PATH}/media`, label: "媒体管理", group: "系统设置" },
  { key: "audit-logs", path: `${ADMIN_ROOT_PATH}/audit-logs`, label: "操作审计", group: "系统设置" },
  { key: "demo", path: `${ADMIN_ROOT_PATH}/demo`, label: "演示环境", group: "系统设置" },
];

export const TEACHER_NAV_ITEMS: readonly PanelNavItemDef[] = [
  { key: "home", path: TEACHER_ROOT_PATH, label: "主页" },
  {
    key: "overview",
    path: `${TEACHER_ROOT_PATH}/overview`,
    label: "数据概览",
    group: "数据中心",
    description: "交了多少人、标签怎么分布，都在这儿",
  },
  {
    key: "screen",
    path: `${TEACHER_ROOT_PATH}/screen`,
    label: "数据大屏",
    group: "数据中心",
    description: "投屏看的那块大盘",
  },
  {
    key: "export",
    path: `${TEACHER_ROOT_PATH}/export`,
    label: "数据导出",
    group: "数据中心",
    description: "把数据做成 Excel 文件带走",
  },
  {
    key: "profiles",
    path: `${TEACHER_ROOT_PATH}/profiles`,
    label: "数据列表",
    group: "数据管理",
    description: "逐个学生翻档案",
  },
  {
    key: "students",
    path: `${TEACHER_ROOT_PATH}/students`,
    label: "学生管理",
    group: "数据管理",
    description: "看名单、加学生、重置密码",
  },
  {
    key: "classes",
    path: `${TEACHER_ROOT_PATH}/classes`,
    label: "班级管理",
    group: "数据管理",
    description: "建班级、看邀请码、生成海报",
  },
  {
    key: "grouping",
    path: `${TEACHER_ROOT_PATH}/grouping`,
    label: "课堂分组",
    group: "数据管理",
    description: "按兴趣相似度自动分组、手工调整",
  },
  {
    key: "tags",
    path: `${TEACHER_ROOT_PATH}/tags`,
    label: "标签管理",
    group: "数据管理",
    description: "调整学生能选的标签",
  },
  {
    key: "profile-config",
    path: `${TEACHER_ROOT_PATH}/profile-config`,
    label: "功能设置",
    group: "系统设置",
    description: "改提交截止时间和上传上限",
  },
  {
    key: "audit-logs",
    path: `${TEACHER_ROOT_PATH}/audit-logs`,
    label: "操作审计",
    group: "系统设置",
    description: "谁改过什么，都记在这儿",
  },
];

/** 角色 → 导航项；未知角色返回空数组，由调用方兜底 */
export function panelNavItems(role: PanelRole): readonly PanelNavItemDef[] {
  return role === "admin" ? ADMIN_NAV_ITEMS : TEACHER_NAV_ITEMS;
}

/** key → 路由；找不到返回 undefined（不猜路径） */
export function panelPath(role: PanelRole, key: string): string | undefined {
  return panelNavItems(role).find((item) => item.key === key)?.path;
}

/** 去掉尾斜杠，保留根路径；用于 pathname 归一 */
export function normalizePanelPath(pathname: string | null | undefined): string {
  if (!pathname) return "";
  return pathname.replace(/\/+$/, "") || "/";
}

/**
 * pathname → 当前 Tab key。
 *
 * - 先精确匹配（根路径 / 其他 Tab 自己）；
 * - 再按最长前缀匹配子路由（如 `/dashboard/admin/students/123` → `students`），
 *   匹配时要求路径分段边界，`students2` 不会命中 `students`；
 * - 根路径是其余路径的前缀，但不参与前缀匹配，避免任何未知路径都回落到默认 Tab 时
 *   与「真正在默认 Tab」混淆——未知路径由调用方决定（当前回落默认 Tab）。
 */
export function resolvePanelKey(
  pathname: string | null | undefined,
  items: readonly PanelNavItemDef[]
): string {
  if (items.length === 0) return "";
  const clean = normalizePanelPath(pathname);
  const rootPath = items[0].path;
  const exact = items.find((item) => item.path === clean);
  if (exact) return exact.key;
  const prefixed = items
    .filter((item) => item.path !== rootPath)
    .filter((item) => clean.startsWith(`${item.path}/`))
    .sort((a, b) => b.path.length - a.path.length);
  return prefixed[0]?.key ?? items[0].key;
}
