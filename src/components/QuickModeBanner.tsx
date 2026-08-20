"use client";

import { usePathname } from "next/navigation";
import { Info } from "lucide-react";
import { useSession } from "@/hooks/useSession";

/**
 * 快速提交模式横幅：未登录访问 /form/* 时显示在导航栏下方。
 * 会话检测中不渲染，避免闪现；已登录或非表单页不渲染。
 */
export default function QuickModeBanner() {
  const { session, checking } = useSession();
  const pathname = usePathname();

  if (checking || session || !pathname.startsWith("/form")) return null;

  return (
    <div className="flex items-center gap-1.5 px-4 py-1.5 bg-blue-50 border-b border-blue-100 text-blue-600 text-xs">
      <Info className="w-3.5 h-3.5 flex-shrink-0" />
      快速提交模式
    </div>
  );
}
