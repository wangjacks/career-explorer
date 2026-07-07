"use client";

import { useRouter } from "next/navigation";

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
      </div>
      <div className="flex-1 text-center text-sm font-medium text-gray-800 truncate">
        {title}
      </div>
      <div className="w-24" />
    </div>
  );
}
