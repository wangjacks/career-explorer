/**
 * 量表信效度验证的纯统计函数（#227）。
 *
 * 只做数学，不读数据库、不碰 React：CLI（`scripts/validate-assessment.mjs`）与单测共用同一份实现，
 * 避免「报告里算一遍、复核时又换一套公式」。所有函数对**脏输入**（空样本、常量列、长度不一致）
 * 返回 `null` 而不是 NaN——报告里应当显式写「无法计算」，不能把 NaN 当结果贴出来。
 */

// ── 判定阈值（方案里写死的验收线；改阈值要同步改 docs/assessment-validation-plan.md）──

/** 维度内部一致性（Cronbach's α）可接受下限 */
export const ALPHA_ACCEPTABLE = 0.7;
/** 维度内部一致性良好线 */
export const ALPHA_GOOD = 0.8;
/** 校正题总相关（CITC）下限：低于该值的题建议复核题面或删除 */
export const CITC_MIN = 0.3;
/** 重测信度（同一批人两次作答的相关）可接受下限 */
export const RETEST_ACCEPTABLE = 0.7;
/** 常模（百分位换算）最小样本量：低于此值只报告分布，不对外发布常模 */
export const NORM_MIN_SAMPLE = 60;
/** 常模推荐样本量：达到后常模更稳定 */
export const NORM_RECOMMENDED_SAMPLE = 100;
/** 常模输出的百分位点 */
export const NORM_PERCENTILES = [10, 25, 50, 75, 90] as const;

export type ValidityBand = "good" | "acceptable" | "below";

/** 相关系数 / α 的判定档位：≥good 为良好、≥acceptable 为可接受、否则未达标 */
export function bandOf(value: number, acceptable = ALPHA_ACCEPTABLE, good = ALPHA_GOOD): ValidityBand {
  if (value >= good) return "good";
  if (value >= acceptable) return "acceptable";
  return "below";
}

/** 档位的中文标签（报告与页面共用，避免各处自己拼） */
export const BAND_LABELS: Record<ValidityBand, string> = {
  good: "良好",
  acceptable: "可接受",
  below: "未达标",
};

/** 只保留「每行都是有限数值且列数等于 k」的行 */
function usableRows(matrix: readonly (readonly number[])[], columnCount: number): number[][] {
  const rows: number[][] = [];
  for (const row of matrix) {
    if (!Array.isArray(row) || row.length !== columnCount) continue;
    if (!row.every((value) => typeof value === "number" && Number.isFinite(value))) continue;
    rows.push([...row]);
  }
  return rows;
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 样本方差（ddof = 1，与 SPSS / R 的 var() 一致；单样本返回 0） */
function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  const sum = values.reduce((acc, value) => acc + (value - avg) ** 2, 0);
  return sum / (values.length - 1);
}

/**
 * Cronbach's α：`k/(k-1) * (1 - Σσ²ᵢ/σ²_total)`。
 *
 * 入参是 n×k 矩阵（每行一个被试、每列一道题，**反向题须先重编码**）。
 * 样本 < 2、题目 < 2、或总分方差为 0（所有人总分行一样）时返回 `null`。
 */
export function cronbachAlpha(items: readonly (readonly number[])[]): number | null {
  const columns = items.length > 0 ? items[0].length : 0;
  if (columns < 2) return null;
  const rows = usableRows(items, columns);
  const n = rows.length;
  if (n < 2) return null;
  const totalScore = rows.map((row) => row.reduce((sum, value) => sum + value, 0));
  const totalVariance = variance(totalScore);
  if (totalVariance <= 0) return null;
  let itemVarianceSum = 0;
  for (let col = 0; col < columns; col += 1) {
    itemVarianceSum += variance(rows.map((row) => row[col]));
  }
  const alpha = (columns / (columns - 1)) * (1 - itemVarianceSum / totalVariance);
  return Math.min(1, alpha);
}

/** 皮尔逊积差相关；任一侧方差为 0、样本 < 2 或长度不一致时返回 `null` */
export function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  if (!Array.isArray(xs) || !Array.isArray(ys) || xs.length !== ys.length) return null;
  const values = xs
    .map((x, index) => [x, ys[index]] as const)
    .filter(([x, y]) => Number.isFinite(x) && Number.isFinite(y));
  const n = values.length;
  if (n < 2) return null;
  const left = values.map(([x]) => x);
  const right = values.map(([, y]) => y);
  const leftVariance = variance(left);
  const rightVariance = variance(right);
  if (leftVariance <= 0 || rightVariance <= 0) return null;
  const leftMean = mean(left);
  const rightMean = mean(right);
  let covariance = 0;
  for (let index = 0; index < n; index += 1) {
    covariance += (left[index] - leftMean) * (right[index] - rightMean);
  }
  const r = covariance / (n - 1) / Math.sqrt(leftVariance * rightVariance);
  return Math.max(-1, Math.min(1, r));
}

/**
 * 校正题总相关（CITC）：每题与该维度**其余题之和**的皮尔逊相关。
 * 返回数组与列顺序一致；某题或其余题之和为常量时该位置为 `null`。
 */
export function correctedItemTotalCorrelations(items: readonly (readonly number[])[]): (number | null)[] {
  const columns = items.length > 0 ? items[0].length : 0;
  if (columns === 0) return [];
  if (columns === 1) return [null];
  const rows = usableRows(items, columns);
  if (rows.length < 3) return new Array(columns).fill(null);
  return Array.from({ length: columns }, (_, target) => {
    const item = rows.map((row) => row[target]);
    const rest = rows.map((row) => row.reduce((sum, value, index) => (index === target ? sum : sum + value), 0));
    return pearsonCorrelation(item, rest);
  });
}

export interface DimensionItemCitc {
  /** 真实题号（量表内从 1 开始） */
  index: number;
  /** 校正题总相关；无法计算为 null */
  r: number | null;
}

export interface DimensionReliability {
  dimension: string;
  /** 该维度题数 */
  itemCount: number;
  /** 参与计算的样本量（该维度题目全部有作答、且题目都有效的人） */
  sampleSize: number;
  alpha: number | null;
  /** α 的档位；无法计算时为 null */
  band: ValidityBand | null;
  citc: DimensionItemCitc[];
  /** CITC 低于阈值（或无法计算）的题号，供报告点名 */
  lowCitc: number[];
}

/**
 * 汇总单个维度的信度：α + 逐题 CITC + 低 CITC 题号。
 *
 * `rows` 是「已按反向题重编码」的矩阵，列顺序与 `itemIndexes` 一致；
 * `rows` 中列数不匹配或含非数值的行会被丢弃（脚本已先做过滤，这里再兜一层）。
 */
export function summarizeDimension(
  dimension: string,
  itemIndexes: readonly number[],
  rows: readonly (readonly number[])[]
): DimensionReliability {
  const matrix = usableRows(rows, itemIndexes.length);
  const correlations = correctedItemTotalCorrelations(matrix);
  const citc = itemIndexes.map((index, position) => ({ index, r: correlations[position] ?? null }));
  const alpha = cronbachAlpha(matrix);
  return {
    dimension,
    itemCount: itemIndexes.length,
    sampleSize: matrix.length,
    alpha,
    band: alpha === null ? null : bandOf(alpha),
    citc,
    lowCitc: citc.filter((item) => item.r === null || item.r < CITC_MIN).map((item) => item.index),
  };
}

export interface PercentileTable {
  sampleSize: number;
  p10: number;
  p25: number;
  p50: number;
  p75: number;
  p90: number;
}

/**
 * 百分位表（线性插值，与 numpy.percentile 默认口径一致）：
 * 位置 = (n-1) * p/100，落在两个相邻观测值之间时按比例插值。
 * 空样本返回 `null`。
 */
export function percentileTable(values: readonly number[]): PercentileTable | null {
  const sorted = values.filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  const n = sorted.length;
  if (n === 0) return null;
  const percentile = (p: number): number => {
    const position = ((n - 1) * p) / 100;
    const lower = Math.floor(position);
    const upper = Math.ceil(position);
    if (lower === upper) return sorted[lower];
    return sorted[lower] + (sorted[upper] - sorted[lower]) * (position - lower);
  };
  return {
    sampleSize: n,
    p10: percentile(10),
    p25: percentile(25),
    p50: percentile(50),
    p75: percentile(75),
    p90: percentile(90),
  };
}

/** 某分数在样本中的百分位（「不高于该分数」的人所占百分比，1 位小数）；空样本返回 `null` */
export function percentileRank(values: readonly number[], value: number): number | null {
  const usable = values.filter((item) => Number.isFinite(item));
  if (usable.length === 0 || !Number.isFinite(value)) return null;
  const count = usable.filter((item) => item <= value).length;
  return Math.round((count / usable.length) * 1000) / 10;
}

/** 常模样本量档位：`insufficient` 少于最小样本、`minimum` 刚够、`recommended` 达到推荐量 */
export function normSampleBand(sampleSize: number): "insufficient" | "minimum" | "recommended" {
  if (sampleSize >= NORM_RECOMMENDED_SAMPLE) return "recommended";
  if (sampleSize >= NORM_MIN_SAMPLE) return "minimum";
  return "insufficient";
}
