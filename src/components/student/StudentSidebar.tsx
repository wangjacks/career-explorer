"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, FileText, Users, UsersRound, Sprout, type LucideIcon } from "lucide-react";
import {
  STUDENT_NAV_ITEMS,
  studentActiveKey,
  type StudentNavItem,
  type StudentNavKey,
} from "@/lib/student-nav";

/** 图标只在渲染层映射，导航数据本身保持纯数据（`src/lib/student-nav.ts`） */
const NAV_ICONS: Record<StudentNavKey, LucideIcon> = {
  profile: FileText,
  group: UsersRound,
  assessment: Compass,
  class: Users,
  growth: Sprout,
};

/**
 * 学生面板左侧菜单（#101 / #361）：
 * - 桌面（md+）：sticky 静态左栏，open=false 时宽度折叠为 0
 * - 移动（<md）：顶栏下方抽屉（top-12 起，不盖顶栏，切换按钮保持可点）+ z-30 遮罩
 * - 条目全部是路由 Link；高亮由 `studentActiveKey(pathname)` 判定，历史提交仍高亮「我的档案」
 * - `canNavigate` 用于编辑态拦截（layout 注入），返回 false 时阻止跳转并保持当前页
 * - 占位项保持不可聚焦（用 span），避免读屏把「即将上线」当成可操作的按钮。
 */
export default function StudentSidebar({
  open,
  onClose,
  canNavigate,
}: {
  open: boolean;
  onClose: () => void;
  canNavigate?: () => boolean;
}) {
  const pathname = usePathname();
  const activeKey = studentActiveKey(pathname);

  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) onClose();
  };

  const handleNavigate = (event: React.MouseEvent<HTMLAnchorElement>) => {
    // 已在当前路由时不需要询问导航守卫：编辑态点「我的档案」不应被提示先保存
    if (event.currentTarget.pathname !== pathname && canNavigate && !canNavigate()) {
      event.preventDefault();
      return;
    }
    closeOnMobile();
  };

  const renderItem = (item: StudentNavItem) => {
    const Icon = NAV_ICONS[item.key];
    const label = (
      <>
        <Icon size={17} strokeWidth={item.href ? 2 : 1.8} />
        {item.label}
      </>
    );

    if (item.soon || !item.href) {
      return (
        <span
          key={item.key}
          title="即将上线"
          aria-disabled="true"
          className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-muted cursor-not-allowed select-none"
        >
          {label}
          <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
            即将上线
          </span>
        </span>
      );
    }

    const active = activeKey === item.key;
    return (
      <Link
        key={item.key}
        href={item.href}
        onClick={handleNavigate}
        aria-current={active ? "page" : undefined}
        className={`relative flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm transition-colors ${
          active
            ? "bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300 font-medium"
            : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        }`}
      >
        {label}
      </Link>
    );
  };

  return (
    <>
      {/* 移动端遮罩：z-30 低于顶栏（z-40），顶栏不被遮暗、可继续点击切换按钮 */}
      <div
        onClick={onClose}
        aria-hidden
        className={`md:hidden fixed inset-0 z-30 bg-black/40 transition-opacity duration-300 ${
          open ? "opacity-100" : "opacity-0 pointer-events-none"
        }`}
      />
      <aside
        // 收起时整棵子树不可聚焦：只靠 translate / md:w-0 藏起来的话 Tab 会走进看不见的项
        inert={!open}
        className={`bg-card border-r border-border-soft transition-all duration-300 ease-out
          fixed top-12 bottom-0 left-0 z-40 w-64
          md:sticky md:top-12 md:bottom-auto md:z-auto md:h-[calc(100dvh-3rem)] md:w-56 md:flex-shrink-0
          ${
            open
              ? "translate-x-0"
              : "-translate-x-full md:translate-x-0 md:w-0 md:border-r-0 md:overflow-hidden"
          }`}
      >
        {/* 内容保持固定宽度：折叠时仅收宽度，展开瞬间内容不闪 */}
        <nav aria-label="学生面板菜单" className="p-3 space-y-1 md:w-56">
          {STUDENT_NAV_ITEMS.map(renderItem)}
        </nav>
      </aside>
    </>
  );
}
