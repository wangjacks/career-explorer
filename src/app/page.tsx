import type { Metadata } from "next";
import Link from "next/link";
import { Compass } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import SiteFooter from "@/components/SiteFooter";

export const metadata: Metadata = {
  title: "Career Explorer · 学生职业探索工具",
  openGraph: {
    title: "Career Explorer · 学生职业探索工具",
    description: "通过兴趣、技能与性格标签，探索真实的自己，生成一份专属的职业探索档案。",
  },
};

// 强制动态渲染，避免 Next.js 静态预渲染添加 s-maxage 缓存头
export const dynamic = "force-dynamic";

export default function IndexPage() {
  return (
    <div className="flex flex-col min-h-screen md:h-dvh bg-background overflow-x-clip">
      <NavigationBar title="Career Explorer" showHome />
      <main className="flex-1 flex flex-col">
        {/* 大字报深绿 hero：品牌深绿底 + 白字大标题 + 琥珀指南针装饰（flex-1 撑满顶栏与页脚之间） */}
        <section className="flex-1 bg-brand text-white flex items-center">
          <div className="max-w-5xl mx-auto px-6 py-8 sm:py-28 space-y-5 sm:space-y-6 w-full">
            <Compass size={48} strokeWidth={1.5} className="text-accent animate-[hero-compass_1.1s_both]" aria-hidden />
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight animate-[hero-slide-in_0.7s_cubic-bezier(0.33,1,0.68,1)_0.15s_both]">
              找到属于你的
              <br className="hidden sm:block" />
              职业方向
            </h1>
            <p className="text-white/90 text-lg max-w-xl leading-relaxed animate-[hero-slide-in_0.7s_cubic-bezier(0.33,1,0.68,1)_0.3s_both]">
              通过兴趣、技能与性格标签，探索真实的自己，生成一份专属的职业探索档案。
            </p>
            <Link
              href="/form/create-profile"
              className="inline-block mt-2 px-8 py-3.5 bg-accent text-stone-900 text-base font-semibold rounded-xl hover:brightness-105 transition-all shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 animate-[hero-slide-in_0.7s_cubic-bezier(0.33,1,0.68,1)_0.45s_both]"
            >
              开始探索
            </Link>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
