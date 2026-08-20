import Link from "next/link";
import { Compass } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import SiteFooter from "@/components/SiteFooter";

// 强制动态渲染，避免 Next.js 静态预渲染添加 s-maxage 缓存头
export const dynamic = "force-dynamic";

export default function IndexPage() {
  return (
    <div className="flex flex-col min-h-screen bg-background pb-16 md:pb-0">
      <NavigationBar title="Career Explorer" showHome />
      <main className="flex-1">
        {/* 大字报深绿 hero：品牌深绿底 + 白字大标题 + 琥珀指南针装饰 */}
        <section className="bg-brand text-white">
          <div className="max-w-5xl mx-auto px-6 py-20 sm:py-28 space-y-6">
            <Compass size={48} strokeWidth={1.5} className="text-accent" aria-hidden />
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight">
              找到属于你的
              <br className="hidden sm:block" />
              职业方向
            </h1>
            <p className="text-white/80 text-lg max-w-xl leading-relaxed">
              通过兴趣、技能与性格标签，探索真实的自己，生成一份专属的职业探索档案。
            </p>
            <Link
              href="/form/student"
              className="inline-block mt-2 px-8 py-3.5 bg-accent text-stone-900 text-base font-semibold rounded-xl hover:brightness-105 transition-all shadow-lg"
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
