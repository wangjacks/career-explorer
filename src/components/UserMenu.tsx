"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "@/hooks/useSession";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  teacher: "教师",
  student: "学生",
};

const APP_PAGES = new Set([
  "/",
  "/login",
  "/register",
  "/setup",
  "/dashboard/admin",
  "/dashboard/student",
  "/dashboard/teacher",
  "/form/student",
  "/form/tags",
  "/form/wordcloud",
  "/form/evaluation",
  "/form/avatar",
  "/form/complete",
]);

function shouldShowMenu(pathname: string | null): boolean {
  if (!pathname) return false;
  const normalizedPath = pathname.replace(/\/+$/, "") || "/";
  if (["/login", "/register", "/setup"].includes(normalizedPath)) return false;
  return APP_PAGES.has(normalizedPath);
}

/** 全局右上角用户菜单：统一使用下拉菜单容器展示登录状态和操作 */
export default function UserMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, checking, refresh } = useSession();
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
  if (checking || !shouldShowMenu(pathname)) return null;

  const handleLogout = async () => {
    setOpen(false);
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch (err) {
      console.error("Logout failed:", err);
    }
    await refresh();
    router.push("/");
  };

  return (
    <div className="fixed top-0 right-0 z-[60] flex items-center h-12 px-4">
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-gray-700 rounded-lg hover:bg-gray-100 transition-colors"
        >
          <span className="max-w-24 truncate">{session?.name ?? "未登录"}</span>
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
          <div role="menu" className="absolute right-0 top-full mt-2 w-48 bg-white rounded-xl shadow-lg border border-gray-100 py-2">
            {session ? (
              <>
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
              </>
            ) : (
              <>
                <div className="px-4 py-2 border-b border-gray-100">
                  <p className="text-sm font-medium text-gray-900">未登录</p>
                  <p className="text-xs text-gray-400 mt-0.5">登录后管理个人信息</p>
                </div>
                <button
                  onClick={() => {
                    setOpen(false);
                    router.push("/login");
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-green-50 transition-colors"
                >
                  登录
                </button>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
