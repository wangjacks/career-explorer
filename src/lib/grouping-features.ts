/**
 * 分组特征源注册表（#101 / #345）。
 *
 * 设计要点：**算法层只认识「归一化后的特征集合」，不认识任何具体数据源**。
 * 新增数据源（测评结果、自定义字段表、文字评价）= 往 FEATURE_SOURCES 加一项
 * （必要时为该 kind 补一个相似度实现），算法主体、五张分组表、界面结构都不需要改。
 *
 * #345 起注册三个源：
 * - `tags`（集合型，IDF 加权余弦）——现有源；
 * - `riasec`（数值向量，6 维标准分）——霍兰德兴趣；
 * - `bigfive`（数值向量，**只取 C / E / O / A 四维，N 不注册**）。
 *
 * 测评数据不在 `users` 表里：由调用方（路由）先按学号批查结果快照、装进
 * `AssessmentFeatureContext` 再传给 `buildFeatureVectors`，注册表保持纯函数。
 */

import type { UserRow } from "./db";
import { normalizeTagNames } from "./tag-utils";
import { RIASEC_KEYS, type RiasecKey } from "./assessment-match";

/** 特征类型决定相似度的算法（见 grouping-utils 的分派） */
export type FeatureKind = "set" | "numeric" | "vector" | "categorical";

/** 一个源在某学生上的取值：集合型为名称数组、数值型为数字、向量型为数字数组、类别型为码（都可为空） */
export type FeatureValue = string[] | number | number[] | string | null;

/* ---------- 测评特征（#345） ---------- */

/** 大五参与分组的维度顺序：**只有 C/E/O/A，N（神经质）刻意不注册** */
export const GROUPING_BIG_FIVE_KEYS = ["C", "E", "O", "A"] as const;
export type GroupingBigFiveKey = (typeof GROUPING_BIG_FIVE_KEYS)[number];

/** 分组角色定义：由大五高维映射（仅用于组合，不做能力评价） */
export const GROUPING_ROLE_DEFS: ReadonlyArray<{
  key: string;
  label: string;
  dimension: GroupingBigFiveKey;
  dimensionLabel: string;
}> = [
  { key: "organizer", label: "组织者", dimension: "C", dimensionLabel: "尽责性" },
  { key: "driver", label: "推进者", dimension: "E", dimensionLabel: "外向性" },
  { key: "ideator", label: "点子王", dimension: "O", dimensionLabel: "开放性" },
  { key: "coordinator", label: "协调者", dimension: "A", dimensionLabel: "宜人性" },
];

/** 角色判定阈值：标准分 ≥ 50 记「高」（与结果页、`buildBigFiveHeadline` 同一口径） */
export const GROUPING_ROLE_THRESHOLD = 50;

/** 一个学生参与分组的测评取值（标准分 0–100；缺测为 null / 缺该维） */
export interface AssessmentFeatureContext {
  /** userId → 六型标准分 */
  riasec: Map<number, Partial<Record<RiasecKey, number>>>;
  /** userId → 大五四维标准分（不含 N） */
  bigfive: Map<number, Partial<Record<GroupingBigFiveKey, number>>>;
}

/** extract 的第二个参数：测评数据容器（标签源忽略它） */
export interface FeatureExtractContext {
  assessments?: AssessmentFeatureContext | null;
}

/* ---------- 源注册表 ---------- */

export interface FeatureSourceDef {
  /** 稳定标识，进批次头的 feature_sources */
  key: string;
  /** 界面文案（如「标签」「兴趣」「性格」） */
  label: string;
  kind: FeatureKind;
  /** 多源加权求和时的默认权重（路由可用 `withWeights` 覆盖） */
  weight: number;
  /** 源口径版本：进批次头，指标变化时可回放「当时按哪版算法算的」 */
  version: string;
  /** 从用户行（+ 可选测评上下文）取该源的值；纯函数，数据由上层取好 */
  extract: (user: UserRow, context?: FeatureExtractContext) => FeatureValue;
}

/** 解析 users.tags（JSON 名称数组；容忍旧格式与非法值） */
function extractTags(user: UserRow): string[] {
  if (!user.tags) return [];
  try {
    const parsed: unknown = JSON.parse(user.tags);
    return Array.isArray(parsed) ? normalizeTagNames(parsed) : [];
  } catch {
    return [];
  }
}

/** 六型向量：按 RIASEC_KEYS 固定顺序；缺任何一维返回 null（不拿半份分数算相似度） */
function extractRiasec(user: UserRow, context?: FeatureExtractContext): number[] | null {
  const scores = context?.assessments?.riasec.get(user.id);
  if (!scores) return null;
  const vector = RIASEC_KEYS.map((key) => scores[key]);
  return vector.every((value): value is number => typeof value === "number" && Number.isFinite(value))
    ? vector
    : null;
}

/** 大五向量：按 GROUPING_BIG_FIVE_KEYS 固定顺序（C/E/O/A），N 永不出现 */
function extractBigFive(user: UserRow, context?: FeatureExtractContext): number[] | null {
  const scores = context?.assessments?.bigfive.get(user.id);
  if (!scores) return null;
  const vector = GROUPING_BIG_FIVE_KEYS.map((key) => scores[key]);
  return vector.every((value): value is number => typeof value === "number" && Number.isFinite(value))
    ? vector
    : null;
}

/**
 * 已注册的特征源。权重默认「标签 0.2 / 兴趣 0.5 / 性格 0.3」（#345 产品口径），
 * 高级里可按班覆盖；`withWeights` 只替换权重，不动 extract。
 */
export const FEATURE_SOURCES: FeatureSourceDef[] = [
  {
    key: "tags",
    label: "标签",
    kind: "set",
    weight: 0.2,
    version: "1",
    extract: extractTags,
  },
  {
    key: "riasec",
    label: "兴趣",
    kind: "vector",
    weight: 0.5,
    version: "1",
    extract: extractRiasec,
  },
  {
    key: "bigfive",
    label: "性格",
    kind: "vector",
    weight: 0.3,
    version: "1",
    extract: extractBigFive,
  },
];

/** 仅标签的旧策略特征源（策略 C / 未接测评时的可用源） */
export const TAG_ONLY_SOURCES: FeatureSourceDef[] = FEATURE_SOURCES.filter((s) => s.key === "tags");

/**
 * 覆盖某几个源的权重（其余源保留默认值）。
 * 权重非法（负数 / NaN / 全 0）时回落到默认，避免把 NaN 带进相似度矩阵。
 */
export function withWeights(
  weights: Record<string, number> | null | undefined,
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): FeatureSourceDef[] {
  if (!weights) return sources;
  const overridden = sources.map((source) => {
    const raw = weights[source.key];
    return typeof raw === "number" && Number.isFinite(raw) && raw >= 0
      ? { ...source, weight: raw }
      : source;
  });
  return overridden.some((s) => s.weight > 0) ? overridden : sources;
}

/** 一个学生按源 key 归一化后的特征 */
export interface FeatureVector {
  /** users.id */
  studentId: number;
  /** 学号：确定性的排序与平局依据 */
  userCode: string;
  values: Record<string, FeatureValue>;
}

/** 把用户行按注册表拍平成特征向量（保持传入顺序，排序由算法层负责） */
export function buildFeatureVectors(
  users: UserRow[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES,
  context?: FeatureExtractContext
): FeatureVector[] {
  return users.map((u) => {
    const values: Record<string, FeatureValue> = {};
    for (const s of sources) values[s.key] = s.extract(u, context);
    return { studentId: u.id, userCode: u.user_code, values };
  });
}

/** 批次头记录的「本次用了哪些源（含权重与版本）」：新增源只影响这段 JSON，不动表结构 */
export function describeSources(sources: FeatureSourceDef[] = FEATURE_SOURCES): string {
  return JSON.stringify(
    sources.map((s) => ({ key: s.key, kind: s.kind, weight: s.weight, version: s.version }))
  );
}

/** 某个学生的某个源"有值"（用于覆盖率口径） */
export function hasValue(value: FeatureValue, kind: FeatureKind): boolean {
  if (value === null || value === undefined) return false;
  if (kind === "numeric") return typeof value === "number" && Number.isFinite(value);
  if (kind === "vector") {
    return Array.isArray(value) && value.length > 0 && value.every((v) => typeof v === "number" && Number.isFinite(v));
  }
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.length > 0;
}

/** 取六型向量（顺序 R/I/A/S/E/C），缺失返回 null */
export function riasecVectorOf(vector: FeatureVector): number[] | null {
  const value = vector.values["riasec"];
  return Array.isArray(value) && value.length === RIASEC_KEYS.length ? (value as number[]) : null;
}

/** 取大五向量（顺序 C/E/O/A，**不含 N**），缺失返回 null */
export function bigfiveVectorOf(vector: FeatureVector): number[] | null {
  const value = vector.values["bigfive"];
  return Array.isArray(value) && value.length === GROUPING_BIG_FIVE_KEYS.length ? (value as number[]) : null;
}

/** 主导兴趣型（六维最高分；同分按 RIASEC_KEYS 顺序；没有兴趣结果返回 null） */
export function dominantRiasecOf(vector: FeatureVector): RiasecKey | null {
  const scores = riasecVectorOf(vector);
  if (!scores) return null;
  let bestIndex = 0;
  for (let i = 1; i < scores.length; i += 1) {
    if (scores[i] > scores[bestIndex]) bestIndex = i;
  }
  return RIASEC_KEYS[bestIndex];
}

/** 该生命中的角色（大五某维 ≥ 50 即命中；可命中多个） */
export function rolesOf(vector: FeatureVector): string[] {
  const scores = bigfiveVectorOf(vector);
  if (!scores) return [];
  const byKey = new Map<GroupingBigFiveKey, number>();
  GROUPING_BIG_FIVE_KEYS.forEach((key, index) => byKey.set(key, scores[index]));
  return GROUPING_ROLE_DEFS.filter((role) => (byKey.get(role.dimension) ?? 0) >= GROUPING_ROLE_THRESHOLD).map(
    (role) => role.key
  );
}

/** 角色 key → 中文标签（界面展示用） */
export function roleLabelOf(key: string): string {
  return GROUPING_ROLE_DEFS.find((role) => role.key === key)?.label ?? key;
}

/** 一组角色覆盖数（0–4）：不同角色至少各有一人命中 */
export function roleCoverageOfVectors(vectors: FeatureVector[], memberIndexes: number[]): number {
  const covered = new Set<string>();
  for (const index of memberIndexes) {
    for (const role of rolesOf(vectors[index])) covered.add(role);
  }
  return covered.size;
}

/**
 * 供界面展示的「按源的文本标签」：源无关——新增数据源后界面自动多出一组标签，
 * 不需要为每个源写渲染分支。向量型只展示主导型 / 角色，不展示原始分数（避免教师把分数当能力）。
 */
export function featureLabels(
  vector: FeatureVector,
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const s of sources) {
    const value = vector.values[s.key];
    if (!hasValue(value, s.kind)) {
      out[s.key] = [];
    } else if (s.kind === "vector" && Array.isArray(value)) {
      out[s.key] =
        s.key === "riasec"
          ? [dominantRiasecOf(vector) ?? ""]
          : rolesOf(vector).map((role) => roleLabelOf(role));
      out[s.key] = out[s.key].filter((item) => item.length > 0);
    } else if (Array.isArray(value)) {
      // 集合型源（tags）走到这里；向量型已在上一分支处理
      out[s.key] = [...(value as string[])];
    } else {
      out[s.key] = [String(value)];
    }
  }
  return out;
}

/** 源的展示元信息（key / 文案 / 类型 / 版本），供界面渲染分组依据 */
export function describeSourceMeta(
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): { key: string; label: string; kind: FeatureKind; version: string }[] {
  return sources.map((s) => ({ key: s.key, label: s.label, kind: s.kind, version: s.version }));
}

/** 覆盖率：有该源值的学生数 / 参与人数 */
export function countCovered(
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): { covered: number; total: number } {
  let covered = 0;
  for (const v of vectors) {
    const any = sources.some((s) => hasValue(v.values[s.key], s.kind));
    if (any) covered += 1;
  }
  return { covered, total: vectors.length };
}

/** 分源覆盖率（#345：本班 N 人：兴趣 x/N、人格 y/N、未测 z 人） */
export function coverageBySource(
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): { key: string; label: string; covered: number; total: number }[] {
  return sources.map((s) => ({
    key: s.key,
    label: s.label,
    covered: vectors.filter((v) => hasValue(v.values[s.key], s.kind)).length,
    total: vectors.length,
  }));
}

/** 两类测评都没做的学生数（只看测评源，与标签覆盖率无关） */
export function untestedAssessmentCount(vectors: FeatureVector[]): number {
  return vectors.filter(
    (v) => !hasValue(v.values["riasec"], "vector") && !hasValue(v.values["bigfive"], "vector")
  ).length;
}

/**
 * 参与计算的源：**权重为正** 且 **至少 2 个学生有值**（后者没有区分度，且会把相似度稀释）。
 * weight 0 是「先接上但不参与」的开关，必须在这里就出局：`buildGrouping` 用本函数的结果判定
 * 谁算「有特征」，若让 0 权源参与，只被它覆盖的学生会挤进贪心分配而不是走补位队列——
 * 加入一个不参与的源就改变了分组结果，与「不参与」的契约相反。
 * （覆盖率另按全部注册源统计，见 `countCovered`，与此处口径互不影响。）
 */
export function activeSources(
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): FeatureSourceDef[] {
  return sources.filter(
    (s) => s.weight > 0 && vectors.filter((v) => hasValue(v.values[s.key], s.kind)).length >= 2
  );
}
