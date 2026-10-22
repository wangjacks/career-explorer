"use client";

import Link from "next/link";

const TABS = [
  { key: "profile", label: "我的档案", href: "/dashboard/student" },
  { key: "history", label: "历史提交", href: "/dashboard/student/history" },
] as const;

/**
 * 「我的档案 / 历史提交」分段控件（#322 / #361）：从页内状态改为两个独立路由的 Link，
 * 刷新历史提交页不再回到档案首页；编辑态由 `canNavigate` 拦截。
 */
export default function StudentPanelTabs({
  active,
  canNavigate,
}: {
  active: "profile" | "history";
  canNavigate?: () => boolean;
}) {
  return (
    <div className="flex gap-1 bg-gray-100 dark:bg-gray-800 rounded-xl p-1">
      {TABS.map((tab) => {
        const isActive = tab.key === active;
        return (
          <Link
            key={tab.key}
            href={tab.href}
            aria-current={isActive ? "page" : undefined}
            onClick={(event) => {
              if (canNavigate && !canNavigate()) event.preventDefault();
            }}
            className={`flex-1 py-2 rounded-lg text-sm font-medium text-center transition-colors ${
              isActive
                ? "bg-card text-gray-900 dark:text-gray-100 shadow-sm"
                : "text-gray-500 hover:text-gray-700 dark:hover:text-gray-300"
            }`}
          >
            {tab.label}
          </Link>
        );
      })}
    </div>
  );
}
