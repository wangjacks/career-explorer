"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export interface SessionInfo {
  role: string;
  name: string;
}

export interface UseSessionResult {
  /** 已登录会话；null = 未登录 */
  session: SessionInfo | null;
  /** 首次检测是否完成（未完成时调用方应隐藏状态 UI 避免闪现） */
  checking: boolean;
}

/**
 * 共享会话检测 hook（httpOnly cookie 不可被前端读取，须经 GET /api/auth 检测）。
 * 根布局组件在路由切换时不重挂载，故监听 pathname 变化重新检测。
 */
export function useSession(): UseSessionResult {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checking, setChecking] = useState(true);

  useEffect(() => {
    let cancelled = false;
    fetch("/api/auth")
      .then(async (res) => ({ ok: res.ok, data: await res.json() }))
      .then(({ ok, data }) => {
        if (cancelled) return;
        setSession(ok && data.role && data.name ? { role: data.role, name: data.name } : null);
        setChecking(false);
      })
      .catch(() => {
        if (cancelled) return;
        setSession(null);
        setChecking(false);
      });
    return () => {
      cancelled = true;
    };
  }, [pathname]);

  return { session, checking };
}
