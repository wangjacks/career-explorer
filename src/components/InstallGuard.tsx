"use client";

import { useEffect, useState } from "react";
import { useRouter, usePathname } from "next/navigation";

export function InstallGuard({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const pathname = usePathname();
  const [checked, setChecked] = useState(false);

  /* eslint-disable react-hooks/set-state-in-effect -- async fetch callback, no cascade */
  useEffect(() => {
    if (pathname === "/setup" || pathname === "/api/setup/status") {
      setChecked(true);
      return;
    }

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
        setChecked(true);
      });
  }, [pathname, router]);
  /* eslint-enable react-hooks/set-state-in-effect */

  if (pathname === "/setup" || pathname === "/api/setup/status") {
    return <>{children}</>;
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
