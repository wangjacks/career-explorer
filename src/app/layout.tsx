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
