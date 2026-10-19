import { LIKERT_MAX, LIKERT_MIN, type DimensionConfig, type DimensionScore } from "./assessment-scoring";

/**
 * 职业测评作答流程的共享纯函数（#223）：作答值校验、草稿合并、续答落点、结果视图解析。
 *
 * 与具体量表无关，也不碰数据库/Next API —— 答题页（客户端）与 4 个 `/api/shared/assessment/*`
 * 路由共用同一套口径，避免「前端放行的值后端不认」这类分叉。计分本身在 `assessment-scoring.ts`。
 */

/** 作答值的中文锚点：RIASEC 兴趣量表问的是「愿不愿意做」，不是「准不准确」（1-5 与计分引擎同一量程） */
export const LIKERT_ANCHORS: { value: number; label: string }[] = [
  { value: 1, label: "非常不愿意" },
  { value: 2, label: "不愿意" },
  { value: 3, label: "一般" },
  { value: 4, label: "愿意" },
  { value: 5, label: "非常愿意" },
];

/** 题号 → 作答值（题号与值都是整数） */
export type AssessmentAnswers = Record<number, number>;

/** 作答值是否合法：1-5 的整数（字符串数字不接受，草稿 JSON 的解析由 parseAnswers 负责） */
export function isValidAnswerValue(value: unknown): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= LIKERT_MIN && value <= LIKERT_MAX;
}

/** 题号是否合法：从 1 开始的整数 */
export function isValidQuestionIndex(index: unknown): index is number {
  return typeof index === "number" && Number.isInteger(index) && index >= 1;
}

/**
 * 解析草稿/快照里的作答 JSON：容忍脏数据（非对象、题号非法、值不在 1-5），坏键直接忽略而不是抛错——
 * 数据库里的历史草稿可能来自改题之前的版本，读作答不能因为一条脏数据整份作废。
 * 值位允许数字字符串（`JSON.parse` 之外的来源，如手工构造的请求体）。
 */
export function parseAnswers(raw: string | null | undefined): AssessmentAnswers {
  const answers: AssessmentAnswers = {};
  if (!raw) return answers;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    console.error("Assessment answers parse error:", err);
    return answers;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return answers;
  for (const [rawIndex, rawValue] of Object.entries(parsed as Record<string, unknown>)) {
    const index = Number(rawIndex);
    if (!isValidQuestionIndex(index)) continue;
    const value = typeof rawValue === "string" ? Number(rawValue.trim()) : rawValue;
    if (!isValidAnswerValue(value)) continue;
    answers[index] = value;
  }
  return answers;
}

/** 只保留题库里存在的题号（题库换版后旧草稿里的题号不能带进新一轮计分） */
export function filterAnswersToBank(answers: AssessmentAnswers, bankIndexes: readonly number[]): AssessmentAnswers {
  const allowed = new Set(bankIndexes);
  const filtered: AssessmentAnswers = {};
  for (const [index, value] of Object.entries(answers)) {
    const numeric = Number(index);
    if (allowed.has(numeric)) filtered[numeric] = value;
  }
  return filtered;
}

/** 合并一次作答（返回新对象，不改入参），题号与值都必须合法 */
export function mergeAnswer(answers: AssessmentAnswers, index: number, value: number): AssessmentAnswers {
  if (!isValidQuestionIndex(index)) throw new Error(`题号非法：${index}`);
  if (!isValidAnswerValue(value)) throw new Error(`作答值非法：${value}`);
  return { ...answers, [index]: value };
}

/** 进度：已答 / 总题数 + 百分比（总数为 0 时百分比为 0，避免除零） */
export function answerProgress(
  answers: AssessmentAnswers,
  bankIndexes: readonly number[]
): { answered: number; total: number; percent: number } {
  const total = bankIndexes.length;
  const answered = bankIndexes.filter((index) => answers[index] !== undefined).length;
  return { answered, total, percent: total === 0 ? 0 : Math.round((answered / total) * 100) };
}

/** 第一个未作答题号；全部答完返回 null */
export function firstUnansweredIndex(answers: AssessmentAnswers, bankIndexes: readonly number[]): number | null {
  for (const index of bankIndexes) {
    if (answers[index] === undefined) return index;
  }
  return null;
}

/**
 * 续答落点：有未答题 → 第一个未答题；已全部答完但还没提交 → 最后一题
 * （停在末题是为了让「检查一遍再提交」有落点，而不是一进来就跳到提交态）。
 */
export function resumeIndex(answers: AssessmentAnswers, bankIndexes: readonly number[]): number {
  if (bankIndexes.length === 0) return 1;
  const next = firstUnansweredIndex(answers, bankIndexes);
  return next ?? bankIndexes[bankIndexes.length - 1];
}

/** 解析量表定义里的维度 JSON：脏数据（非数组 / 缺 key）逐项忽略，不整份失败 */
export function parseDimensions(raw: string | null | undefined): DimensionConfig[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item): item is { key: string; label: string } => {
        return (
          item !== null &&
          typeof item === "object" &&
          typeof (item as { key?: unknown }).key === "string" &&
          typeof (item as { label?: unknown }).label === "string"
        );
      })
      .map((item) => ({ key: item.key, label: item.label }));
  } catch (err) {
    console.error("Assessment dimensions parse error:", err);
    return [];
  }
}

function numberOrZero(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

/**
 * 解析结果快照里的六维得分 JSON，返回**可直接渲染**的 `DimensionScore[]`。
 *
 * 容错的底线是「不把会崩的条目交给渲染层」：`standard` 必须是有限数值（页面会 `standard.toFixed(1)`，
 * 缺它或为 NaN 时结果页直接白屏），因此缺 `standard` 的条目丢弃；其余字段缺失补默认值
 * （`label` 回退 `key`、计数类回退 0），保证调用方拿到的是完整形状。
 */
export function parseScores(raw: string | null | undefined): DimensionScore[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const scores: DimensionScore[] = [];
    for (const item of parsed) {
      if (item === null || typeof item !== "object") continue;
      const candidate = item as Partial<DimensionScore>;
      if (typeof candidate.key !== "string" || candidate.key === "") continue;
      if (typeof candidate.standard !== "number" || !Number.isFinite(candidate.standard)) continue;
      const band =
        candidate.band === "high" || candidate.band === "medium" || candidate.band === "low"
          ? candidate.band
          : undefined;
      scores.push({
        key: candidate.key,
        label: typeof candidate.label === "string" && candidate.label !== "" ? candidate.label : candidate.key,
        questionCount: numberOrZero(candidate.questionCount),
        answered: numberOrZero(candidate.answered),
        raw: numberOrZero(candidate.raw),
        minPossible: numberOrZero(candidate.minPossible),
        maxPossible: numberOrZero(candidate.maxPossible),
        standard: candidate.standard,
        ...(band ? { band } : {}),
      });
    }
    return scores;
  } catch (err) {
    console.error("Assessment scores parse error:", err);
    return [];
  }
}

/** 结果时间展示：`YYYY-MM-DD HH:mm`（库内 TEXT 已是该格式，容忍带 T 的 ISO 串） */
export function formatResultTime(value: string | null | undefined): string {
  if (typeof value !== "string" || !value.trim()) return "";
  return value.trim().replace("T", " ").slice(0, 16);
}
