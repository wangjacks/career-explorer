"use client";

import { useCallback, useEffect, useState } from "react";
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
  /** 主动重新检测当前会话 */
  refresh: () => Promise<void>;
}

/**
 * 共享会话检测 hook（httpOnly cookie 不可被前端读取，须经 GET /api/auth 检测）。
 * 根布局组件在路由切换时不重挂载，故监听 pathname 变化重新检测。
 */
export function useSession(): UseSessionResult {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionInfo | null>(null);
  const [checking, setChecking] = useState(true);

  const refresh = useCallback(async () => {
    setChecking(true);
    try {
      const res = await fetch("/api/auth");
      const data = await res.json();
      setSession(res.ok && data.role && data.name ? { role: data.role, name: data.name } : null);
    } catch {
      setSession(null);
    } finally {
      setChecking(false);
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- refresh synchronizes with the auth API */
  useEffect(() => {
    void refresh();
  }, [pathname, refresh]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return { session, checking, refresh };
}
