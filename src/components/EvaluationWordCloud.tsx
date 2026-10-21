"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { WordCloudItem } from "@/types";
import { buildWordCloudLayout } from "@/lib/wordcloud-layout";
import { useTheme } from "@/hooks/useTheme";

interface EvaluationWordCloudProps {
  words: WordCloudItem[];
  height?: number;
  emptyText?: string;
  className?: string;
}

const LIGHT_COLORS = [
  "#1e3a5f", "#2d5a87", "#3b7dd8", "#4a90d9",
  "#5ba3e6", "#6bb5f0", "#b45309", "#c2410c",
  "#15803d", "#7e22ce", "#0f766e", "#a16207",
];

const DARK_COLORS = [
  "#7ab3e8", "#93c5f8", "#5ba3e6", "#6bb5f0",
  "#f0a45e", "#f27d7a", "#6fd3a5", "#c39be0",
  "#5ee0c9", "#f5c95b", "#9ecbff", "#f6c177",
];

/** FNV-1a：词汇颜色稳定，不随渲染顺序变化 */
function hashText(text: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i += 1) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** 他人评价词云（#162）：确定性布局，无随机数、无动画 */
export default function EvaluationWordCloud({
  words,
  height = 300,
  emptyText = "暂无他人评价",
  className = "",
}: EvaluationWordCloudProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const update = () => setWidth(el.clientWidth);
    update();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", update);
      return () => window.removeEventListener("resize", update);
    }
    const observer = new ResizeObserver(update);
    observer.observe(el);
    return () => observer.disconnect();
    // 空词时挂载的是占位容器；words 从 0→N 时组件不会重新挂载，必须重新测量
  }, [words.length]);

  const isDark = theme === "dark" || (theme === "system" && systemDark);
  const palette = isDark ? DARK_COLORS : LIGHT_COLORS;
  const placed = useMemo(
    () => buildWordCloudLayout(words, width, height),
    [words, width, height]
  );

  if (words.length === 0) {
    return (
      <div
        ref={containerRef}
        role="status"
        className={`flex items-center justify-center rounded-xl bg-gray-50 text-sm text-muted dark:bg-gray-800/50 ${className}`}
        style={{ height }}
      >
        {emptyText}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`他人评价词云：${words.map((word) => word.text).join("、")}`}
      className={`relative overflow-hidden rounded-xl border border-border-soft bg-card ${className}`}
      style={{ height }}
    >
      {placed.length === 0 ? (
        <div className="flex h-full flex-wrap content-center items-center justify-center gap-2 px-4">
          {words.slice(0, 12).map((word) => (
            <span
              key={word.text}
              className="rounded-full bg-gray-100 px-2.5 py-1 text-xs text-gray-700 dark:bg-gray-800 dark:text-gray-200"
            >
              {word.text}
            </span>
          ))}
        </div>
      ) : (
        placed.map((word, index) => (
          <span
            key={`${word.text}-${index}`}
            aria-hidden="true"
            className="absolute select-none whitespace-nowrap font-bold"
            style={{
              left: word.left,
              top: word.top,
              fontSize: word.fontSize,
              lineHeight: 1,
              color: palette[hashText(word.text) % palette.length],
              transform: "translate(-50%, -50%)",
            }}
          >
            {word.text}
          </span>
        ))
      )}
    </div>
  );
}
