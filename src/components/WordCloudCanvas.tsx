"use client";

import { useEffect, useRef, useState } from "react";
import { useTheme } from "@/hooks/useTheme";

interface WordCloudCanvasProps {
  words: string[];
}

const LIGHT_COLORS = [
  "#1e3a5f", "#2d5a87", "#3b7dd8", "#4a90d9",
  "#5ba3e6", "#6bb5f0", "#e67e22", "#e74c3c",
  "#27ae60", "#8e44ad", "#16a085", "#f39c12",
];

const DARK_COLORS = [
  "#7ab3e8", "#93c5f8", "#5ba3e6", "#6bb5f0",
  "#f0a45e", "#f27d7a", "#6fd3a5", "#c39be0",
  "#5ee0c9", "#f5c95b",
];

interface PlacedWord {
  text: string;
  fontSize: number;
  colorIndex: number;
  left: number;
  top: number;
  rotate: number;
}

function generateLayout(words: string[], width: number, height: number): PlacedWord[] {
  if (words.length === 0) return [];

  const placed: PlacedWord[] = [];
  const centerX = width / 2;
  const centerY = height / 2;

  words.forEach((text, i) => {
    const angle = (i / words.length) * Math.PI * 2;
    const radius = 40 + Math.random() * 60;
    const fontSize = 18 + Math.random() * 18;
    const colorIndex = Math.floor(Math.random() * LIGHT_COLORS.length);
    const rotate = (Math.random() - 0.5) * 30;

    let left = centerX + Math.cos(angle) * radius;
    let top = centerY + Math.sin(angle) * radius;

    left = Math.max(10, Math.min(width - 80, left));
    top = Math.max(10, Math.min(height - 30, top));

    placed.push({ text, fontSize, colorIndex, left, top, rotate });
  });

  return placed;
}

export default function WordCloudCanvas({ words }: WordCloudCanvasProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [placedWords, setPlacedWords] = useState<PlacedWord[]>([]);
  const { theme } = useTheme();
  const [systemDark, setSystemDark] = useState(false);

  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const sync = () => setSystemDark(mq.matches);
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const isDark = theme === "dark" || (theme === "system" && systemDark);

  useEffect(() => {
    if (words.length === 0 || !containerRef.current) return;

    const width = containerRef.current.clientWidth;
    const height = 300;

    requestAnimationFrame(() => {
      setPlacedWords(generateLayout(words, width, height));
    });
  }, [words]);

  if (words.length === 0) {
    return (
      <div role="status" className="flex items-center justify-center h-[300px] bg-gray-50 dark:bg-gray-800/50 rounded-xl text-muted">
        暂无标签数据
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      role="img"
      aria-label={`学生标签词云：${words.join("、")}`}
      className="relative bg-card rounded-xl shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden"
      style={{ height: 300 }}
    >
      {placedWords.map((w, i) => (
        <span
          key={`${w.text}-${i}`}
          className="absolute font-bold whitespace-nowrap select-none"
          style={{
            left: w.left,
            top: w.top,
            fontSize: w.fontSize,
            color: (isDark ? DARK_COLORS : LIGHT_COLORS)[w.colorIndex],
            transform: `translate(-50%, -50%) rotate(${w.rotate}deg)`,
          }}
        >
          {w.text}
        </span>
      ))}
    </div>
  );
}
