"use client";

import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { FlaskConical } from "lucide-react";
import { toast } from "sonner";
import { useSession } from "@/hooks/useSession";
import {
  ROLE_DASHBOARD,
  ROLE_LABELS,
  demoSwitchTargets,
  isDemoSession,
} from "@/lib/demo-view";
import type { Role } from "@/lib/token";

/**
 * 演示横幅 + 角色切换器（#256）。仅在 demo 会话渲染（服务端 GET /api/auth 下发 demo 标志）。
 * 在流顶部条（紧随 NavigationBar），不新增 z-index 层级；切换成功后刷新会话并跳到目标面板。
 */
export default function DemoBanner() {
  const { session, checking, refresh } = useSession();
  const router = useRouter();
  const pathname = usePathname();
  const [switching, setSwitching] = useState<Role | null>(null);

  // 检测未完成或非演示会话：一律不渲染，避免普通用户看到/闪烁
  if (checking || !isDemoSession(session) || !session) return null;

  const currentRole = session.role;
  const currentLabel = ROLE_LABELS[currentRole as Role] ?? currentRole;

  const switchTo = async (role: Role) => {
    if (switching) return;
    setSwitching(role);
    try {
      const res = await fetch("/api/auth/demo-switch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const data = (await res.json().catch(() => ({}))) as { error?: unknown };
      if (!res.ok) {
        toast.error(typeof data.error === "string" ? data.error : "切换失败");
        return;
      }
      toast.success(`已切换到${ROLE_LABELS[role]}视角`);
      await refresh();
      const target = ROLE_DASHBOARD[role];
      // 用 replace 而非 push：避免后退回到角色不匹配的旧面板（会被重定向到登录页）
      if (target && target !== pathname) router.replace(target);
    } catch (err) {
      console.error("Demo role switch error:", err);
      toast.error("切换失败，请重试");
    } finally {
      setSwitching(null);
    }
  };

  return (
    <div role="status" aria-live="polite" className="border-y border-warning/30 bg-warning/10 text-warning-strong">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2 px-4 py-2 sm:px-6">
        <FlaskConical className="h-4 w-4 flex-shrink-0" aria-hidden />
        <p className="text-sm">演示模式 · 数据为隔离演示数据，可随时重置</p>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="text-xs opacity-80">当前：{currentLabel}</span>
          {demoSwitchTargets(currentRole).map(({ role, label }) => (
            <button
              key={role}
              type="button"
              onClick={() => void switchTo(role)}
              disabled={switching !== null}
              className="rounded-md border border-warning/40 bg-background/60 px-2.5 py-1 text-xs font-medium hover:bg-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-warning/60 disabled:opacity-50"
            >
              {switching === role ? "切换中…" : `切换到${label}`}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
