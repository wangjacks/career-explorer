import Link from "next/link";
import NavigationBar from "@/components/NavigationBar";

// 强制动态渲染，避免 Next.js 静态预渲染添加 s-maxage 缓存头
export const dynamic = "force-dynamic";

export default function IndexPage() {
  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-green-50 to-white">
      <NavigationBar title="职业规划小程序" showHome />
      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <div className="w-20 h-20 rounded-2xl bg-green-500 flex items-center justify-center shadow-lg">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <circle cx="12" cy="12" r="10" />
            <path d="M12 16v-4M12 8h.01" />
          </svg>
        </div>
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-bold text-gray-900">职业规划</h1>
          <p className="text-gray-500 text-base">
            开始你的职业探索之旅
          </p>
        </div>
        <Link
          href="/student"
          className="w-full max-w-xs py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl text-center transition-colors shadow-md"
        >
          开始探索
        </Link>
      </main>
    </div>
  );
}
