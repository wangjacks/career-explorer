/**
 * 霍兰德 RIASEC 职业匹配（#226）：纯函数、无 I/O、不碰数据库。
 *
 * 输入是「学生六型画像」与「O*NET 职业六型分」，输出按余弦相似度排序的 Top-N 职业。
 * 算法只认形状（方向），不认绝对量级——两套分数量纲不同（学生 0–100 标准分、O*NET 1–7 原始分），
 * 所以先在各自量程内折算到 0–1 再算余弦，避免量纲差异变成排序噪声。
 *
 * 为什么是余弦：RIASEC 关心的是「六型之间的相对强弱形状」，余弦天然忽略整体高低；
 * 归一化后各维非负，相似度落在 0–1 且越接近 1 越像。Top-N 排序**确定性**：
 * 相似度降序 + 同分按职业 code 升序破平，同一输入在任何环境得到同一结果。
 *
 * 画像来源有两种（见 `profileFromDimensionScores` / `hollandWeights`）：
 * - 首选：测评结果快照里的维度标准分（六维都有值，信息最全）；
 * - 退路：只有三字码时按 3/2/1 权重构造方向向量（老数据 / 只有类型码的场景）。
 */

/** RIASEC 六型 key，顺序与本仓库计分引擎 / 雷达图一致 */
export const RIASEC_KEYS = ["R", "I", "A", "S", "E", "C"] as const;
export type RiasecKey = (typeof RIASEC_KEYS)[number];
export type RiasecVector = Record<RiasecKey, number>;

/** 六型中文名（结果页解释「我是什么型」时复用） */
export const RIASEC_LABELS: Readonly<Record<RiasecKey, string>> = {
  R: "现实型",
  I: "研究型",
  A: "艺术型",
  S: "社会型",
  E: "企业型",
  C: "常规型",
};

/** O*NET Interest 原始分量程（Data Value 为 1–7） */
export const ONET_SCORE_MIN = 1;
export const ONET_SCORE_MAX = 7;

/** 学生测评标准分量程（计分引擎线性换算到 0–100） */
export const STUDENT_SCORE_MIN = 0;
export const STUDENT_SCORE_MAX = 100;

/** 推荐条数默认 6、上限 20（上限挡住 ?limit=999 这类请求把整库吐出来） */
export const DEFAULT_TOP_N = 6;
export const MAX_TOP_N = 20;

/** 三字码里每位字母的权重：第一位最重要 */
export const HOLLAND_CODE_WEIGHTS = [3, 2, 1] as const;

/** 匹配的候选职业（数据层/种子层把 O*NET 行转成这个形状） */
export interface CareerCandidate {
  /** O*NET-SOC Code，如 `15-1252.00` */
  code: string;
  /** 英文职业名（O*NET 原始 Title） */
  name: string;
  /** 中文译名；首批未覆盖的职业为 null，展示时回退英文名 */
  nameZh: string | null;
  /** O*NET 官方兴趣高码（1–3 位字母，由官方 First/Second/Third Interest High-Point 指标推导） */
  interestCode: string;
  /** O*NET 六型原始分（1–7） */
  scores: RiasecVector;
  /** O*NET Job Zone 1–5 */
  jobZone: number;
  /** 由 Job Zone 归纳的常见学历要求（中文） */
  educationLevel: string;
  /** SOC 大类（所属职业群，中文） */
  cluster: string;
}

export interface CareerMatch extends CareerCandidate {
  /** 余弦相似度，0–1，保留 4 位小数 */
  similarity: number;
  /** 排名，从 1 开始 */
  rank: number;
}

export interface RankOptions {
  topN?: number;
}

export function emptyRiasecVector(): RiasecVector {
  return { R: 0, I: 0, A: 0, S: 0, E: 0, C: 0 };
}

export function isRiasecKey(value: string): value is RiasecKey {
  return (RIASEC_KEYS as readonly string[]).includes(value);
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

/** 只保留六个有限数值；缺维按 0 处理（脏数据不参与计算，而不是整体报错） */
export function coerceRiasecVector(input: Partial<Record<string, number>> | null | undefined): RiasecVector {
  const vector = emptyRiasecVector();
  if (!input) return vector;
  for (const key of RIASEC_KEYS) {
    const value = input[key];
    vector[key] = typeof value === "number" && Number.isFinite(value) ? value : 0;
  }
  return vector;
}

/** 解析落库的 `interests_json`（形如 `{"R":3.61,...}`）；解析失败返回空向量 */
export function parseRiasecVector(json: string | null | undefined): RiasecVector {
  if (!json) return emptyRiasecVector();
  try {
    return coerceRiasecVector(JSON.parse(json) as Partial<Record<string, number>>);
  } catch {
    return emptyRiasecVector();
  }
}

/** O*NET 1–7 原始分 → 0–1（越界钳制） */
export function normalizeOnetScores(scores: RiasecVector): RiasecVector {
  const span = ONET_SCORE_MAX - ONET_SCORE_MIN;
  const out = emptyRiasecVector();
  for (const key of RIASEC_KEYS) {
    out[key] = (clamp(scores[key], ONET_SCORE_MIN, ONET_SCORE_MAX) - ONET_SCORE_MIN) / span;
  }
  return out;
}

/** 学生 0–100 标准分 → 0–1（越界钳制） */
export function normalizeStudentScores(scores: RiasecVector): RiasecVector {
  const span = STUDENT_SCORE_MAX - STUDENT_SCORE_MIN;
  const out = emptyRiasecVector();
  for (const key of RIASEC_KEYS) {
    out[key] = (clamp(scores[key], STUDENT_SCORE_MIN, STUDENT_SCORE_MAX) - STUDENT_SCORE_MIN) / span;
  }
  return out;
}

/** 把三字码规范成大写、去重、只留 RIASEC 字母，最多 3 位；无有效字母返回 null */
export function normalizeHollandCode(code: string | null | undefined): string | null {
  if (!code) return null;
  const seen = new Set<string>();
  for (const char of code.toUpperCase()) {
    if (!isRiasecKey(char)) continue;
    seen.add(char);
    if (seen.size >= HOLLAND_CODE_WEIGHTS.length) break;
  }
  return seen.size > 0 ? [...seen].join("") : null;
}

/**
 * 三字码 → 方向向量（3/2/1 权重）。
 * 只有类型码、没有六维分时用它兜底；字母序即强弱序，重复字母只算第一次。
 */
export function hollandWeights(code: string | null | undefined): RiasecVector | null {
  const normalized = normalizeHollandCode(code);
  if (!normalized) return null;
  const vector = emptyRiasecVector();
  [...normalized].forEach((letter, index) => {
    vector[letter as RiasecKey] = HOLLAND_CODE_WEIGHTS[index];
  });
  return vector;
}

export function vectorNorm(vector: RiasecVector): number {
  let sum = 0;
  for (const key of RIASEC_KEYS) sum += vector[key] * vector[key];
  return Math.sqrt(sum);
}

/** 余弦相似度；任一向量为零向量（没有任何信息）时返回 0，非有限值也按 0 处理 */
export function cosineSimilarity(a: RiasecVector, b: RiasecVector): number {
  const normA = vectorNorm(a);
  const normB = vectorNorm(b);
  if (normA === 0 || normB === 0) return 0;
  let dot = 0;
  for (const key of RIASEC_KEYS) dot += a[key] * b[key];
  const similarity = dot / (normA * normB);
  if (!Number.isFinite(similarity)) return 0;
  // 浮点误差可能给出 1.0000000000000002，钳到 [-1, 1]
  return Math.min(1, Math.max(-1, similarity));
}

/**
 * 从测评结果快照的维度标准分构造学生画像。
 * 入参就是 `assessment_results.scores_json` 解析后的数组（计分引擎输出），只取 RIASEC 六维；
 * 六维全部缺失（或全为 0）时返回 null——此时没有可匹配的信息，调用方应改用三字码。
 */
export function profileFromDimensionScores(
  scores: readonly { key: string; standard: number }[] | null | undefined
): RiasecVector | null {
  if (!scores || scores.length === 0) return null;
  const vector = emptyRiasecVector();
  let found = false;
  for (const score of scores) {
    if (!isRiasecKey(score.key)) continue;
    if (typeof score.standard !== "number" || !Number.isFinite(score.standard)) continue;
    vector[score.key] = clamp(score.standard, STUDENT_SCORE_MIN, STUDENT_SCORE_MAX);
    found = true;
  }
  if (!found || vectorNorm(vector) === 0) return null;
  return vector;
}

/**
 * 用学生画像给职业排序。
 * - 画像先归一化到 0–1（调用方传入 0–100 标准分即可，函数内部负责折算）；
 * - 候选职业的 O*NET 1–7 分同样归一化；
 * - 排序：相似度降序 → code 升序破平（确定性），取 topN（钳制在 1–MAX_TOP_N）。
 * 画像没有任何信息（零向量）时返回空数组：不拿「全 0」去硬凑推荐。
 */
export function rankCareers(
  profile: RiasecVector,
  candidates: readonly CareerCandidate[],
  options: RankOptions = {}
): CareerMatch[] {
  const studentVector = normalizeStudentScores(coerceRiasecVector(profile));
  if (vectorNorm(studentVector) === 0) return [];

  const topN = Math.min(MAX_TOP_N, Math.max(1, Math.floor(options.topN ?? DEFAULT_TOP_N)));

  const scored = candidates.map((candidate) => {
    const similarity = cosineSimilarity(studentVector, normalizeOnetScores(coerceRiasecVector(candidate.scores)));
    return { candidate, similarity };
  });

  scored.sort((a, b) => {
    if (b.similarity !== a.similarity) return b.similarity - a.similarity;
    // 同分按 code 升序：ASCII 比较，避免 localeCompare 受运行环境影响
    return a.candidate.code < b.candidate.code ? -1 : a.candidate.code > b.candidate.code ? 1 : 0;
  });

  return scored.slice(0, topN).map(({ candidate, similarity }, index) => ({
    ...candidate,
    similarity: Math.round(similarity * 10000) / 10000,
    rank: index + 1,
  }));
}
