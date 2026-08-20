"use client";

import { useRouter } from "next/navigation";
import { ChevronLeft, Home } from "lucide-react";

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

  return (
    <div className="sticky top-0 z-50 flex items-center h-12 bg-white/80 backdrop-blur-md border-b border-gray-100 px-4">
      <div className="flex items-center gap-2 w-24">
        {showBack && (
          <button
            onClick={() => router.back()}
            aria-label="返回"
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        {showHome && !showBack && (
          <button
            onClick={() => router.push("/")}
            aria-label="主页"
            className="flex items-center justify-center w-8 h-8 rounded-full hover:bg-gray-100 transition-colors"
          >
            <Home size={18} />
          </button>
        )}
      </div>
      <div className="flex-1 text-center text-sm font-medium text-gray-800 truncate">
        {title}
      </div>
      <div className="w-24" />
    </div>
  );
}
