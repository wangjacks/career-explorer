"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { ChevronDown, Sun, Moon, Monitor } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import { useTheme, type Theme } from "@/hooks/useTheme";

const ROLE_LABEL: Record<string, string> = {
  admin: "管理员",
  teacher: "教师",
  student: "学生",
};

const APP_PAGES = new Set([
  "/",
  "/about",
  "/login",
  "/activate",
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
  if (["/login", "/activate", "/setup"].includes(normalizedPath)) return false;
  return APP_PAGES.has(normalizedPath);
}

/** 全局右上角用户菜单：统一使用下拉菜单容器展示登录状态和操作 */
export default function UserMenu() {
  const pathname = usePathname();
  const router = useRouter();
  const { session, checking, refresh } = useSession();
  const { theme, setTheme } = useTheme();
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
    <div className="fixed top-0 right-0 z-[45] flex items-center h-12 px-4">
      <div ref={containerRef} className="relative">
        <button
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-haspopup="menu"
          className="flex items-center gap-1 px-3 py-1.5 text-sm font-medium text-white rounded-lg hover:bg-white/15 transition-colors"
        >
          <span className="max-w-24 truncate">{session?.name ?? "未登录"}</span>
          <ChevronDown
            className={`w-3.5 h-3.5 text-white/70 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
        {open && (
          <div role="menu" className="absolute right-0 top-full mt-2 w-48 bg-card rounded-xl shadow-lg border border-gray-100 dark:border-gray-700 py-2">
            {/* 主题切换（浅色/深色/跟随系统） */}
            <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
              <p className="text-xs text-gray-400 mb-1.5">主题</p>
              <div className="flex gap-1">
                {([["light", Sun, "浅色"], ["dark", Moon, "深色"], ["system", Monitor, "系统"]] as [Theme, typeof Sun, string][]).map(([value, Icon, label]) => (
                  <button
                    key={value}
                    onClick={() => setTheme(value)}
                    aria-label={`主题：${label}`}
                    aria-pressed={theme === value}
                    className={`flex-1 flex items-center justify-center px-2 py-1.5 rounded-lg transition-colors ${
                      theme === value
                        ? "bg-primary-soft text-primary-strong"
                        : "text-gray-500 hover:bg-gray-50 dark:text-gray-400 dark:hover:bg-gray-700"
                    }`}
                  >
                    <Icon size={15} />
                  </button>
                ))}
              </div>
            </div>
            {session ? (
              <>
                <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">{session.name}</p>
                  <p className="text-xs text-gray-400 mt-0.5">{ROLE_LABEL[session.role] ?? session.role}</p>
                </div>
                <button
                  onClick={() => {
                    setOpen(false);
                    router.push(`/dashboard/${session.role}`);
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 dark:text-gray-200 dark:hover:bg-gray-700 transition-colors"
                >
                  个人信息
                </button>
                <button
                  onClick={handleLogout}
                  className="w-full text-left px-4 py-2 text-sm text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors"
                >
                  退出登录
                </button>
              </>
            ) : (
              <>
                <div className="px-4 py-2 border-b border-gray-100 dark:border-gray-700">
                  <p className="text-sm font-medium text-gray-900 dark:text-gray-100">未登录</p>
                  <p className="text-xs text-gray-400 mt-0.5">登录后管理个人信息</p>
                </div>
                <button
                  onClick={() => {
                    setOpen(false);
                    router.push("/login");
                  }}
                  className="w-full text-left px-4 py-2 text-sm text-green-600 hover:bg-green-50 dark:text-green-400 dark:hover:bg-green-900/20 transition-colors"
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
