import type { Metadata } from "next";
import Link from "next/link";
import { BarChart3, ClipboardCheck, Compass, UserRound, Users } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import SiteFooter from "@/components/SiteFooter";
import {
  ABOUT_CAPABILITIES,
  ABOUT_CAPABILITY_LINE,
  ABOUT_INTRO,
  ABOUT_META_DESCRIPTION,
  ABOUT_ROLES,
  ABOUT_START,
  ABOUT_STEPS,
  ABOUT_TRUST,
} from "@/lib/about-content";
import { COPYRIGHT_NOTICE } from "@/lib/copyright";
import pkg from "../../../package.json";

export const metadata: Metadata = {
  title: "关于 · Career Explorer",
  description: ABOUT_META_DESCRIPTION,
};

const CAPABILITY_ICONS = {
  profile: UserRound,
  assessment: ClipboardCheck,
  grouping: Users,
  data: BarChart3,
} as const;

export default function AboutPage() {
  return (
    <div className="flex flex-col min-h-screen md:h-dvh bg-background">
      <NavigationBar title="Career Explorer" showHome />
      <main className="flex-1 md:overflow-y-auto w-full max-w-3xl mx-auto px-6 py-12 space-y-10 pb-20 md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
        {/* 产品介绍 */}
        <section className="space-y-4">
          <div className="flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-brand flex items-center justify-center shadow-md">
              <Compass size={24} strokeWidth={2} className="text-accent" />
            </div>
            <h1 className="text-2xl font-bold text-foreground">关于 Career Explorer</h1>
          </div>
          <p className="text-gray-600 dark:text-gray-300 leading-relaxed">{ABOUT_INTRO.lead}</p>
          <p className="text-sm text-muted leading-relaxed">{ABOUT_INTRO.description}</p>
        </section>

        {/* 主要功能 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">主要功能</h2>
          <div className="grid gap-4 sm:grid-cols-2">
            {ABOUT_CAPABILITIES.map((capability) => {
              const Icon = CAPABILITY_ICONS[capability.key];
              return (
                <div
                  key={capability.key}
                  className="bg-card rounded-xl border border-border-soft p-5 space-y-2 shadow-sm"
                >
                  <Icon size={20} className="text-primary dark:text-green-400" />
                  <h3 className="font-medium text-foreground">{capability.title}</h3>
                  <p className="text-sm text-muted leading-relaxed">{capability.desc}</p>
                </div>
              );
            })}
          </div>
        </section>

        {/* 三个角色 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">三个角色，各得其所</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            {ABOUT_ROLES.map((role) => (
              <div
                key={role.role}
                className="flex h-full flex-col gap-2 bg-card rounded-xl border border-border-soft p-5 shadow-sm"
              >
                <p className="text-xs font-medium text-muted">{role.role}</p>
                <h3 className="font-medium text-foreground">{role.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{role.summary}</p>
                <ul className="mt-auto flex flex-wrap gap-1.5 pt-2">
                  {role.points.map((point) => (
                    <li
                      key={point}
                      className="rounded-full bg-gray-100 px-2 py-0.5 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
                    >
                      {point}
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>

        {/* 学生探索流程 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">学生探索流程</h2>
          <ol className="space-y-2 text-gray-600 dark:text-gray-300 text-sm leading-relaxed list-decimal list-inside">
            {ABOUT_STEPS.map((step) => (
              <li key={step}>{step}</li>
            ))}
          </ol>
        </section>

        {/* 数据与信任 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">数据与信任</h2>
          <div className="bg-card rounded-xl border border-border-soft p-5 space-y-4 shadow-sm">
            {ABOUT_TRUST.map((item) => (
              <div key={item.title} className="space-y-1">
                <h3 className="text-sm font-medium text-foreground">{item.title}</h3>
                <p className="text-sm text-muted leading-relaxed">{item.desc}</p>
              </div>
            ))}
          </div>
        </section>

        {/* 如何开始 */}
        <section className="space-y-4">
          <h2 className="text-lg font-semibold text-foreground">如何开始</h2>
          <ul className="space-y-2 text-gray-600 dark:text-gray-300 text-sm leading-relaxed">
            {ABOUT_START.map((item) => (
              <li key={item.audience}>
                <span className="font-medium text-foreground">{item.audience}：</span>
                {item.desc}
              </li>
            ))}
          </ul>
          <div className="flex flex-wrap items-center gap-4">
            <Link
              href="/"
              aria-label="返回主页开始探索"
              className="inline-block px-5 py-2.5 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-xl transition-colors shadow-sm"
            >
              返回主页开始探索
            </Link>
            <Link
              href="/login"
              className="text-sm text-muted hover:text-foreground underline-offset-4 hover:underline"
            >
              已有账户？登录
            </Link>
          </div>
        </section>

        {/* 版本信息（动态读取 package.json，发布时随 npm version 更新） */}
        <div className="space-y-1.5 pt-4 border-t border-border-soft">
          <p className="text-xs text-muted">
            Career Explorer v{pkg.version} · 从兴趣测评到课堂协作
          </p>
          <p className="text-xs text-muted">{ABOUT_CAPABILITY_LINE}</p>
          <p className="text-xs text-muted">{COPYRIGHT_NOTICE}</p>
        </div>
      </main>
      <SiteFooter copyright={COPYRIGHT_NOTICE} />
    </div>
  );
}
