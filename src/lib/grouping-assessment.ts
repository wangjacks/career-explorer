/**
 * 分组用的测评特征装载（#345）。
 *
 * 只做两件事：
 * 1) 按「当前启用量表」批查本班学生的**当前有效结果**（completed + is_current）；
 * 2) 转成 `AssessmentFeatureContext`（userId → 六型 / 大五四维标准分），交给分组算法。
 *
 * 硬约束（与 #345 一致）：**大五只取 C/E/O/A，N 不进入上下文**；取不到就当作缺测，
 * 绝不拿 0 分冒充「已测」。某套量表查询失败只让该源整体降级（该策略退化为只用其它源），
 * 不阻断分组本身——预览/生成仍可用。
 */

import { getAssessmentByCode, getCurrentAssessmentResultsByUserCodes } from "./db";
import { IPIP_NEO_FFI_CODE, RIASEC_CODE } from "./assessment-data";
import { parseScores } from "./assessment-flow";
import type { AssessmentFeatureContext, GroupingBigFiveKey } from "./grouping-features";
import { GROUPING_BIG_FIVE_KEYS } from "./grouping-features";
import type { RiasecKey } from "./assessment-match";

/** 参与分组的测评数据可用性（界面据此提示「本班还没有兴趣/性格数据」） */
export interface AssessmentFeatureAvailability {
  riasec: boolean;
  bigfive: boolean;
}

export interface LoadedAssessmentFeatureContext {
  context: AssessmentFeatureContext;
  available: AssessmentFeatureAvailability;
  /** 降级原因（量表层查询失败时记录，便于排查；正常为空） */
  degraded: string[];
}

/** 分组最少需要的学生形状：id + 学号（学号用于批查结果） */
export interface StudentRef {
  id: number;
  user_code: string;
}

/**
 * 纯函数：把结果快照转成上下文。
 *
 * `riasecRows` / `bigfiveRows` 是数据层的轻量快照（user_code + scores_json）。
 * 只保留标准分；解析失败 / 缺维时该学生不进入对应源（按缺测处理）。
 */
export function buildAssessmentFeatureContext(
  students: StudentRef[],
  riasecRows: { user_code: string; scores_json: string | null }[],
  bigfiveRows: { user_code: string; scores_json: string | null }[]
): AssessmentFeatureContext {
  const idByCode = new Map(students.map((student) => [student.user_code, student.id]));
  const riasec: AssessmentFeatureContext["riasec"] = new Map();
  const bigfive: AssessmentFeatureContext["bigfive"] = new Map();

  for (const row of riasecRows) {
    const userId = idByCode.get(row.user_code);
    if (userId === undefined) continue;
    const scores: Partial<Record<RiasecKey, number>> = {};
    for (const score of parseScores(row.scores_json)) {
      if (typeof score.standard === "number" && Number.isFinite(score.standard)) {
        scores[score.key as RiasecKey] = score.standard;
      }
    }
    if (Object.keys(scores).length > 0) riasec.set(userId, scores);
  }

  for (const row of bigfiveRows) {
    const userId = idByCode.get(row.user_code);
    if (userId === undefined) continue;
    const byKey = new Map(parseScores(row.scores_json).map((score) => [score.key, score.standard]));
    const scores: Partial<Record<GroupingBigFiveKey, number>> = {};
    // 只取 C/E/O/A：N 即使出现在快照里也不装进上下文（分组算法与界面都看不到它）
    for (const key of GROUPING_BIG_FIVE_KEYS) {
      const standard = byKey.get(key);
      if (typeof standard === "number" && Number.isFinite(standard)) scores[key] = standard;
    }
    if (Object.keys(scores).length === GROUPING_BIG_FIVE_KEYS.length) bigfive.set(userId, scores);
  }

  return { riasec, bigfive };
}

/**
 * 读测评上下文：两套量表各一次当页批查。
 * 任一套失败都降级（`available=false` + `degraded` 记录原因），不影响另一套。
 */
export async function loadAssessmentFeatureContext(
  students: StudentRef[]
): Promise<LoadedAssessmentFeatureContext> {
  const context: AssessmentFeatureContext = { riasec: new Map(), bigfive: new Map() };
  const available: AssessmentFeatureAvailability = { riasec: false, bigfive: false };
  const degraded: string[] = [];
  const codes = students.map((student) => student.user_code);
  if (codes.length === 0) return { context, available, degraded };

  let riasecRows: { user_code: string; scores_json: string | null }[] = [];
  let bigfiveRows: { user_code: string; scores_json: string | null }[] = [];
  try {
    const assessment = await getAssessmentByCode(RIASEC_CODE);
    if (assessment) {
      riasecRows = await getCurrentAssessmentResultsByUserCodes(assessment.id, codes);
      available.riasec = true;
    }
  } catch (err) {
    console.error("Grouping RIASEC context degraded:", err);
    degraded.push("兴趣测评数据读取失败");
  }
  try {
    const assessment = await getAssessmentByCode(IPIP_NEO_FFI_CODE);
    if (assessment) {
      bigfiveRows = await getCurrentAssessmentResultsByUserCodes(assessment.id, codes);
      available.bigfive = true;
    }
  } catch (err) {
    console.error("Grouping Big Five context degraded:", err);
    degraded.push("性格测评数据读取失败");
  }

  const built = buildAssessmentFeatureContext(students, riasecRows, bigfiveRows);
  return { context: built, available, degraded };
}
