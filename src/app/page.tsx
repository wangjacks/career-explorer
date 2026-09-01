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
    images: [
      {
        url: "/og-homepage.svg",
        alt: "Career Explorer — 学生职业探索工具",
      },
    ],
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
        <section className="flex-1 bg-brand text-white flex items-center relative">
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
              aria-label="开始我的探索档案，进入创建表单"
              className="inline-block mt-2 px-8 py-3.5 bg-accent text-stone-900 text-base font-semibold rounded-xl hover:brightness-105 transition-all shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/60 animate-[hero-slide-in_0.7s_cubic-bezier(0.33,1,0.68,1)_0.45s_both]"
            >
              开始我的探索档案
            </Link>
          </div>

          {/* 探索悬浮卡（仅在 lg 及以上展示） */}
          <div className="hidden lg:block absolute right-8 top-1/2 -translate-y-1/2 w-80">
            <div className="bg-white/95 text-stone-900 rounded-2xl p-4 shadow-2xl border border-white/20">
              <div className="flex items-center gap-3">
                <div className="p-3 rounded-xl bg-accent text-stone-900"><Compass size={24} strokeWidth={1.5} /></div>
                <div>
                  <div className="text-sm font-semibold">快速了解：学生探索流程</div>
                  <div className="text-xs text-stone-500 mt-1">一个步骤化的、指导式表单，约 6 步完成档案</div>
                </div>
              </div>
              <ul className="mt-3 text-sm space-y-2">
                <li className="flex items-start gap-2"><span className="text-accent font-semibold">1.</span><span>选择标签（兴趣 / 技能 / 性格）</span></li>
                <li className="flex items-start gap-2"><span className="text-accent font-semibold">2.</span><span>上传词云与评价</span></li>
                <li className="flex items-start gap-2"><span className="text-accent font-semibold">3.</span><span>上传虚拟形象并确认提交</span></li>
              </ul>
              <div className="mt-3 text-right">
                <Link href="/form/create-profile" className="text-sm font-semibold text-accent hover:underline" aria-label="浏览学生探索流程">查看流程</Link>
              </div>
            </div>
          </div>
        </section>
      </main>
      <SiteFooter />
    </div>
  );
}
