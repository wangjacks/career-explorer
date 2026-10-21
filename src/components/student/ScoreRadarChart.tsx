"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import type { RadarPoint } from "@/lib/assessment-view";

/**
 * 通用得分雷达图（#292，由 #224 的 `RiasecRadarChart` 抽出）。
 *
 * 只认「顶点 + 系列名」：维度顺序、中文标签、量程都由调用方给的 `points` 决定，
 * 组件本身不认任何一套量表，也不读得分（雷达看形状，精确值由条状排名负责）。
 * 样式与配色沿用 #224：品牌绿描边 + 25% 填充、固定 0–100 量程且不画半径刻度。
 */
export default function ScoreRadarChart({
  points,
  seriesName,
  ariaLabel,
}: {
  points: readonly RadarPoint[];
  seriesName: string;
  ariaLabel: string;
}) {
  return (
    <div className="h-[220px] w-full text-muted" role="img" aria-label={ariaLabel}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={points} outerRadius="72%">
          <PolarGrid stroke="currentColor" strokeOpacity={0.25} />
          <PolarAngleAxis dataKey="label" tick={{ fontSize: 11, fill: "currentColor" }} />
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name={seriesName}
            dataKey="standard"
            stroke="#059669"
            strokeWidth={2}
            fill="#059669"
            fillOpacity={0.25}
            isAnimationActive={false}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
}
