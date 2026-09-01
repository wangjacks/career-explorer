"use client";

import { FileText, Users, Sprout } from "lucide-react";

interface SidebarItem {
  label: string;
  icon: typeof FileText;
  /** 当前页（高亮） */
  active?: boolean;
  /** 敬请期待（禁用占位，预留未来页面） */
  soon?: boolean;
}

const ITEMS: SidebarItem[] = [
  { label: "我的档案", icon: FileText, active: true },
  { label: "我的班级", icon: Users, soon: true },
  { label: "成长记录", icon: Sprout, soon: true },
];

/**
 * 学生面板左侧菜单（预留扩展位）：
 * - 桌面（md+）：sticky 静态左栏，open=false 时宽度折叠为 0
 * - 移动（<md）：顶栏下方抽屉（top-12 起，不盖顶栏，切换按钮保持可点）+ z-30 遮罩
 */
export default function StudentSidebar({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          {ITEMS.map((item) =>
            item.active ? (
              <span
                key={item.label}
                aria-current="page"
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm font-medium bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300"
              >
                <item.icon size={17} strokeWidth={2} />
                {item.label}
              </span>
            ) : (
              <span
                key={item.label}
                title="即将上线"
                className="flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-gray-400 dark:text-gray-500 cursor-not-allowed select-none"
              >
                <item.icon size={17} strokeWidth={1.8} />
                {item.label}
                <span className="ml-auto text-[10px] px-1.5 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800">
                  即将上线
                </span>
              </span>
            )
          )}
        </nav>
      </aside>
    </>
  );
}
