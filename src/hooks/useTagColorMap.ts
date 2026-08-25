"use client";

import { useEffect, useState } from "react";
import { TAG_CHIP_COLORS, type TagCategory } from "@/components/TagSelector";

/**
 * 标签三色映射（#95）：按 /api/tags 返回的分类顺序循环三色（与「我的标签」展示态一致），
 * 返回 Map<标签名, 颜色 class>；未匹配任何分类的标签（如历史快照中的已删除标签）由调用方兜底第一种颜色。
 * 供学生历史提交 / 管理端提交历史 / 档案详情版本历史的标签着色复用。
 */
export function useTagColorMap(): Map<string, string> {
  const [colorMap, setColorMap] = useState<Map<string, string>>(new Map());

  useEffect(() => {
    let cancelled = false;
    fetch("/api/tags")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error("标签加载失败"))))
      .then((data) => {
        if (cancelled) return;
        const categories = (data.categories || []) as TagCategory[];
        const next = new Map<string, string>();
        categories.forEach((cat, catIdx) => {
          const color = TAG_CHIP_COLORS[catIdx % TAG_CHIP_COLORS.length];
          cat.tags.forEach((t) => next.set(t.name, color));
        });
        setColorMap(next);
      })
      .catch((err) => {
        console.error("Failed to load tag color map:", err);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return colorMap;
}
