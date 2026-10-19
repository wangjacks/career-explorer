"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { FileText, Users, UsersRound, Sprout, Compass, type LucideIcon } from "lucide-react";

/** 学生面板内的可切换视图：`group` 由侧边栏进入，`profile` / `history` 另有页内分段控件 */
export type StudentViewKey = "profile" | "history" | "group";

interface SidebarItem {
  /** 页内视图切换的 key；`null` = 占位项或外链项，不走 onSelect */
  viewKey: StudentViewKey | null;
  /** 外链 href（职业测评走独立路由） */
  href?: string;
  label: string;
  icon: LucideIcon;
  /** 不可点时的说明（读屏与 title 都用它，别让用户猜为什么按不动） */
  hint?: string;
  /** 占位项标记 */
  soon?: boolean;
}

const ITEMS: SidebarItem[] = [
  { viewKey: "profile", label: "我的档案", icon: FileText },
  { viewKey: "group", label: "我的小组", icon: UsersRound },
  { viewKey: null, href: "/dashboard/student/assessment", label: "职业测评", icon: Compass },
  { viewKey: null, label: "我的班级", icon: Users, hint: "即将上线", soon: true },
  { viewKey: null, label: "成长记录", icon: Sprout, hint: "即将上线", soon: true },
];

/**
 * 学生面板左侧菜单（#101 起可交互）：
 * - 桌面（md+）：sticky 静态左栏，open=false 时宽度折叠为 0
 * - 移动（<md）：顶栏下方抽屉（top-12 起，不盖顶栏，切换按钮保持可点）+ z-30 遮罩
 * - 「我的档案」「我的小组」是页内视图切换（button），「职业测评」是独立路由（Link）
 * - 占位项保持不可聚焦（用 span），避免读屏把「即将上线」当成可操作的按钮。
 */
export default function StudentSidebar({
  open,
  onClose,
  activeView,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  activeView?: StudentViewKey;
  onSelect?: (key: StudentViewKey) => void;
}) {
  const pathname = usePathname();

  // 只在移动端选完自动收起：桌面是常驻静态栏，收起会把整条导航折叠成 0 宽（与 PanelSidebar 同规则）
  const handleSelect = (key: StudentViewKey) => {
    onSelect?.(key);
    if (!window.matchMedia("(min-width: 768px)").matches) onClose();
  };

  const closeOnMobile = () => {
    if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) onClose();
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
        // 收起时整棵子树不可聚焦：栏里现在是按钮（#101 之前是纯文本），
        // 只靠 translate / md:w-0 藏起来的话 Tab 会走进看不见的项
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
          {ITEMS.map((item) => {
            const label = (
              <>
                <item.icon size={17} strokeWidth={item.viewKey || item.href ? 2 : 1.8} />
                {item.label}
              </>
            );
            if (item.soon || (!item.viewKey && !item.href)) {
              return (
                <span
                  key={item.label}
                  title={item.hint}
                  aria-disabled="true"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-muted cursor-not-allowed select-none"
                >
                  {label}
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                    {item.hint}
                  </span>
                </span>
              );
            }
            // 外链项（职业测评）：用 pathname 判定高亮
            if (item.href) {
              const isActive = pathname === item.href || pathname.startsWith(item.href + "/");
              if (isActive) {
                return (
                  <span
                    key={item.label}
                    aria-current="page"
                    className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
                  >
                    {label}
                  </span>
                );
              }
              return (
                <Link
                  key={item.label}
                  href={item.href}
                  onClick={closeOnMobile}
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
                >
                  {label}
                </Link>
              );
            }
            // 页内视图项：用 activeView 判定高亮（activeView 未传时不高亮任何页内项）
            // 历史提交是「我的档案」的子视图：停在档案区时侧边栏仍高亮「我的档案」
            const active = activeView !== undefined && (
              item.viewKey === "profile" ? activeView !== "group" : activeView === item.viewKey
            );
            return (
              <button
                type="button"
                key={item.label}
                aria-current={active ? "page" : undefined}
                onClick={() => handleSelect(item.viewKey as StudentViewKey)}
                className={`w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium transition-colors text-left ${
                  active
                    ? "bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
                    : "text-gray-600 hover:bg-gray-50 hover:text-gray-900 dark:text-gray-300 dark:hover:bg-gray-800 dark:hover:text-gray-100"
                }`}
              >
                {label}
              </button>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
