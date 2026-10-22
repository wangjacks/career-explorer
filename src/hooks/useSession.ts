"use client";

import { useCallback, useEffect, useState } from "react";
import { usePathname } from "next/navigation";

export interface SessionInfo {
  role: string;
  uid: number | null;
  name: string;
  /** 演示会话标志（服务端 GET /api/auth 下发）；false/缺省 = 生产会话 */
  demo?: boolean;
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
      // 只有明确的未登录 / 无权限才清空会话；5xx 与网络错误保留旧会话，
      // 避免面板 Tab 路由切换时的瞬时失败把已登录用户踢回登录页。
      if (res.status === 401 || res.status === 403) {
        setSession(null);
        return;
      }
      if (!res.ok) {
        console.error(`Session check failed: HTTP ${res.status}`);
        return;
      }
      const data = await res.json();
      setSession(
        data.role && data.name
          ? {
              role: data.role,
              uid: typeof data.uid === "number" ? data.uid : null,
              name: data.name,
              demo: data.demo === true,
            }
          : null
      );
    } catch (err) {
      console.error("Session check failed:", err);
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
