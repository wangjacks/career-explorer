"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  teacher: "教师",
  student: "学生",
};

/** 全局右上角用户菜单：未登录显示「登录」按钮，已登录显示姓名 + 下拉菜单 */
export default function UserMenu() {
  const router = useRouter();
  const { session, checking } = useSession();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // 点击菜单外部时收起下拉
  useEffect(() => {
    if (!open) return;
    const onMouseDown = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    return () => document.removeEventListener("mousedown", onMouseDown);
  }, [open]);

  // 检测中不渲染，避免「登录」按钮闪现
  if (checking) return null;

  const handleLogout = async () => {
    setOpen(false);
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch (err) {
      console.error("Logout failed:", err);
    }
    router.push("/");
  };

  return (
    <div className="fixed top-0 right-0 z-[60] flex items-center h-12 px-4">
      {!session ? (
        <button
          onClick={() => router.push("/login")}
          className="px-3 py-1.5 text-sm font-medium text-green-600 border border-green-500 rounded-lg hover:bg-green-50 transition-colors"
        >
          登录
        </button>
      ) : (
        <div ref={containerRef} className="relative">
          <button
            onClick={() => setOpen((v) => !v)}
            className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
          >
            <span className="max-w-24 truncate">{session.name}</span>
            <svg
              className={`w-3.5 h-3.5 text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </button>
          {open && (
            <div className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2">
              <div className="px-4 py-2 border-b border-gray-100">
                <p className="text-sm font-medium text-gray-900 truncate">{session.name}</p>
                <p className="text-xs text-gray-400 mt-0.5">{ROLE_LABEL[session.role] ?? session.role}</p>
              </div>
              <button
                onClick={() => {
                  setOpen(false);
                  router.push(`/dashboard/${session.role}`);
                }}
                className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
              >
                个人信息
              </button>
              <button
                onClick={handleLogout}
                className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 transition-colors"
              >
                退出登录
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
