"use client";

import { FileText, Users, UsersRound, Sprout } from "lucide-react";

/** 学生面板内的可切换视图：`group` 由侧边栏进入，`profile` / `history` 另有页内分段控件 */
export type StudentViewKey = "profile" | "history" | "group";

interface SidebarItem {
  /** 点击后要切到的视图；`null` = 占位项，不可点 */
  key: StudentViewKey | null;
  label: string;
  icon: typeof FileText;
  /** 不可点时的说明（读屏与 title 都用它，别让用户猜为什么按不动） */
  hint?: string;
}

const ITEMS: SidebarItem[] = [
  { key: "profile", label: "我的档案", icon: FileText },
  { key: "group", label: "我的小组", icon: UsersRound },
  { key: null, label: "我的班级", icon: Users, hint: "即将上线" },
  { key: null, label: "成长记录", icon: Sprout, hint: "即将上线" },
];

/**
 * 学生面板左侧菜单（#101 起可交互）：
 * - 桌面（md+）：sticky 静态左栏，open=false 时宽度折叠为 0
 * - 移动（<md）：顶栏下方抽屉（top-12 起，不盖顶栏，切换按钮保持可点）+ z-30 遮罩
 * 占位项保持不可聚焦（用 span），避免读屏把「即将上线」当成可操作的按钮。
 */
export default function StudentSidebar({
  open,
  onClose,
  activeView,
  onSelect,
}: {
  open: boolean;
  onClose: () => void;
  activeView: StudentViewKey;
  onSelect: (key: StudentViewKey) => void;
}) {
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
          {ITEMS.map((item) => {
            const label = (
              <>
                <item.icon size={17} strokeWidth={item.key ? 2 : 1.8} />
                {item.label}
              </>
            );
            if (item.key === null) {
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
            const active = activeView === item.key;
            return (
              <button
                type="button"
                key={item.label}
                aria-current={active ? "page" : undefined}
                onClick={() => {
                  onSelect(item.key as StudentViewKey);
                  onClose();
                }}
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
