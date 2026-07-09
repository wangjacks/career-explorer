"use client";

import { useEffect, useRef } from "react";
import { useRouter, usePathname } from "next/navigation";

export function InstallGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const checkedRef = useRef(false);

  useEffect(() => {
    if (pathname === "/setup" || pathname === "/api/setup/status") {
      checkedRef.current = true;
      return;
    }

    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (!data.installed) {
          router.replace("/setup");
        } else {
          checkedRef.current = true;
        }
      })
      .catch(() => {
        checkedRef.current = true;
      });
  }, [pathname, router]);

  if (pathname === "/setup" || pathname === "/api/setup/status") {
    return <>{children}</>;
  }

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center">
      <div className="w-8 h-8 border-4 border-green-500 border-t-transparent rounded-full animate-spin" />
    </div>
  );
}
