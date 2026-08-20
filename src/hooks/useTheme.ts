"use client";

import { useEffect, useState } from "react";

export type Theme = "light" | "dark" | "system";

const THEME_KEY = "theme";

function getSystemDark(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-color-scheme: dark)").matches;
}

/** 按主题应用 .dark class 到 <html>（layout.tsx 内联脚本在 hydration 前已预设，避免闪烁） */
export function applyTheme(theme: Theme) {
  const dark = theme === "dark" || (theme === "system" && getSystemDark());
  document.documentElement.classList.toggle("dark", dark);
}

/** 主题三态切换（浅色/深色/跟随系统），持久化 localStorage，默认 system */
export function useTheme() {
  const [theme, setThemeState] = useState<Theme>("system");

  /* eslint-disable react-hooks/set-state-in-effect -- 读 localStorage 初始主题 + 订阅系统主题变化 */
  useEffect(() => {
    const saved = localStorage.getItem(THEME_KEY) as Theme | null;
    if (saved === "light" || saved === "dark" || saved === "system") {
      setThemeState(saved);
    }
    // 跟随系统变化（仅 system 模式生效）
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      const current = (localStorage.getItem(THEME_KEY) as Theme | null) ?? "system";
      if (current === "system") applyTheme("system");
    };
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const setTheme = (t: Theme) => {
    setThemeState(t);
    localStorage.setItem(THEME_KEY, t);
    applyTheme(t);
  };

  return { theme, setTheme };
}
