"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter, usePathname } from "next/navigation";

export function InstallGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);
  const [error, setError] = useState(false);

  const checkInstall = useCallback(() => {
    setError(false);
    setChecked(false);
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.installed) {
          router.replace("/setup");
        } else {
          setChecked(true);
        }
      })
      .catch(() => {
        setError(true);
      });
  }, [router]);

  /* eslint-disable react-hooks/set-state-in-effect -- async fetch callback, no cascade */
  useEffect(() => {
    if (pathname === "/setup" || pathname === "/api/setup/status") {
      setChecked(true);
      return;
    }
    checkInstall();
  }, [pathname, checkInstall]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (pathname === "/setup" || pathname === "/api/setup/status") {
    return <>{children}</>;
  }

  if (error) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <div className="text-center space-y-4">
          <p className="text-gray-600 text-sm">无法连接服务器，请检查网络后重试</p>
          <button
            onClick={checkInstall}
            className="px-4 py-2 bg-green-500 hover:bg-green-600 text-white text-sm font-medium rounded-lg transition-colors"
          >
            重试
          </button>
        </div>
      </div>
    );
  }

  if (!checked) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return <>{children}</>;
}
