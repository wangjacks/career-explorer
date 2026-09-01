"use client";

import type { LucideIcon } from "lucide-react";

export interface PanelSidebarItem {
  key: string;
  label: string;
  icon?: LucideIcon;
  badge?: string;
}

export interface PanelSidebarGroup {
  /** 组头（eyebrow）；省略则为无组头的顶部单项 */
  label?: string;
  items: PanelSidebarItem[];
}

interface PanelSidebarProps {
  open: boolean;
  onClose: () => void;
  /** 深绿角色区：角色图标 + 标签 + 可选名字 */
  role: { icon: LucideIcon; label: string; sub?: string };
  groups: PanelSidebarGroup[];
  activeKey: string;
  onSelect: (key: string) => void;
}

/**
 * 面板通用分组侧边栏（教师/管理）：
 * - 桌面（md+）：sticky 静态左栏，open=false 时宽度折叠为 0
 * - 移动（<md）：顶栏下方抽屉（top-12 起，不盖顶栏）+ z-30 遮罩
 * - 活动项：琥珀指示条 + soft 绿底；badge 用 soft 绿底（琥珀不承载小字）
 */
export default function PanelSidebar({ open, onClose, role, groups, activeKey, onSelect }: PanelSidebarProps) {
  const handleSelect = (key: string) => {
    onSelect(key);
    // 仅移动端自动收起抽屉；桌面静态栏不得被误折叠
    if (!window.matchMedia("(min-width: 768px)").matches) onClose();
  };

  const RoleIcon = role.icon;

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
          fixed top-12 bottom-0 left-0 z-40 w-64 overflow-y-auto
          md:sticky md:top-12 md:bottom-auto md:z-auto md:h-[calc(100dvh-3rem)] md:w-60 md:flex-shrink-0
          ${
            open
              ? "translate-x-0"
              : "-translate-x-full md:translate-x-0 md:w-0 md:border-r-0 md:overflow-hidden"
          }`}
      >
        {/* 内容保持固定宽度：折叠时仅收宽度，展开瞬间内容不闪 */}
        <nav aria-label="面板菜单" className="p-3 space-y-4 md:w-60">
          {/* 角色区：深绿品牌块 */}
          <div className="bg-brand rounded-xl p-3.5 flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-white/15 flex items-center justify-center flex-shrink-0">
              <RoleIcon size={18} className="text-accent" />
            </div>
            <div className="min-w-0">
              <p className="text-sm font-semibold text-white leading-tight">{role.label}</p>
              {role.sub && <p className="text-xs text-white/70 truncate mt-0.5">{role.sub}</p>}
            </div>
          </div>

          {/* 分组导航 */}
          {groups.map((group, gIdx) => (
            <div key={group.label ?? `group-${gIdx}`} className="space-y-1">
              {group.label && (
                <p className="px-3 pb-1 text-[11px] font-medium text-gray-400 dark:text-gray-500">
                  {group.label}
                </p>
              )}
              {group.items.map((item) => {
                const active = item.key === activeKey;
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.key}
                    onClick={() => handleSelect(item.key)}
                    aria-current={active ? "page" : undefined}
                    className={`relative w-full flex items-center gap-2.5 px-3 py-2.5 rounded-lg text-sm text-left transition-colors ${
                      active
                        ? "bg-primary-soft text-primary-strong dark:bg-green-900/30 dark:text-green-300 font-medium"
                        : "text-gray-600 dark:text-gray-300 hover:bg-gray-50 dark:hover:bg-gray-800"
                    }`}
                  >
                    {active && (
                      <span
                        className="absolute left-0 top-1/2 -translate-y-1/2 w-[3px] h-5 rounded-full bg-accent"
                        aria-hidden
                      />
                    )}
                    {ItemIcon && <ItemIcon size={17} strokeWidth={active ? 2 : 1.8} className="flex-shrink-0" />}
                    <span className="truncate">{item.label}</span>
                    {item.badge && (
                      <span className="ml-auto px-1.5 py-0.5 bg-primary-soft text-primary-strong dark:bg-green-900/40 dark:text-green-300 rounded text-[10px] flex-shrink-0">
                        {item.badge}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          ))}
        </nav>
      </aside>
    </>
  );
}
