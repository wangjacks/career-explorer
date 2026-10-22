"use client";

import ScoreRadarChart from "./ScoreRadarChart";
import { buildRadarPoints } from "@/lib/assessment-view";
import { RIASEC_KEYS, RIASEC_LABELS } from "@/lib/assessment-match";
import type { DimensionScore } from "@/lib/assessment-scoring";

/** 霍兰德雷达的顶点顺序固定 R-I-A-S-E-C（#224 口径），样式交给通用 `ScoreRadarChart`（#292） */
const RIASEC_RADAR_DIMENSIONS = RIASEC_KEYS.map((key) => ({ key, label: RIASEC_LABELS[key] }));

/** 六型兴趣雷达图（#224）：复用项目已有的 recharts，不引新依赖 */
export default function RiasecRadarChart({ scores }: { scores: readonly DimensionScore[] }) {
  return (
    <ScoreRadarChart
      points={buildRadarPoints(scores, RIASEC_RADAR_DIMENSIONS)}
      seriesName="兴趣得分"
      ariaLabel="六型兴趣得分雷达图"
    />
  );
}
