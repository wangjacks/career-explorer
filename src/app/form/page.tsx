import type { Metadata } from "next";
import Link from "next/link";
import { ClipboardList, type LucideIcon } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "表单 · Career Explorer",
  description: "职业探索测评表单列表",
};

/**
 * 表单列表项：标准化测评（霍兰德职业兴趣、16 人格等）落地时按此结构填充，列表页无需改版；
 * `key` 同时预留为详情路由片段（/form/[key]）。
 */
interface FormListItem {
  key: string;
  title: string;
  description: string;
  icon: LucideIcon;
  /** 预计用时文案，如「约 10 分钟」 */
  duration: string;
  href: string;
}

/**
 * 列表数据源（#168）：当前不接 API、不建表，恒为空数组，只渲染空态。
 * 空列表表示「尚未上线」而非加载失败，因此本页没有加载态与错误态；
 * 测评（#104）接入时在此填充即可。
 */
const FORM_LIST_ITEMS: FormListItem[] = [];

export default function FormListPage() {
  return (
    <div className="flex flex-col min-h-screen md:h-dvh bg-background">
      <NavigationBar title="表单" showHome />
      <main className="flex-1 md:overflow-y-auto w-full max-w-3xl mx-auto px-6 py-12 space-y-6 pb-20 md:[scrollbar-width:none] md:[&::-webkit-scrollbar]:hidden">
        <header className="space-y-2">
          <h1 className="text-2xl font-bold text-foreground">表单</h1>
          <p className="text-sm text-muted">职业探索相关的标准化测评会陆续上线，结果汇总到你的职业探索档案。</p>
        </header>

        {FORM_LIST_ITEMS.length === 0 ? (
          /* 空态（ui-conventions「状态」）：居中图标 + 说明 + 行动引导 */
          <div className="bg-card rounded-xl border border-border-soft shadow-sm p-8 text-center space-y-4">
            <div className="w-14 h-14 bg-brand rounded-2xl flex items-center justify-center mx-auto">
              <ClipboardList className="w-7 h-7 text-accent" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-base font-semibold text-foreground">表单正在准备中</h2>
              <p className="text-sm text-muted mt-1">
                标准化测评（职业兴趣、人格倾向等）尚未上线；在此之前，你可以直接在学生面板完成并提交职业探索档案。
              </p>
            </div>
            <Link
              href="/dashboard/student"
              className="inline-block px-6 py-2.5 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-xl transition-colors"
            >
              前往学生面板
            </Link>
          </div>
        ) : (
          <ul className="space-y-3">
            {FORM_LIST_ITEMS.map((item) => (
              <li key={item.key}>
                <Link
                  href={item.href}
                  className="flex items-start gap-4 bg-card rounded-xl border border-border-soft shadow-sm p-5 hover:border-primary transition-colors"
                >
                  <span className="w-10 h-10 rounded-xl bg-primary-soft flex items-center justify-center flex-shrink-0">
                    <item.icon size={20} strokeWidth={2} className="text-primary" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold text-foreground">{item.title}</span>
                    <span className="block text-sm text-muted mt-1">{item.description}</span>
                    <span className="block text-xs text-muted mt-2">{item.duration}</span>
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </main>
      <SiteFooter />
    </div>
  );
}
