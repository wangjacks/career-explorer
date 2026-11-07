"use client";

import { useEffect, useState } from "react";
import { ArrowUpRight } from "lucide-react";
import type { PanelSidebarGroup } from "@/components/dashboard/PanelSidebar";
import { buildQuickNavGroups, getTimeGreeting } from "@/lib/dashboard-utils";

interface Props {
  teacherName: string;
  /** 与侧边栏**同一份**导航数据（分组 / 图标 / 徽标 / 一句话说明都来自这里，新增栏目只改 page.tsx 一处） */
  groups: PanelSidebarGroup[];
  /** 点击快捷入口跳到对应 Tab 路由（#361；由页面按 key 解析成 `/dashboard/teacher/<tab>`） */
  onNavigate: (key: string) => void;
}

/** 侧边栏里「主页」指向本页，不再作为快捷入口重复出现 */
const HOME_KEY = "home";

/**
 * 教师面板主页：只负责**问候与分流**。
 * 统计数字与班级概览一律归「数据概览」，主页不再重复渲染（#228）。
 */
export default function TeacherHomeTab({ teacherName, groups, onNavigate }: Props) {
  const [now, setNow] = useState(() => new Date());

  // 跨时段停留时问候语跟随本地时间更新
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);

  const quickGroups = buildQuickNavGroups(groups, HOME_KEY);
  const today = now.toLocaleDateString("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    weekday: "long",
  });

  return (
    <>
      {/* Hero：问候 + 日期 + 一句引导 */}
      <section className="bg-brand-deep rounded-2xl p-5 sm:p-6 shadow-sm">
        <h2 className="text-xl sm:text-2xl font-semibold text-white">
          {getTimeGreeting(now.getHours())}，{teacherName}老师
        </h2>
        <p className="mt-2 text-sm text-white">{today}</p>
        <p className="mt-3 text-sm text-white">从下面挑一个入口开始；想看整体数据，去「数据概览」。</p>
      </section>

      {/* 快捷入口：与侧边栏同源，按现有三个分组排成卡片网格 */}
      <nav aria-label="快捷入口" className="space-y-6">
        {quickGroups.map((group, index) => (
          <section key={group.label ?? `group-${index}`} className="space-y-3">
            {group.label && <h3 className="text-sm font-semibold text-muted">{group.label}</h3>}
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
              {group.items.map((item) => {
                const ItemIcon = item.icon;
                return (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => onNavigate(item.key)}
                    className="group relative overflow-hidden text-left bg-card rounded-xl border border-border-soft p-4 hover:-translate-y-1 hover:shadow-lg transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-focus-ring"
                  >
                    {/* 琥珀只作悬停装饰条，不承载小字（与 PanelSidebar 既有约定一致） */}
                    <span
                      aria-hidden
                      className="absolute inset-x-0 top-0 h-1 bg-accent opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                    />
                    <span className="flex items-start gap-3">
                      {ItemIcon && (
                        <span className="w-10 h-10 rounded-lg bg-primary-soft text-primary-strong dark:bg-green-900/40 dark:text-green-300 flex items-center justify-center flex-shrink-0">
                          <ItemIcon size={18} strokeWidth={1.8} />
                        </span>
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center gap-2">
                          <span className="text-sm font-semibold text-foreground">{item.label}</span>
                          {item.badge && (
                            <span className="px-1.5 py-0.5 bg-primary-soft text-primary-strong dark:bg-green-900/40 dark:text-green-300 rounded text-[10px] flex-shrink-0">
                              {item.badge}
                            </span>
                          )}
                        </span>
                        {item.description && (
                          <span className="mt-1 block text-xs text-muted leading-relaxed">
                            {item.description}
                          </span>
                        )}
                      </span>
                      <ArrowUpRight
                        size={16}
                        strokeWidth={1.8}
                        aria-hidden
                        className="mt-0.5 flex-shrink-0 text-muted opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
                      />
                    </span>
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>
    </>
  );
}
