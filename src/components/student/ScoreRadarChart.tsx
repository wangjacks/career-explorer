"use client";

import { Component, useEffect, useRef, useState, type ReactNode } from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
} from "recharts";
import type { RadarPoint } from "@/lib/assessment-view";

/**
 * 通用得分雷达图（#292，由 #224 的 `RiasecRadarChart` 抽出）。
 *
 * 只认「顶点 + 系列名」：维度顺序、中文标签、量程都由调用方给的 `points` 决定，
 * 组件本身不认任何一套量表，也不读得分（雷达看形状，精确值由条状排名负责）。
 *
 * 空框兜底（#322）：不再用 `ResponsiveContainer` 的百分比宽度（父容器在 grid/flex 下
 * 可能量到 0，结果只剩一个空边框），改为**先量容器宽度、再用显式宽高画图**：
 * - 宽度为 0 → 不渲染图表框（条形排名仍在并列位置）；
 * - 无顶点 → 不渲染；
 * - 图表渲染抛错 → 错误边界降级为一行说明，不让空白框留在页面上。
 */

const CHART_HEIGHT = 220;
/** 图表框内边距 px-2（左右各 8px）+ 1px 边框各一圈，显式宽度要扣掉 */
const CHART_CHROME_PX = 18;

function RadarUnavailable() {
  return (
    <div className="flex h-[220px] items-center justify-center px-4 text-center text-xs text-muted">
      图形暂时无法显示，请参考条形排名
    </div>
  );
}

class RadarErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error) {
    console.error("Radar chart render failed:", error);
  }

  render() {
    return this.state.failed ? <RadarUnavailable /> : this.props.children;
  }
}

export default function ScoreRadarChart({
  points,
  seriesName,
  ariaLabel,
}: {
  points: readonly RadarPoint[];
  seriesName: string;
  ariaLabel: string;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(0);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const measure = () => setWidth(Math.floor(el.getBoundingClientRect().width));
    measure();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(measure);
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  // 没有顶点时不画空框；条形排名已经在卡片里承担读数。
  // 注意容器始终挂载（只是高度为 0），这样 points 从空变为非空时宽度已经被量到
  return (
    <div ref={containerRef} className="min-w-0">
      {points.length > 0 && width > 0 && (
        <div
          role="img"
          aria-label={ariaLabel}
          className="rounded-lg border border-border-soft px-2 py-1 text-muted"
        >
          <RadarErrorBoundary>
            <RadarChart
              width={Math.max(1, width - CHART_CHROME_PX)}
              height={CHART_HEIGHT}
              data={[...points]}
              outerRadius="72%"
            >
              <PolarGrid stroke="currentColor" strokeOpacity={0.25} />
              <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "currentColor" }} />
              <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
              <Radar
                name={seriesName}
                dataKey="standard"
                // 雷达本体用语义 token 色（`text-primary` 给 path 上色，`currentColor` 再引用它）；
                // 坐标轴 / 网格仍继承外层 text-muted——不硬编码 #059669，也不把刻度和数据混成同色
                className="text-primary"
                stroke="currentColor"
                strokeWidth={2}
                fill="currentColor"
                fillOpacity={0.25}
                isAnimationActive={false}
              />
            </RadarChart>
          </RadarErrorBoundary>
        </div>
      )}
    </div>
  );
}
