"use client";

import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { buildRadarPoints } from "@/lib/assessment-view";
import type { DimensionScore } from "@/lib/assessment-scoring";

/** 六型兴趣雷达图（#224）：复用项目已有的 recharts，不引新依赖 */
export default function RiasecRadarChart({ scores }: { scores: readonly DimensionScore[] }) {
  const points = buildRadarPoints(scores);

  return (
    <div className="h-[220px] w-full text-muted" role="img" aria-label="六型兴趣得分雷达图">
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={points} outerRadius="72%">
          <PolarGrid stroke="currentColor" strokeOpacity={0.25} />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fontSize: 11, fill: "currentColor" }}
          />
          {/* 量程固定 0–100 且不画刻度：雷达图看的是形状，精确值由右侧条状排名/悬停读数负责 */}
          <PolarRadiusAxis domain={[0, 100]} tick={false} axisLine={false} />
          <Radar
            name="兴趣得分"
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
