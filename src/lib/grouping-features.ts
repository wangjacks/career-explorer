/**
 * 分组特征源注册表（#101）。
 *
 * 设计要点：**算法层只认识「归一化后的特征集合」，不认识任何具体数据源**。
 * 新增数据源（如 #104 测评结果、自定义字段表、#162 文字评价）= 往 FEATURE_SOURCES 加一项
 * （必要时为该 kind 补一个相似度实现），算法主体、五张分组表、界面结构都不需要改。
 *
 * 本期只注册 tags 一个源；`numeric` / `categorical` 的分派与测试由 grouping-utils 覆盖。
 */

import type { UserRow } from "./db";
import { normalizeTagNames } from "./tag-utils";

/** 特征类型决定相似度的算法（见 grouping-utils 的分派） */
export type FeatureKind = "set" | "numeric" | "categorical";

/** 一个源在某学生上的取值：集合型为名称数组、数值型为数字、类别型为码（都可为空） */
export type FeatureValue = string[] | number | string | null;

export interface FeatureSourceDef {
  /** 稳定标识，进批次头的 feature_sources */
  key: string;
  /** 界面文案（单源时就是「标签」） */
  label: string;
  kind: FeatureKind;
  /** 多源加权求和时的权重 */
  weight: number;
  /** 从用户行取该源的值；纯函数，数据由上层取好 */
  extract: (user: UserRow) => FeatureValue;
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

/**
 * 已注册的特征源。新增源时只加一项：
 * - `kind` 决定用哪种相似度（set / numeric / categorical）
 * - `weight` 决定与其他源的相对权重
 * - `extract` 从 UserRow 取值（若数据在别的表，由路由先把该表数据并入传入的行）
 */
export const FEATURE_SOURCES: FeatureSourceDef[] = [
  {
    key: "tags",
    label: "标签",
    kind: "set",
    weight: 1,
    extract: extractTags,
  },
];

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
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): FeatureVector[] {
  return users.map((u) => {
    const values: Record<string, FeatureValue> = {};
    for (const s of sources) values[s.key] = s.extract(u);
    return { studentId: u.id, userCode: u.user_code, values };
  });
}

/** 批次头记录的「本次用了哪些源」：新增源只影响这段 JSON，不动表结构 */
export function describeSources(sources: FeatureSourceDef[] = FEATURE_SOURCES): string {
  return JSON.stringify(sources.map((s) => ({ key: s.key, kind: s.kind, weight: s.weight })));
}

/** 某个学生的某个源"有值"（用于覆盖率口径） */
export function hasValue(value: FeatureValue, kind: FeatureKind): boolean {
  if (value === null || value === undefined) return false;
  if (kind === "numeric") return typeof value === "number" && Number.isFinite(value);
  if (Array.isArray(value)) return value.length > 0;
  return typeof value === "string" && value.length > 0;
}

/**
 * 供界面展示的「按源的文本标签」：源无关——新增数据源后界面自动多出一组标签，
 * 不需要为每个源写渲染分支。
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
    } else if (Array.isArray(value)) {
      out[s.key] = [...value];
    } else {
      out[s.key] = [String(value)];
    }
  }
  return out;
}

/** 源的展示元信息（key / 文案 / 类型），供界面渲染分组依据 */
export function describeSourceMeta(
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): { key: string; label: string; kind: FeatureKind }[] {
  return sources.map((s) => ({ key: s.key, label: s.label, kind: s.kind }));
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
