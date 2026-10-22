/**
 * 教师端测评名册的档位口径（#313）：纯函数，组件不自己算数。
 *
 * #314/#315 的新看板自带展示口径（`teacher-board.ts`），#232 三视图卡及其配色/排序/
 * 下钻纯函数已随旧卡删除；本文件只留名册弹窗共用的档位换算。
 */

import { bandOf, type ScoreBand } from "./assessment-scoring";
import { parseScores } from "./assessment-flow";

/** 名册档位行（#313，dimensional 量表用）：只有维度名与高/中/低档，**不含 raw / standard** */
export interface AssessmentRosterBand {
  key: string;
  label: string;
  band: ScoreBand;
}

/**
 * 结果快照 → 名册档位（#313）：教师看的是「这一维偏高还是偏低」，不是分数。
 *
 * 快照里的 `band` 由计分引擎写入；旧快照缺 `band` 时按 `standard` 用 `bandOf` 兜底
 * （与学生端解读同一口径）。解析失败/非数组一律返回空数组：脏数据只让这一行没有档位，不阻断整张名册。
 */
export function rosterBands(scoresJson: string | null | undefined): AssessmentRosterBand[] {
  return parseScores(scoresJson).map((score) => ({
    key: score.key,
    label: score.label,
    band: score.band ?? bandOf(score.standard),
  }));
}
