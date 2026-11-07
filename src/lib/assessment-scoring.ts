/**
 * 通用测评计分引擎（纯函数、无 I/O，#220）。
 *
 * 与具体量表无关：维度定义、题目归属、反向计分标记由调用方从 `assessments` /
 * `assessment_questions` 表取出后传入。RIASEC 三字码只是 `typological` 模式的一个实例，
 * 大五人格等 `dimensional` 量表复用同一条管线。
 *
 * 管线：Likert 1-5 作答 →（反向题先 `6 - x` 取反）→ 各维度原始分 → 0-100 标准分 → 三字码 / 高低分档。
 * 标准分换算通过 `standardize` 注入，默认线性；常模数据到位后（#227）只替换该函数，签名不变。
 * 草稿续答允许题目缺答：未答维度按已答题折算，`complete=false` 交调用方决定是否呈现结果。
 *
 * ## 对接契约（#221 数据层 / #223 作答 API）
 *
 * - `dimensions` ← `assessments.dimensions_json` 解析结果，元素为 `{ key, label }`；`key` 是维度标识（如 `R`），
 *   `label` 是中文名（如 现实型），两者在量表内均不可重复。
 * - `questions` ← `assessment_questions` 行，只取 `{ index, dimension, reverseScored }`：`index` 为量表内从 1
 *   开始的题号，`dimension` 必须是 `dimensions` 里的某个 `key`，`reverseScored` 对应反向计分列。
 * - `answers` ← `assessment_results.answers_json`：「题号 → 作答值」映射。键可为数字或字符串（`JSON.parse`
 *   出来是字符串），值可为数字或数字字符串（`"4"` 等同 `4`）；取值必须是 1-5 的整数，题号必须是题库内题号，
 *   否则抛错——脏数据应在落库前挡住，不带病计分。
 * - 返回的 `scores` 按 `dimensions` 声明顺序排列，可整体序列化进 `assessment_results.scores_json`；
 *   `code` 写三字码列，`missingIndexes` 供续答提示，`complete` 决定能否作为有效结果。
 */

export const LIKERT_MIN = 1;
export const LIKERT_MAX = 5;
/** 反向计分取反因子：`LIKERT_MIN + LIKERT_MAX - x`，即 1-5 量表上常见的 `6 - x` */
export const REVERSE_FACTOR = LIKERT_MIN + LIKERT_MAX;

export const STANDARD_MIN = 0;
export const STANDARD_MAX = 100;

/** 霍兰德并列破平优先序；三字码在标准分相同时按此序取前三个维度 */
export const HOLLAND_TIE_BREAK_ORDER = ["R", "I", "A", "S", "E", "C"] as const;

/** 霍兰德三字码长度 */
export const TYPE_CODE_LENGTH = 3;

/** dimensional 模式的默认高/中分界（与 0-100 标准分同一口径） */
export const DEFAULT_HIGH_BAND = 66.7;
export const DEFAULT_MEDIUM_BAND = 33.3;

export type ScoringMode = "typological" | "dimensional";
export type ScoreBand = "high" | "medium" | "low";
export type LikertValue = 1 | 2 | 3 | 4 | 5;

/** `assessments.dimensions_json` 的解析结果 */
export interface DimensionConfig {
  key: string;
  label: string;
}

/** `assessment_questions` 里与计分相关的两列 */
export interface QuestionConfig {
  /** 作答题号，从 1 开始、量表内唯一 */
  index: number;
  dimension: string;
  reverseScored?: boolean;
}

/** 题号 → Likert 值。数据库草稿 JSON 的键与值都可能是字符串（`JSON.parse` 的结果），一律接受 */
export type AnswerValue = number | string;
export type AnswerInput = Record<string | number, AnswerValue>;

/** 标准分换算入参 */
export interface StandardizeInput {
  raw: number;
  minPossible: number;
  maxPossible: number;
  /** 该维度已答题数 */
  answered: number;
  /** 该维度题目总数 */
  questionCount: number;
  dimension: DimensionConfig;
}

export type StandardizeFn = (input: StandardizeInput) => number;

export interface ScoringOptions {
  mode?: ScoringMode;
  /** 破平优先序的维度 key 列表，默认 `HOLLAND_TIE_BREAK_ORDER` */
  tieBreakOrder?: readonly string[];
  standardize?: StandardizeFn;
  highBand?: number;
  mediumBand?: number;
  /** 三字码取前 N 个维度，默认 3 */
  codeLength?: number;
}

export interface DimensionScore {
  key: string;
  label: string;
  questionCount: number;
  answered: number;
  /** 反向题取反后的原始累加分；一题未答时为 0 */
  raw: number;
  minPossible: number;
  maxPossible: number;
  /** 已答题折算后的 0-100 标准分，保留一位小数 */
  standard: number;
  band?: ScoreBand;
}

export interface ScoringResult {
  mode: ScoringMode;
  questionCount: number;
  answeredCount: number;
  complete: boolean;
  /** 升序，供作答接口提示「还剩这些题没答」 */
  missingIndexes: number[];
  /** 按 `dimensions` 声明顺序排列 */
  scores: DimensionScore[];
  /** `typological` 模式的三字码，如 `SIA`；可参与排码的维度不足时长度会短于 `codeLength` */
  code?: string;
  /** 参与取码的维度 key，已按标准分降序 + 破平序排好 */
  rankedKeys?: string[];
}

/** 反向题取反；正向题原样返回 */
export function scoreItem(value: number, reverseScored = false): number {
  return reverseScored ? REVERSE_FACTOR - value : value;
}

/**
 * 线性换算：`[minPossible .. maxPossible] → [0 .. 100]`，越界钳制、保留一位小数。
 * 该维度一题未答时为 0（草稿的正常状态，不算异常）；量程本身非法则是配置错误，直接抛错区分两者。
 */
export const standardizeLinear: StandardizeFn = ({ raw, minPossible, maxPossible, answered }) => {
  if (answered === 0) return STANDARD_MIN;
  if (!Number.isFinite(minPossible) || !Number.isFinite(maxPossible) || maxPossible <= minPossible) {
    throw new Error(`标准分换算量程非法：[${minPossible} .. ${maxPossible}]，已答题数 ${answered}`);
  }
  const ratio = (raw - minPossible) / (maxPossible - minPossible);
  const clamped = Math.min(STANDARD_MAX, Math.max(STANDARD_MIN, ratio * STANDARD_MAX));
  return Math.round(clamped * 10) / 10;
};

/** 标准分 → 高/中/低档；边界含在高档一侧 */
export function bandOf(standard: number, highBand = DEFAULT_HIGH_BAND, mediumBand = DEFAULT_MEDIUM_BAND): ScoreBand {
  if (standard >= highBand) return "high";
  if (standard >= mediumBand) return "medium";
  return "low";
}

function readAnswers(input: AnswerInput): Map<number, number> {
  const answers = new Map<number, number>();
  for (const [rawKey, rawValue] of Object.entries(input)) {
    const index = Number(rawKey);
    if (!Number.isInteger(index) || index < 1) throw new Error(`作答题号非法：${rawKey}`);
    // 草稿 JSON 里 `"4"` 与 4 同权：先折算再校验，脏数据在计分前挡住
    const value = typeof rawValue === "string" ? Number(rawValue.trim()) : rawValue;
    if (!Number.isInteger(value) || value < LIKERT_MIN || value > LIKERT_MAX) {
      throw new Error(`第 ${index} 题的作答值必须是 ${LIKERT_MIN}-${LIKERT_MAX} 的整数，当前为 ${rawValue}`);
    }
    answers.set(index, value);
  }
  return answers;
}

function validateConfig(dimensions: readonly DimensionConfig[], questions: readonly QuestionConfig[]): void {
  if (dimensions.length === 0) throw new Error("计分需要至少一个维度");
  if (questions.length === 0) throw new Error("计分需要至少一道题");

  const keys = new Set<string>();
  for (const dimension of dimensions) {
    if (!dimension.key) throw new Error("维度定义缺少 key");
    if (keys.has(dimension.key)) throw new Error(`维度 key 重复：${dimension.key}`);
    keys.add(dimension.key);
  }

  const indexes = new Set<number>();
  for (const question of questions) {
    if (!Number.isInteger(question.index) || question.index < 1) {
      throw new Error(`题目序号非法：${question.index}`);
    }
    if (indexes.has(question.index)) throw new Error(`题目序号重复：${question.index}`);
    indexes.add(question.index);
    if (!keys.has(question.dimension)) throw new Error(`第 ${question.index} 题归属了未定义的维度：${question.dimension}`);
  }
}

/**
 * 标准分降序 + 固定优先序破平。只纳入至少答了一题的维度，否则草稿里未作答的维度会靠
 * 0 分与真实的低分并列、抢走三字码的名额。
 */
export function rankDimensions(
  scores: readonly DimensionScore[],
  tieBreakOrder: readonly string[]
): string[] {
  const orderIndex = new Map(tieBreakOrder.map((key, i) => [key, i]));
  const priority = (key: string) => orderIndex.get(key) ?? Number.MAX_SAFE_INTEGER;
  return scores
    .filter((score) => score.answered > 0)
    .sort((a, b) => b.standard - a.standard || priority(a.key) - priority(b.key) || (a.key < b.key ? -1 : 1))
    .map((score) => score.key);
}

/** 按已排序的维度 key 取前 N 个拼成类型码 */
export function buildTypeCode(rankedKeys: readonly string[], codeLength = TYPE_CODE_LENGTH): string {
  return rankedKeys.slice(0, Math.max(0, codeLength)).join("");
}

export function scoreAssessment(
  dimensions: readonly DimensionConfig[],
  questions: readonly QuestionConfig[],
  answers: AnswerInput,
  options: ScoringOptions = {}
): ScoringResult {
  validateConfig(dimensions, questions);
  const answersByIndex = readAnswers(answers);

  for (const index of answersByIndex.keys()) {
    if (!questions.some((question) => question.index === index)) {
      throw new Error(`作答包含题库里不存在的题号：${index}`);
    }
  }

  const mode = options.mode ?? "typological";
  const standardize = options.standardize ?? standardizeLinear;
  const highBand = options.highBand ?? DEFAULT_HIGH_BAND;
  const mediumBand = options.mediumBand ?? DEFAULT_MEDIUM_BAND;
  const codeLength = options.codeLength ?? TYPE_CODE_LENGTH;

  const scores: DimensionScore[] = dimensions.map((dimension) => {
    const items = questions.filter((question) => question.dimension === dimension.key);
    let raw = 0;
    let answered = 0;
    for (const item of items) {
      const value = answersByIndex.get(item.index);
      if (value === undefined) continue;
      answered += 1;
      raw += scoreItem(value, item.reverseScored);
    }
    const input: StandardizeInput = {
      raw,
      minPossible: answered * LIKERT_MIN,
      maxPossible: answered * LIKERT_MAX,
      answered,
      questionCount: items.length,
      dimension,
    };
    const standard = standardize(input);
    return {
      key: dimension.key,
      label: dimension.label,
      questionCount: items.length,
      answered,
      raw,
      minPossible: input.minPossible,
      maxPossible: input.maxPossible,
      standard,
      ...(mode === "dimensional" ? { band: bandOf(standard, highBand, mediumBand) } : {}),
    };
  });

  const missingIndexes = questions.filter((question) => !answersByIndex.has(question.index)).map((question) => question.index).sort((a, b) => a - b);
  const result: ScoringResult = {
    mode,
    questionCount: questions.length,
    answeredCount: answersByIndex.size,
    complete: missingIndexes.length === 0,
    missingIndexes,
    scores,
  };

  if (mode === "typological") {
    const rankedKeys = rankDimensions(scores, options.tieBreakOrder ?? HOLLAND_TIE_BREAK_ORDER);
    result.rankedKeys = rankedKeys;
    result.code = buildTypeCode(rankedKeys, codeLength);
  }

  return result;
}
