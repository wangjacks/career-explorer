"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, Info } from "lucide-react";

const links = [
  { href: "/", label: "主页", icon: Home },
  { href: "/about", label: "关于", icon: Info },
];

/** 站点底部导航：移动端为 fixed 底部 Tab Bar（App 风格），桌面端为文档流页脚 */
export default function SiteFooter() {
  const pathname = usePathname();
  return (
    <>
      {/* 移动端：fixed 底部 Tab Bar */}
      <nav className="md:hidden fixed bottom-0 inset-x-0 z-40 bg-card/90 backdrop-blur-md border-t border-gray-100 dark:border-gray-700 pb-[env(safe-area-inset-bottom)]">
        <div className="flex items-stretch justify-around">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`flex flex-col items-center gap-0.5 py-2 px-6 text-xs transition-colors ${
                  active
                    ? "text-green-600 dark:text-green-400 font-medium"
                    : "text-gray-400 dark:text-gray-500 hover:text-gray-600 dark:hover:text-gray-300"
                }`}
              >
                <l.icon size={20} strokeWidth={active ? 2.2 : 1.8} />
                {l.label}
              </Link>
            );
          })}
        </div>
      </nav>

      {/* 桌面端：固定底部导航条（便于随时切换页面） */}
      <footer className="hidden md:block fixed bottom-0 inset-x-0 z-40 border-t border-gray-100 dark:border-gray-700 bg-card/90 backdrop-blur-md">
        <div className="max-w-6xl mx-auto px-6 py-3.5 flex items-center justify-between gap-3">
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Career Explorer</p>
          <nav className="flex items-center gap-6">
            {links.map((l) => {
              const active = pathname === l.href;
              return (
                <Link
                  key={l.href}
                  href={l.href}
                  className={`text-sm transition-colors ${
                    active
                      ? "text-green-600 dark:text-green-400 font-medium"
                      : "text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                  }`}
                >
                  {l.label}
                </Link>
              );
            })}
          </nav>
          <p className="text-xs text-gray-400 dark:text-gray-500">© {new Date().getFullYear()} Career Explorer · 学生职业探索工具</p>
        </div>
      </footer>
    </>
  );
}
