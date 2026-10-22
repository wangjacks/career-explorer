"use client";

import ScoreRadarChart from "./ScoreRadarChart";
import { buildRadarPoints } from "@/lib/assessment-view";
import { chartAriaLabel } from "@/lib/profile-ui";
import { RIASEC_KEYS, RIASEC_LABELS } from "@/lib/assessment-match";
import type { DimensionScore } from "@/lib/assessment-scoring";

/** 霍兰德雷达的顶点顺序固定 R-I-A-S-E-C（#224 口径），样式交给通用 `ScoreRadarChart`（#292） */
const RIASEC_RADAR_DIMENSIONS = RIASEC_KEYS.map((key) => ({ key, label: RIASEC_LABELS[key] }));

/** 六型兴趣雷达图（#224）：复用项目已有的 recharts，不引新依赖 */
export default function RiasecRadarChart({ scores }: { scores: readonly DimensionScore[] }) {
  const points = buildRadarPoints(scores, RIASEC_RADAR_DIMENSIONS);
  return (
    <ScoreRadarChart
      points={points}
      seriesName="兴趣得分"
      // #324：读屏要能读到每一维的分数，不能只描述「这是一张雷达图」
      ariaLabel={chartAriaLabel("六型兴趣得分雷达图", points)}
    />
  );
}
