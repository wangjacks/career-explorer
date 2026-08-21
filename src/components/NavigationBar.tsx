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
    <div className="sticky top-0 z-40 flex items-center h-12 bg-brand px-4">
      <div className="flex items-center gap-2 w-24 md:w-auto">
        {showBack && (
          <button
            onClick={() => router.back()}
            aria-label="返回"
            className="flex items-center justify-center w-8 h-8 rounded-full text-white hover:bg-white/15 transition-colors"
          >
            <ChevronLeft size={20} />
          </button>
        )}
        {showHome && !showBack && (
          <button
            onClick={() => router.push("/")}
            aria-label="主页"
            className="flex items-center justify-center w-8 h-8 rounded-full text-white hover:bg-white/15 transition-colors"
          >
            <Home size={18} />
          </button>
        )}
      </div>
      <div className="flex-1 text-center md:text-left md:pl-3 text-sm font-medium text-white truncate">
        {title}
      </div>
      <div className="w-24" />
    </div>
  );
}
