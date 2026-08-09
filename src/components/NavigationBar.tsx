"use client";

import { useRouter, usePathname } from "next/navigation";
import { useSession } from "@/hooks/useSession";

interface NavigationBarProps {
  title?: string;
  showBack?: boolean;
  showHome?: boolean;
}

export default function NavigationBar({
  title,
  showBack = false,
  showHome = false,
}: NavigationBarProps) {
  const router = useRouter();
  const pathname = usePathname();
  const { session, checking } = useSession();

  // 未登录 + /form 提交流程：显示「快速提交模式」标识（检测中不显示避免闪现）
  const quickMode = !checking && !session && pathname.startsWith("/form");
  const sideWidth = quickMode ? "w-40" : "w-24";

  return (
    <div className="sticky top-0 z-50 flex items-center h-12 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4">
      <div className={`flex items-center gap-2 ${sideWidth}`}>
        {showBack && (
          <button
            onClick={() => router.back()}
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M15 18l-6-6 6-6" />
            </svg>
          </button>
        )}
        {showHome && !showBack && (
          <button
            onClick={() => router.push("/")}
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 transition-colors"
          >
            <svg
              width="18"
              height="18"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z" />
              <polyline points="9 22 9 12 15 12 15 22" />
            </svg>
          </button>
        )}
        {quickMode && (
          <span
            title="当前未登录，以快速提交模式填写表单"
            className="flex items-center gap-1 px-2 py-0.5 bg-blue-50 text-blue-600 rounded-full text-xs whitespace-nowrap"
          >
            <svg
              className="w-3.5 h-3.5 flex-shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z"
              />
            </svg>
            快速提交模式
          </span>
        )}
      </div>
      <div className="flex-1 text-center text-sm font-medium text-gray-800 truncate">
        {title}
      </div>
      <div className={sideWidth} />
    </div>
  );
}
