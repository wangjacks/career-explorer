import type { Metadata, Viewport } from "next";
import ErrorBoundary from "@/components/ErrorBoundary";
import UserMenu from "@/components/UserMenu";
import "./globals.css";

// 字体：Noto Sans SC（Google Fonts）。运行时 <link> 加载，构建无需外网；
// unicode-range 分包按需下载，避免全量中文字体拖慢冷缓存首屏。
// 镜像前缀可选：FONT_CDN_PREFIX（如 https://fonts.loli.net）；默认 Google Fonts 官方域名
const FONT_CDN_PREFIX = (
  process.env.FONT_CDN_PREFIX || "https://fonts.googleapis.com"
).replace(/\/+$/, "");

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export const metadata: Metadata = {
  title: "Career Explorer",
  description: "开始你的职业探索之旅",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="zh-CN" className="h-full antialiased" suppressHydrationWarning>
      <head>
        {/* Noto Sans SC：字重 400/500/600/700/800 覆盖全站 font-medium/semibold/bold/extrabold 用法 */}
        <link rel="preconnect" href={FONT_CDN_PREFIX} crossOrigin="anonymous" />
        <link
          rel="stylesheet"
          href={`${FONT_CDN_PREFIX}/css2?family=Noto+Sans+SC:wght@400;500;600;700;800&display=swap`}
        />
        {/* 防闪烁：hydration 前读 localStorage 主题，预设 .dark class（见 useTheme）；
            suppressHydrationWarning 拑制内联脚本添加 dark class 引发的 html 属性 mismatch */}
        <script
          dangerouslySetInnerHTML={{
            __html: `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <ErrorBoundary>
          <UserMenu />
          {children}
        </ErrorBoundary>
      </body>
    </html>
  );
}
