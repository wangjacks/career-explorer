"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Compass, FileText, Users, Sprout, type LucideIcon } from "lucide-react";
import { STUDENT_NAV_ITEMS, isStudentNavActive, type StudentNavKey } from "@/lib/student-nav";

/** 图标只在渲染层映射，导航数据本身保持纯数据（`src/lib/student-nav.ts`） */
const NAV_ICONS: Record<StudentNavKey, LucideIcon> = {
  profile: FileText,
  assessment: Compass,
  class: Users,
  growth: Sprout,
};

/**
 * 学生面板左侧菜单：
 * - 桌面（md+）：sticky 静态左栏，open=false 时宽度折叠为 0
 * - 移动（<md）：顶栏下方抽屉（top-12 起，不盖顶栏，切换按钮保持可点）+ z-30 遮罩
 *
 * 高亮由 `usePathname()` 判定（「我的档案」精确匹配、「职业测评」按前缀覆盖答题页），
 * 条目定义与判定规则在 `src/lib/student-nav.ts`，可单测。
 */
export default function StudentSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
  const pathname = usePathname();

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
          {STUDENT_NAV_ITEMS.map((item) => {
            const Icon = NAV_ICONS[item.key];
            if (item.soon || !item.href) {
              return (
                <span
                  key={item.key}
                  title="即将上线"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-muted cursor-not-allowed select-none"
                >
                  <Icon size={17} strokeWidth={1.8} />
                  {item.label}
                  <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                    即将上线
                  </span>
                </span>
              );
            }
            if (isStudentNavActive(pathname, item)) {
              return (
                <span
                  key={item.key}
                  aria-current="page"
                  className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
                >
                  <Icon size={17} strokeWidth={2} />
                  {item.label}
                </span>
              );
            }
            return (
              <Link
                key={item.key}
                href={item.href}
                onClick={onClose}
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-600 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors"
              >
                <Icon size={17} strokeWidth={1.8} />
                {item.label}
              </Link>
            );
          })}
        </nav>
      </aside>
    </>
  );
}
