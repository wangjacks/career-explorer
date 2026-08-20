"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "主页" },
  { href: "/about", label: "关于" },
];

/** 站点底部栏：产品名 + 页面导航（当前页高亮）+ 版权信息 */
export default function SiteFooter() {
  const pathname = usePathname();
  return (
    <footer className="border-t border-gray-100 bg-white/70 backdrop-blur-sm">
      <div className="max-w-6xl mx-auto px-6 py-6 flex flex-col sm:flex-row items-center justify-between gap-3">
        <p className="text-sm font-medium text-gray-600">Career Explorer</p>
        <nav className="flex items-center gap-6">
          {links.map((l) => {
            const active = pathname === l.href;
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`text-sm transition-colors ${
                  active ? "text-green-600 font-medium" : "text-gray-500 hover:text-gray-700"
                }`}
              >
                {l.label}
              </Link>
            );
          })}
        </nav>
        <p className="text-xs text-gray-400">© 2026 Career Explorer · 学生职业探索工具</p>
      </div>
    </footer>
  );
}
