"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

/**
 * 安装检测守卫：乐观渲染——默认直接渲染页面内容，仅在检测到未安装时跳转 /setup、
 * 请求失败时显示重试。避免旧版「先 loading 屏再渲染」导致的页面闪烁。
 */
export function InstallGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [error, setError] = useState(false);

  const checkInstall = useCallback(() => {
    setError(false);
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.installed) {
          router.replace("/setup");
        }
      })
      .catch(() => {
        setError(true);
      });
  }, [router]);

  /* eslint-disable react-hooks/set-state-in-effect -- async fetch callback, no cascade */
  useEffect(() => {
    if (pathname === "/setup" || pathname === "/api/setup/status") return;
    checkInstall();
  }, [pathname, checkInstall]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (pathname === "/setup" || pathname === "/api/setup/status") {
    return <>{children}</>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-foreground text-sm">无法连接服务器，请检查网络后重试</p>
          <button
            onClick={checkInstall}
            className="px-4 py-2 bg-primary hover:bg-primary-strong text-white text-sm font-medium rounded-lg transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
