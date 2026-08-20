import type { Metadata, Viewport } from "next";
import localFont from "next/font/local";
import { InstallGuard } from "@/components/InstallGuard";
import ErrorBoundary from "@/components/ErrorBoundary";
import UserMenu from "@/components/UserMenu";
import "./globals.css";

// MiSans 自托管（小米官方开源字体，免费商用），避免构建时依赖 Google Fonts
const miSans = localFont({
  src: [
    { path: "../fonts/MiSans-Regular.woff2", weight: "400" },
    { path: "../fonts/MiSans-Medium.woff2", weight: "500" },
    { path: "../fonts/MiSans-Semibold.woff2", weight: "600" },
    { path: "../fonts/MiSans-Bold.woff2", weight: "700" },
    { path: "../fonts/MiSans-Heavy.woff2", weight: "800" },
  ],
  variable: "--font-misans",
  display: "swap",
});

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
    <html
      lang="zh-CN"
      className={`${miSans.variable} h-full antialiased`}
    >
      {/* 防闪烁：hydration 前读 localStorage 主题，预设 .dark class（见 useTheme） */}
      <script
        dangerouslySetInnerHTML={{
          __html: `(function(){try{var t=localStorage.getItem('theme')||'system';var d=t==='dark'||(t==='system'&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`,
        }}
      />
      <body className="min-h-full flex flex-col">
        <ErrorBoundary>
          <InstallGuard>
            <UserMenu />
            {children}
          </InstallGuard>
        </ErrorBoundary>
      </body>
    </html>
  );
}
