import Link from "next/link";
import { cookies } from "next/headers";
import { Compass } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import SiteFooter from "@/components/SiteFooter";
import { verifyToken } from "@/lib/token";
import { resolveExploreHref } from "@/lib/role-home";

// cookies() 是请求时 API，已使本路由按请求动态渲染；这里保留显式声明，避免被误加静态缓存
export const dynamic = "force-dynamic";

export default async function IndexPage() {
  // 首屏即给出正确 href：已登录直达本人面板，未登录直达登录页
  const token = (await cookies()).get("auth_token")?.value;
  const session = token ? await verifyToken(token) : { valid: false };
  const exploreHref = resolveExploreHref(session);

  return (
    <div className="flex flex-col min-h-screen md:h-dvh bg-background overflow-x-clip">
      <NavigationBar title="Career Explorer" showHome />
      <main className="flex-1 flex flex-col">
        {/* 大字报深绿 hero：品牌深绿底 + 白字大标题 + 琥珀指南针装饰（flex-1 撑满顶栏与页脚之间） */}
        <section className="flex-1 bg-brand text-white flex items-center">
          <div className="max-w-5xl mx-auto px-6 py-8 sm:py-28 space-y-5 sm:space-y-6 w-full">
            <Compass size={48} strokeWidth={1.5} className="text-accent animate-[hero-compass_1.6s_both]" aria-hidden />
            <h1 className="text-4xl sm:text-5xl font-extrabold tracking-tight leading-tight animate-[hero-slide-in_0.7s_cubic-bezier(0.33,1,0.68,1)_1.3s_both]">
              找到属于你的
              <br className="hidden sm:block" />
              职业方向
            </h1>
            <p className="text-white/80 text-lg max-w-xl leading-relaxed animate-[hero-slide-in_0.7s_cubic-bezier(0.33,1,0.68,1)_1.5s_both]">
              通过兴趣、技能与性格标签，探索真实的自己，生成一份专属的职业探索档案。
            </p>
            <Link
              href={exploreHref}
              className="inline-block mt-2 px-8 py-3.5 bg-accent text-stone-900 text-base font-semibold rounded-xl hover:brightness-105 transition-all shadow-lg animate-[hero-slide-in_0.7s_cubic-bezier(0.33,1,0.68,1)_1.7s_both]"
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
