/**
 * 分组算法（纯函数，#101 / #345）。
 *
 * 同质聚类（旧策略 C）：最大化 Σ 组内两两相似度。
 * 因为全体两两相似度之和是常数，它**等价于最小化组间相似度**。
 *
 * #345 起三种策略（默认 A）：
 * - A `interest-role-v1`：兴趣相近 + 性格互补——兴趣相似度组内更高，大五角色覆盖 ≥3；
 * - B `interest-contrast-v1`：兴趣互补——每组尽量覆盖更多兴趣型，性格仍互补；
 * - C `idf-cosine`：仅按标签（现状，未做测评时可用）。
 *
 * 流程（A/B）：按主导 RIASEC 分桶生成主型配额 → 按权重贪心填位（兴趣/标签/补角色）
 *           → 角色覆盖不足时做最小损失交换修复 → 组间人数差 ≤1、组上限 5。
 * 全程确定性：进入前按学号排序、所有平局按下标/学号打破、不使用随机数；
 * `variant` 只用于「重新生成换一版候选」，同输入同 variant 必得同输出。
 *
 * 大五 **N（神经质）不参与任何计算与展示**：特征源只注册 C/E/O/A（见 grouping-features）。
 */

import {
  FEATURE_SOURCES,
  GROUPING_ROLE_DEFS,
  activeSources,
  bigfiveVectorOf,
  coverageBySource,
  dominantRiasecOf,
  hasValue,
  riasecVectorOf,
  rolesOf,
  roleCoverageOfVectors,
  untestedAssessmentCount,
  type FeatureKind,
  type FeatureSourceDef,
  type FeatureVector,
} from "./grouping-features";
import { RIASEC_KEYS, type RiasecKey } from "./assessment-match";

/** 每组人数上限（由业务规则固定为 5；下限在 n 较小时自然放宽） */
export const GROUP_SIZE_CAP = 5;

/* ---------- 策略注册表（#345） ---------- */

/** 旧策略名（仅标签，历史批次沿用这个值） */
export const GROUPING_STRATEGY = "idf-cosine";
export const GROUPING_STRATEGY_TAGS_ONLY = GROUPING_STRATEGY;
export const GROUPING_STRATEGY_INTEREST_ROLE = "interest-role-v1";
export const GROUPING_STRATEGY_INTEREST_CONTRAST = "interest-contrast-v1";

export interface GroupingStrategyDef {
  key: string;
  label: string;
  /** 界面的一句话说明（不长于一行） */
  description: string;
  /** 是否需要测评数据（缺测评时该策略仍可生成，只是退化到标签） */
  requiresAssessment: boolean;
  isDefault: boolean;
}

/** 三种策略（顺序即界面顺序，默认 A 排第一） */
export const GROUPING_STRATEGIES: readonly GroupingStrategyDef[] = [
  {
    key: GROUPING_STRATEGY_INTEREST_ROLE,
    label: "兴趣相近 + 性格互补",
    description: "兴趣相似的同学一组，组内角色覆盖更全",
    requiresAssessment: true,
    isDefault: true,
  },
  {
    key: GROUPING_STRATEGY_INTEREST_CONTRAST,
    label: "兴趣互补",
    description: "每组尽量覆盖不同的兴趣类型，性格仍互补",
    requiresAssessment: true,
    isDefault: false,
  },
  {
    key: GROUPING_STRATEGY_TAGS_ONLY,
    label: "仅按标签（现状）",
    description: "只用标签相似度分组，未做测评也能用",
    requiresAssessment: false,
    isDefault: false,
  },
];

export const DEFAULT_GROUPING_STRATEGY = GROUPING_STRATEGY_INTEREST_ROLE;

/** 策略名 → 中文标签（历史批次回看：未知策略原样显示） */
export function groupingStrategyLabel(strategy: string | null | undefined): string {
  if (!strategy) return "未知策略";
  return GROUPING_STRATEGIES.find((s) => s.key === strategy)?.label ?? strategy;
}

/** 是不是已注册的策略 key（用于入参校验） */
export function isGroupingStrategyKey(value: string): boolean {
  return GROUPING_STRATEGIES.some((s) => s.key === value);
}

/** 角色覆盖目标（每组至少 3/4 个角色；A/B 的软目标，指标与界面提示用） */
export const ROLE_COVERAGE_TARGET = 3;

/** 角色覆盖不足时贪心填位的加成（相似度尺度 0–1 上的软约束，避免为了覆盖把兴趣完全打散） */
const ROLE_FILL_BONUS = 0.35;

const EPS = 1e-9;

/* ---------- 1. 组规模规则 ---------- */

/**
 * 组数 = ⌈n/5⌉（由「每组不超过 5 人」反推），各组人数**尽量均匀**（组间差 ≤1）。
 * 均匀分配保证不会出现 1–2 人的孤立组：`⌊n/g⌋ ≥ 3` 对一切 `n ≥ 6` 成立。
 * n=6/7/11 时无法让每组 ≥4（数学上做不到），会出现 3 人组，属已知且已接受的行为。
 */
export function computeGroupSizes(n: number): number[] {
  if (!Number.isFinite(n) || n <= 0) return [];
  const count = Math.ceil(n / GROUP_SIZE_CAP);
  const base = Math.floor(n / count);
  const extra = n % count;
  return [...new Array(extra).fill(base + 1), ...new Array(count - extra).fill(base)];
}

/* ---------- 2. 相似度（按特征类型分派） ---------- */

/**
 * 逐源相似度矩阵：按 kind 分派，按 weight 加权求和；无参与源时全 0（退化为确定性分配）。
 *
 * **按可用源逐对归一（#345）**：某对学生的某个源缺值（如没做测评）时，该源不参与这一对的
 * 加权和、分母也只算两边都有值的源——否则「缺测学生只用标签参与」会变成「标签 + 0 分测评」，
 * 被无谓地拉低相似度。分母为 0 的对按 0 处理。
 */
export function computeSimilarities(
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): number[][] {
  const n = vectors.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const active = activeSources(vectors, sources);
  if (active.length === 0) return sim;
  const totalWeight = active.reduce((sum, s) => sum + s.weight, 0);
  if (!(totalWeight > 0)) return sim;

  const numerator: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const denominator: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  for (const source of active) {
    const perSource = similarityForSource(vectors, source);
    for (let i = 0; i < n; i++) {
      const iHas = hasValue(vectors[i].values[source.key], source.kind);
      for (let j = i + 1; j < n; j++) {
        if (!iHas || !hasValue(vectors[j].values[source.key], source.kind)) continue;
        numerator[i][j] += source.weight * perSource[i][j];
        denominator[i][j] += source.weight;
      }
    }
  }
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      if (denominator[i][j] <= 0) continue;
      const value = numerator[i][j] / denominator[i][j];
      sim[i][j] = value;
      sim[j][i] = value;
    }
  }
  return sim;
}

function similarityForSource(vectors: FeatureVector[], source: FeatureSourceDef): number[][] {
  const kind: FeatureKind = source.kind;
  if (kind === "numeric") return numericSimilarity(vectors, source);
  if (kind === "vector") return vectorSimilarity(vectors, source);
  if (kind === "categorical") return categoricalSimilarity(vectors, source);
  return setSimilarity(vectors, source);
}

/**
 * 集合型：IDF 加权二元余弦。
 * - `df` 按**班内「有该特征的学生」**统计（无特征者不计入 N，否则 df 虚高）
 * - `idf = ln((N + 1) / (df + 1)) + 1` —— **平滑 IDF**（scikit-learn `TfidfTransformer` 的默认口径）。
 *   刻意不用未平滑的 `ln(N/df)`：后者在「某特征被全班选中」时权重恰好为 0，
 *   一旦全班的标签都相同（或班很小），所有相似度会一起塌成 0 ——
 *   而「两人标签完全相同」本该是最高相似。平滑后通用特征仍被降权（弱于稀有特征），但不会清零。
 * - 任一侧向量范数为 0（如该生无任何特征）→ 相似度 0，含 0/0 守卫
 */
function setSimilarity(vectors: FeatureVector[], source: FeatureSourceDef): number[][] {
  const n = vectors.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const sets = vectors.map((v) => {
    const raw = v.values[source.key];
    return source.kind === "set" && Array.isArray(raw) ? (raw as string[]) : [];
  });
  const docs = sets.filter((s) => s.length > 0).length;
  if (docs < 2) return sim;

  const df = new Map<string, number>();
  for (const s of sets) for (const t of s) df.set(t, (df.get(t) ?? 0) + 1);
  const weightOf = (t: string): number => {
    const d = df.get(t) ?? 0;
    if (d === 0) return 0;
    return Math.log((docs + 1) / (d + 1)) + 1;
  };

  const norms = sets.map((s) => {
    let acc = 0;
    for (const t of s) acc += weightOf(t) ** 2;
    return Math.sqrt(acc);
  });

  for (let i = 0; i < n; i++) {
    if (norms[i] === 0) continue;
    for (let j = i + 1; j < n; j++) {
      if (norms[j] === 0) continue;
      const [small, large] = sets[i].length <= sets[j].length ? [sets[i], sets[j]] : [sets[j], sets[i]];
      const largeSet = new Set(large);
      let dot = 0;
      for (const t of small) {
        if (!largeSet.has(t)) continue;
        const w = weightOf(t);
        dot += w * w;
      }
      if (dot === 0) continue;
      const value = dot / (norms[i] * norms[j]);
      sim[i][j] = value;
      sim[j][i] = value;
    }
  }
  return sim;
}

/** 数值型：归一化后的接近度（同值时记 1）；任一侧缺值记 0（约定：缺值视为最不相似） */
function numericSimilarity(vectors: FeatureVector[], source: FeatureSourceDef): number[][] {
  const n = vectors.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const values = vectors.map((v) => {
    const raw = v.values[source.key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
  });
  const present = values.filter((v): v is number => v !== null);
  if (present.length < 2) return sim;
  const min = Math.min(...present);
  const max = Math.max(...present);
  const range = max - min;
  for (let i = 0; i < n; i++) {
    if (values[i] === null) continue;
    for (let j = i + 1; j < n; j++) {
      if (values[j] === null) continue;
      const value = range === 0 ? 1 : 1 - Math.abs((values[i] as number) - (values[j] as number)) / range;
      sim[i][j] = value;
      sim[j][i] = value;
    }
  }
  return sim;
}

/**
 * 向量型（RIASEC 六维 / 大五四维）：**班内 z-score 标准化**后算余弦，再映射到 [0,1]。
 *
 * 为什么要标准化：测评的「整体高低」更多反映作答风格，分组关心的是**形状**（偏哪几型）；
 * 按维度做班内 z-score 后，整体偏高/偏低不再影响相似度，只留下相对轮廓。
 * 某维在班内方差为 0（所有人同分）时该维无区分度，跳过（贡献 0）。
 */
function vectorSimilarity(vectors: FeatureVector[], source: FeatureSourceDef): number[][] {
  const n = vectors.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const rawVectors = vectors.map((v) =>
    source.key === "riasec"
      ? riasecVectorOf(v)
      : source.key === "bigfive"
        ? bigfiveVectorOf(v)
        : Array.isArray(v.values[source.key])
          ? (v.values[source.key] as number[])
          : null
  );
  const presentIndexes = rawVectors
    .map((value, index) => (value ? index : -1))
    .filter((index) => index >= 0);
  if (presentIndexes.length < 2) return sim;
  const dims = rawVectors[presentIndexes[0]]!.length;
  if (dims === 0) return sim;

  const means: number[] = new Array(dims).fill(0);
  const sds: number[] = new Array(dims).fill(0);
  for (let d = 0; d < dims; d += 1) {
    let sum = 0;
    for (const index of presentIndexes) sum += rawVectors[index]![d];
    const mean = sum / presentIndexes.length;
    means[d] = mean;
    let variance = 0;
    for (const index of presentIndexes) variance += (rawVectors[index]![d] - mean) ** 2;
    sds[d] = Math.sqrt(variance / presentIndexes.length);
  }

  // 标准化向量：方差为 0 的维度记 0（无区分度）
  const zVectors: (number[] | null)[] = rawVectors.map((value) => {
    if (!value) return null;
    return value.map((score, d) => (sds[d] > EPS ? (score - means[d]) / sds[d] : 0));
  });

  for (let i = 0; i < n; i++) {
    const zi = zVectors[i];
    if (!zi) continue;
    const ni = Math.sqrt(zi.reduce((acc, value) => acc + value * value, 0));
    for (let j = i + 1; j < n; j++) {
      const zj = zVectors[j];
      if (!zj) continue;
      const nj = Math.sqrt(zj.reduce((acc, value) => acc + value * value, 0));
      if (ni <= EPS || nj <= EPS) {
        // 两人轮廓都与班均值完全一致（或全维方差为 0）：视为最相似
        sim[i][j] = 1;
        sim[j][i] = 1;
        continue;
      }
      let dot = 0;
      for (let d = 0; d < dims; d += 1) dot += zi[d] * zj[d];
      const cosine = Math.max(-1, Math.min(1, dot / (ni * nj)));
      sim[i][j] = (cosine + 1) / 2;
      sim[j][i] = (cosine + 1) / 2;
    }
  }
  return sim;
}

/** 类别型：完全匹配记 1，否则 0；任一侧缺值记 0 */
function categoricalSimilarity(vectors: FeatureVector[], source: FeatureSourceDef): number[][] {
  const n = vectors.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const values = vectors.map((v) => {
    const raw = v.values[source.key];
    return typeof raw === "string" && raw.length > 0 ? raw : null;
  });
  for (let i = 0; i < n; i++) {
    if (values[i] === null) continue;
    for (let j = i + 1; j < n; j++) {
      if (values[j] !== values[i]) continue;
      sim[i][j] = 1;
      sim[j][i] = 1;
    }
  }
  return sim;
}

/* ---------- 3. 容量受限分配（旧策略 C） ---------- */

/** 组内两两相似度之和（目标函数的基本块） */
function intraSum(members: number[], sim: number[][]): number {
  let sum = 0;
  for (let a = 0; a < members.length; a++) {
    for (let b = a + 1; b < members.length; b++) sum += sim[members[a]][members[b]];
  }
  return sum;
}

function totalScore(groups: number[][], sim: number[][]): number {
  return groups.reduce((sum, g) => sum + intraSum(g, sim), 0);
}

/**
 * 容量受限分配：
 * 1) 有特征的学生按「最孤立者优先做种子 → 与当前组最相似者优先入组」的贪心成组；
 * 2) 无特征的学生按顺序补满剩余槽位（优先人数最少的组）——它们不参与相似度。
 * 组内下标升序返回，保证展示顺序与结果都可复现。
 */
export function assignGroups(sizes: number[], sim: number[][], featured: boolean[]): number[][] {
  const n = featured.length;
  if (n === 0 || sizes.length === 0) return [];
  const targets = [...sizes];
  const groups: number[][] = sizes.map(() => []);
  const remaining = new Set<number>();
  for (let i = 0; i < n; i++) if (featured[i]) remaining.add(i);

  for (let g = 0; g < groups.length && remaining.size > 0; g++) {
    // 种子：与「已在其他组的学生」总相似度最小者（最孤立），平局取下标小者
    let seed = -1;
    let seedScore = Infinity;
    for (const i of remaining) {
      let sum = 0;
      for (let other = 0; other < groups.length; other++) {
        if (other === g) continue;
        for (const m of groups[other]) sum += sim[i][m];
      }
      if (sum < seedScore - EPS) {
        seedScore = sum;
        seed = i;
      }
    }
    if (seed === -1) break;
    groups[g].push(seed);
    remaining.delete(seed);

    while (groups[g].length < targets[g] && remaining.size > 0) {
      // 与当前组平均相似度最高者；平局取下标小者
      let best = -1;
      let bestAvg = -Infinity;
      for (const i of remaining) {
        let sum = 0;
        for (const m of groups[g]) sum += sim[i][m];
        const avg = sum / groups[g].length;
        if (avg > bestAvg + EPS) {
          bestAvg = avg;
          best = i;
        }
      }
      if (best === -1) break;
      groups[g].push(best);
      remaining.delete(best);
    }
  }

  // 无特征者（含未被贪心用到的有特征者，理论上不会发生）按顺序补满剩余槽位
  const fillers: number[] = [];
  for (let i = 0; i < n; i++) if (!featured[i]) fillers.push(i);
  for (const i of fillers) {
    let target = -1;
    for (let g = 0; g < groups.length; g++) {
      if (groups[g].length >= targets[g]) continue;
      if (target === -1 || groups[g].length < groups[target].length) target = g;
    }
    if (target === -1) break;
    groups[target].push(i);
  }

  for (const g of groups) g.sort((a, b) => a - b);
  return groups;
}

/**
 * FM 式交换精修：一轮内连续做「当前最优」的跨组交换（**允许暂时变差**），
 * 记录本轮最优快照，轮末回到该快照；重复到最优不再提升。
 * 只做等量交换 → **组人数不变**，容量约束天然保持。
 * 每步禁止走回上一步（1 步禁忌）：交换增量的反对称性决定了不加禁忌时行走会在两个状态间
 * 来回抖动（实测 83.7% 的步是上一步的精确反向），「允许暂时变差」就退化成原地踏步、走不出链。
 */
export function refineBySwaps(
  input: number[][],
  sim: number[][],
  maxPasses = 6,
  stepsPerPass = 12
): number[][] {
  let groups = input.map((g) => [...g]);
  let improved = true;
  let pass = 0;
  while (improved && pass < maxPasses) {
    pass += 1;
    const startScore = totalScore(groups, sim);
    let bestScore = startScore;
    let bestSnapshot = groups.map((g) => [...g]);
    let previous: { g1: number; g2: number; i: number; j: number } | null = null;

    for (let step = 0; step < stepsPerPass; step++) {
      const move = bestSwap(groups, sim, previous);
      if (!move) break;
      previous = move;
      const { g1, g2, i, j } = move;
      groups[g1] = groups[g1].map((x) => (x === i ? j : x));
      groups[g2] = groups[g2].map((x) => (x === j ? i : x));
      const score = totalScore(groups, sim);
      if (score > bestScore + EPS) {
        bestScore = score;
        bestSnapshot = groups.map((g) => [...g]);
      }
    }

    groups = bestSnapshot.map((g) => g.sort((a, b) => a - b));
    improved = bestScore > startScore + EPS;
  }
  return groups;
}

/**
 * 带角色覆盖约束的相似度精修（#345 A/B）：
 * 只接受「两个组的角色覆盖都不低于目标、且组内相似度提升」的交换；
 * 与 `refineBySwaps` 的 FM 允许暂时变差不同，这里不做暂时变差——参数确定性优先，
 * 避免精修把刚修好的角色覆盖再打散。
 */
export function refineWithRoleGuard(
  input: number[][],
  sim: number[][],
  vectors: FeatureVector[],
  target = ROLE_COVERAGE_TARGET,
  maxPasses = 4
): number[][] {
  const groups = input.map((g) => [...g]);
  const coverageOf = (g: number[]) => roleCoverageOfVectors(vectors, g);
  for (let pass = 0; pass < maxPasses; pass += 1) {
    let best: { g1: number; g2: number; i: number; j: number; delta: number } | null = null;
    for (let g1 = 0; g1 < groups.length; g1 += 1) {
      for (let g2 = g1 + 1; g2 < groups.length; g2 += 1) {
        if (groups[g1].length === 0 || groups[g2].length === 0) continue;
        for (const i of groups[g1]) {
          for (const j of groups[g2]) {
            const nextG1 = groups[g1].map((x) => (x === i ? j : x));
            const nextG2 = groups[g2].map((x) => (x === j ? i : x));
            // 角色覆盖不能低于目标（原本已低于目标的组，至少要不变差）
            const before1 = coverageOf(groups[g1]);
            const before2 = coverageOf(groups[g2]);
            if (coverageOf(nextG1) < Math.min(before1, target) || coverageOf(nextG2) < Math.min(before2, target)) {
              continue;
            }
            const delta = intraSum(nextG1, sim) + intraSum(nextG2, sim) - intraSum(groups[g1], sim) - intraSum(groups[g2], sim);
            if (delta > EPS && (best === null || delta > best.delta + EPS)) best = { g1, g2, i, j, delta };
          }
        }
      }
    }
    if (!best) break;
    groups[best.g1] = groups[best.g1].map((x) => (x === best!.i ? best!.j : x)).sort((a, b) => a - b);
    groups[best.g2] = groups[best.g2].map((x) => (x === best!.j ? best!.i : x)).sort((a, b) => a - b);
  }
  return groups;
}

/**
 * 全量扫描所有跨组交换，返回目标函数增量最大的一个（平局取更小的组号/下标）。
 * `forbidden` 为上一步的交换，用于跳过「把 i、j 换回原处」的精确反向。
 */
function bestSwap(
  groups: number[][],
  sim: number[][],
  forbidden: { g1: number; g2: number; i: number; j: number } | null = null
): { g1: number; g2: number; i: number; j: number } | null {
  const n = groups.reduce((sum, g) => sum + g.length, 0);
  if (n === 0) return null;
  // simToGroup[x][g] = Σ_{y∈g} sim(x,y)（自身记 0）。
  // **每个学生对每个组都要算**：delta 公式里的 simToGroup[j][g1] / simToGroup[i][g2] 是跨组项，
  // 只填「自己所在组」会让它们恒为 0 —— FM 会选错交换，看似在精修其实没优化目标函数。
  const simToGroup: number[][] = Array.from({ length: n }, () => new Array<number>(groups.length).fill(0));
  for (let g = 0; g < groups.length; g++) {
    for (let x = 0; x < n; x++) {
      let sum = 0;
      for (const y of groups[g]) sum += sim[x][y];
      simToGroup[x][g] = sum;
    }
  }
  let best: { g1: number; g2: number; i: number; j: number; delta: number } | null = null;
  for (let g1 = 0; g1 < groups.length; g1++) {
    for (let g2 = g1 + 1; g2 < groups.length; g2++) {
      for (const i of groups[g1]) {
        for (const j of groups[g2]) {
          if (
            forbidden &&
            forbidden.g1 === g1 &&
            forbidden.g2 === g2 &&
            forbidden.i === j &&
            forbidden.j === i
          ) {
            continue; // 上一步的反向：换了等于没换
          }
          const delta =
            simToGroup[j][g1] - simToGroup[i][g1] - sim[i][j] + (simToGroup[i][g2] - simToGroup[j][g2] - sim[i][j]);
          if (best === null || delta > best.delta + EPS) {
            best = { g1, g2, i, j, delta };
          }
        }
      }
    }
  }
  return best === null ? null : { g1: best.g1, g2: best.g2, i: best.i, j: best.j };
}

/* ---------- 4. A/B 策略：主型配额 + 角色覆盖 ---------- */

interface StrategyPlan {
  groups: number[][];
  /** 每组的主型（A 策略的配额；B/C 为 null） */
  primaryTypes: (RiasecKey | null)[];
}

/** 组的平均相似度（组内不足 2 人时记 0，避免除零） */
function avgSimilarityToGroup(student: number, members: number[], sim: number[][]): number {
  if (members.length === 0) return 0;
  let sum = 0;
  for (const member of members) sum += sim[student][member];
  return sum / members.length;
}

/** 角色覆盖是否可被该学生提升 */
function improvesRoleCoverage(group: number[], student: number, vectors: FeatureVector[]): boolean {
  const before = new Set<string>();
  for (const member of group) for (const role of rolesOf(vectors[member])) before.add(role);
  if (before.size >= GROUPING_ROLE_DEFS.length) return false;
  for (const role of rolesOf(vectors[student])) if (!before.has(role)) return true;
  return false;
}

/** 该学生的主导兴趣型是否还没出现在组里（兴趣互补策略的分散加成） */
function addsNewDominantType(group: number[], student: number, vectors: FeatureVector[]): boolean {
  const dominant = dominantRiasecOf(vectors[student]);
  if (!dominant) return false;
  return !group.some((member) => dominantRiasecOf(vectors[member]) === dominant);
}

/**
 * A/B 策略编排（#345）。
 *
 * 步骤：
 * 1) 按主导 RIASEC 分桶，按桶大小降序给每组分配「主型配额」（variant 决定轮转起点，
 *    用于「重新生成」给出确定性的另一版候选）；
 * 2) 先让每组从主型桶取一名学生（桶内按主导分降序、学号升序；variant 旋转起点）；
 * 3) 剩余学生按「A：与组平均相似度最大 / B：最小」贪心填位，缺角色的学生有软加成；
 * 4) 角色覆盖不足做最小损失交换修复；再用带角色约束的精修提升组内相似度。
 */
function assignByStrategy(
  sorted: FeatureVector[],
  sim: number[][],
  sizes: number[],
  strategy: string,
  variant: number
): StrategyPlan {
  const n = sorted.length;
  const groups: number[][] = sizes.map(() => []);
  const placed = new Array<boolean>(n).fill(false);
  const variantOffset = Number.isFinite(variant) ? Math.max(0, Math.floor(variant)) : 0;
  const contrast = strategy === GROUPING_STRATEGY_INTEREST_CONTRAST;

  // 1) 主导型分桶（无兴趣结果的学生不参与主型配额）
  const buckets = new Map<RiasecKey, number[]>();
  for (const key of RIASEC_KEYS) buckets.set(key, []);
  const untyped: number[] = [];
  for (let i = 0; i < n; i += 1) {
    const dominant = dominantRiasecOf(sorted[i]);
    if (dominant) buckets.get(dominant)!.push(i);
    else untyped.push(i);
  }
  const orderedTypes = RIASEC_KEYS.filter((key) => buckets.get(key)!.length > 0).sort((a, b) => {
    const diff = buckets.get(b)!.length - buckets.get(a)!.length;
    if (diff !== 0) return diff;
    return RIASEC_KEYS.indexOf(a) - RIASEC_KEYS.indexOf(b);
  });

  const primaryTypes: (RiasecKey | null)[] = groups.map((_, index) =>
    orderedTypes.length > 0 ? orderedTypes[(index + variantOffset) % orderedTypes.length] : null
  );

  // 2) 每组从主型桶取一人；桶内按主导分降序、学号升序，variant 旋转起点
  const bucketCursor = new Map<RiasecKey, number>();
  for (let g = 0; g < groups.length; g += 1) {
    const type = primaryTypes[g];
    if (!type) continue;
    const bucket = buckets.get(type)!.filter((index) => !placed[index]);
    if (bucket.length === 0) continue;
    const cursor = (bucketCursor.get(type) ?? 0) + variantOffset;
    const pick = bucket[cursor % bucket.length];
    bucketCursor.set(type, cursor + 1);
    groups[g].push(pick);
    placed[pick] = true;
  }

  // 3) 贪心填位：每次挑「学生-组」最优对（A 相似度高优先 / B 相似度低优先 + 角色加成）
  const remaining = new Set<number>();
  for (let i = 0; i < n; i += 1) if (!placed[i]) remaining.add(i);
  const remainingCount = () => groups.reduce((sum, g) => sum + g.length, 0);
  while (remainingCount() < n && remaining.size > 0) {
    let best: { group: number; student: number; score: number } | null = null;
    for (let g = 0; g < groups.length; g += 1) {
      if (groups[g].length >= sizes[g]) continue;
      for (const student of remaining) {
        if (contrast) {
          // 兴趣互补：与组内平均相似度越低越好（不同型一组）；仍要求角色互补。
          // 「主导型还没出现在这一组」额外加成，保证每组覆盖更多型（否则角色加成会把同型拉回来）。
          const base = 1 - avgSimilarityToGroup(student, groups[g], sim);
          const diversityBonus = addsNewDominantType(groups[g], student, sorted) ? ROLE_FILL_BONUS : 0;
          const roleBonus = improvesRoleCoverage(groups[g], student, sorted) ? ROLE_FILL_BONUS : 0;
          const score = base + diversityBonus + roleBonus;
          if (best === null || score > best.score + EPS) best = { group: g, student, score };
        } else {
          const base = avgSimilarityToGroup(student, groups[g], sim);
          const bonus = improvesRoleCoverage(groups[g], student, sorted) ? ROLE_FILL_BONUS : 0;
          const score = base + bonus;
          if (best === null || score > best.score + EPS) best = { group: g, student, score };
        }
      }
    }
    if (!best) break;
    groups[best.group].push(best.student);
    remaining.delete(best.student);
  }

  // 4) 角色覆盖修复：最小损失交换，目标每组覆盖 ≥3
  repairRoleCoverage(groups, sim, sorted);
  // 5) 兴趣互补：再修一次「每组至少 2 个主导型」（角色修复可能把同型的人换回来）
  if (contrast) repairDominantDiversity(groups, sim, sorted);

  return { groups: groups.map((g) => g.sort((a, b) => a - b)), primaryTypes };
}

/** 找出覆盖不足的组里「最该被换掉」的成员：换掉后组内角色覆盖不降 */
function pickSwapForCoverage(
  groups: number[][],
  sim: number[][],
  vectors: FeatureVector[]
): { g1: number; g2: number; i: number; j: number } | null {
  const coverages = groups.map((g) => roleCoverageOfVectors(vectors, g));
  const deficit = groups
    .map((g, index) => ({ index, coverage: coverages[index], size: g.length }))
    .filter((item) => item.coverage < ROLE_COVERAGE_TARGET && item.size > 1);
  if (deficit.length === 0) return null;

  let best:
    | { g1: number; g2: number; i: number; j: number; gain: number; loss: number }
    | null = null;
  for (const { index: g1 } of deficit) {
    for (let g2 = 0; g2 < groups.length; g2 += 1) {
      if (g2 === g1 || groups[g2].length === 0) continue;
      for (const i of groups[g1]) {
        for (const j of groups[g2]) {
          const nextG1 = groups[g1].map((x) => (x === i ? j : x));
          const nextG2 = groups[g2].map((x) => (x === j ? i : x));
          const coverageGain =
            roleCoverageOfVectors(vectors, nextG1) -
            coverages[g1] +
            (roleCoverageOfVectors(vectors, nextG2) - coverages[g2]);
          if (coverageGain <= 0) continue;
          const loss =
            intraSum(groups[g1], sim) + intraSum(groups[g2], sim) - intraSum(nextG1, sim) - intraSum(nextG2, sim);
          // 覆盖增益优先，其次损失最小（确定性：组号/下标升序遍历 + 严格优于才替换）
          const better =
            best === null ||
            coverageGain > best.gain + EPS ||
            (Math.abs(coverageGain - best.gain) <= EPS && loss < best.loss - EPS);
          if (better) best = { g1, g2, i, j, gain: coverageGain, loss };
        }
      }
    }
  }
  return best === null ? null : { g1: best.g1, g2: best.g2, i: best.i, j: best.j };
}

/** 反复做「角色覆盖增益最大、损失最小」的交换，直到所有组达标或没有可做的交换 */
function repairRoleCoverage(groups: number[][], sim: number[][], vectors: FeatureVector[]): void {
  for (let step = 0; step < groups.length * 4; step += 1) {
    const move = pickSwapForCoverage(groups, sim, vectors);
    if (!move) return;
    const { g1, g2, i, j } = move;
    groups[g1] = groups[g1].map((x) => (x === i ? j : x)).sort((a, b) => a - b);
    groups[g2] = groups[g2].map((x) => (x === j ? i : x)).sort((a, b) => a - b);
  }
}

/** 一组里出现了多少个不同的主导兴趣型 */
function distinctDominantCount(group: number[], vectors: FeatureVector[]): number {
  return new Set(group.map((index) => dominantRiasecOf(vectors[index])).filter(Boolean)).size;
}

/**
 * 兴趣互补（B）的分散修复：保证每组至少 `minTypes` 个不同主导型。
 * 只做「总型数增加」的等量交换；同增益时优先让组内相似度更低（更互补）。
 */
function repairDominantDiversity(
  groups: number[][],
  sim: number[][],
  vectors: FeatureVector[],
  minTypes = 2
): void {
  const maxTypes = Math.min(minTypes, new Set(vectors.map((vector) => dominantRiasecOf(vector)).filter(Boolean)).size);
  if (maxTypes < 2) return;
  for (let step = 0; step < groups.length * 3; step += 1) {
    const deficient = groups.findIndex(
      (group) => group.length >= 2 && distinctDominantCount(group, vectors) < maxTypes
    );
    if (deficient < 0) return;
    let best: { g2: number; i: number; j: number; gain: number; similarityLoss: number } | null = null;
    for (let g2 = 0; g2 < groups.length; g2 += 1) {
      if (g2 === deficient || groups[g2].length === 0) continue;
      for (const i of groups[deficient]) {
        for (const j of groups[g2]) {
          const nextDeficient = groups[deficient].map((x) => (x === i ? j : x));
          const nextDonor = groups[g2].map((x) => (x === j ? i : x));
          const gain =
            distinctDominantCount(nextDeficient, vectors) -
            distinctDominantCount(groups[deficient], vectors) +
            (distinctDominantCount(nextDonor, vectors) - distinctDominantCount(groups[g2], vectors));
          if (gain <= 0) continue;
          const similarityLoss =
            intraSum(nextDeficient, sim) + intraSum(nextDonor, sim) - intraSum(groups[deficient], sim) - intraSum(groups[g2], sim);
          const better =
            best === null ||
            gain > best.gain ||
            (gain === best.gain && similarityLoss < best.similarityLoss);
          if (better) best = { g2, i, j, gain, similarityLoss };
        }
      }
    }
    if (!best) return;
    const { g2, i, j } = best;
    groups[deficient] = groups[deficient].map((x) => (x === i ? j : x)).sort((a, b) => a - b);
    groups[g2] = groups[g2].map((x) => (x === j ? i : x)).sort((a, b) => a - b);
  }
}

/* ---------- 5. 指标与基线 ---------- */

export interface GroupingMetrics {
  /** 本次使用的策略名（旧批次可能缺失） */
  strategy?: string;
  /** 参与人数（该班全部学生） */
  studentCount: number;
  /** 有特征的学生数（覆盖率分子） */
  coveredCount: number;
  /** 非零相似度的对数 / 总对数（判断相似度是否真正生效） */
  nonZeroPairs: number;
  totalPairs: number;
  /** 整体目标值 = Σ 组内两两相似度 */
  overall: number;
  /** 每组内聚度（组内平均相似度；组内不足 2 人记 null） */
  cohesion: (number | null)[];
  /** 与两条基线的对照（自证「结果不是随机」） */
  baselines: { sequence: number; random: number };
  /** 本次实际参与计算的源 key */
  activeSourceKeys: string[];
  /** 每组角色覆盖数（0–4，大五 C/E/O/A 高维映射） */
  roleCoverage?: number[];
  /** 角色覆盖均值（界面指标卡） */
  roleCoverageAverage?: number;
  /** 角色覆盖目标 */
  roleCoverageTarget?: number;
  /** 分源覆盖率（标签 / 兴趣 / 性格） */
  coverageBySource?: { key: string; label: string; covered: number; total: number }[];
  /** 兴趣与人格都没做的学生数 */
  untestedCount?: number;
  /** 组间 RIASEC 维度均值的平均标准差（越小越均衡）；无兴趣数据为 null */
  balance?: number | null;
}

/** 确定性伪随机（固定种子；仅用于基线对照，不影响最终结果） */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** 按给定顺序与容量切分成组 */
function chunk(order: number[], sizes: number[]): number[][] {
  const out: number[][] = [];
  let cursor = 0;
  for (const size of sizes) {
    out.push(order.slice(cursor, cursor + size));
    cursor += size;
  }
  return out;
}

/**
 * 组间均衡度：各组 RIASEC 六维均值 → 每维跨组标准差 → 六维平均。
 * 越小说明各组「兴趣构成」越接近（不是要求每组高低分相同，而是不出现某组全是同一型还都超高）。
 */
function computeBalance(groups: number[][], vectors: FeatureVector[]): number | null {
  const withInterest = groups.filter((g) => g.some((index) => riasecVectorOf(vectors[index])));
  if (withInterest.length < 2) return null;
  const dims = RIASEC_KEYS.length;
  const groupMeans = withInterest.map((g) => {
    const sum = new Array<number>(dims).fill(0);
    let count = 0;
    for (const index of g) {
      const vector = riasecVectorOf(vectors[index]);
      if (!vector) continue;
      count += 1;
      for (let d = 0; d < dims; d += 1) sum[d] += vector[d];
    }
    return sum.map((value) => (count > 0 ? value / count : 0));
  });
  let totalStd = 0;
  for (let d = 0; d < dims; d += 1) {
    const values = groupMeans.map((means) => means[d]);
    const mean = values.reduce((acc, value) => acc + value, 0) / values.length;
    const variance = values.reduce((acc, value) => acc + (value - mean) ** 2, 0) / values.length;
    totalStd += Math.sqrt(variance);
  }
  return totalStd / dims;
}

/**
 * 指标计算。
 *
 * 两组源要分清（#345 评审第 1 条）：
 * - `sources`＝**参与计算的源**：相似度矩阵由它决定，`activeSourceKeys` 也从它取；
 *   策略 C 只有标签源，所以它的 `overall` / `cohesion` / 基线都是「仅标签」口径。
 * - `displaySources`＝**覆盖率口径的源**：`coveredCount` / `coverageBySource` 回答的是
 *   「这个班有多少人有兴趣/性格数据」，与本次分组用了哪些源无关。若沿用 `sources`，
 *   C 策略会把全班算成「未测」、测评覆盖显示 0/N（向量里根本没有那两个键），
 *   归档批次的指标也跟着失真。调用方传「全部注册源 + 同一份测评上下文的展示向量」，
 *   C 也能如实报告覆盖率与角色覆盖。
 */
export function computeMetrics(
  groups: number[][],
  sim: number[][],
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES,
  strategy: string = GROUPING_STRATEGY_TAGS_ONLY,
  displaySources: FeatureSourceDef[] = sources
): GroupingMetrics {
  const n = vectors.length;
  const active = activeSources(vectors, sources);
  // 覆盖率按 displaySources 统计「有特征的人」——与「源是否参与计算」是两件事：
  // 班里只有 1 人有标签时，源不足以参与相似度，但覆盖率必须如实显示 1/N
  let covered = 0;
  for (const v of vectors) {
    if (displaySources.some((s) => hasValue(v.values[s.key], s.kind))) covered += 1;
  }
  // 共同特征对数 / 总对数按**全班**统计，回答「有没有信号可用」；
  // overall 与 cohesion 只算组内，回答「分得好不好」——两者分母不同，界面必须分开标注
  let nonZeroPairs = 0;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) if (sim[i][j] > 0) nonZeroPairs += 1;
  }
  const cohesion = groups.map((g) => {
    if (g.length < 2) return null;
    return (2 * intraSum(g, sim)) / (g.length * (g.length - 1));
  });

  // 基线 1：按学号顺序切分；基线 2：固定种子随机（多次取平均，减少偶然性）
  const sizes = groups.map((g) => g.length);
  // **基线人群必须与 overall 一致**：读当前分组时班里可能有人还没进任何组（自动分组之后新转入 / 新导入），
  // 按全班下标切分会把未分组的人算进基线、把真实成员挤出去，两个数字就不可比了
  const order = [...new Set(groups.flat())].sort((a, b) => a - b);
  const baselineSequence = totalScore(chunk(order, sizes), sim);
  const random = mulberry32(20260930);
  let randomSum = 0;
  const RUNS = 20;
  for (let run = 0; run < RUNS; run++) {
    const shuffled = [...order];
    for (let i = shuffled.length - 1; i > 0; i--) {
      const j = Math.floor(random() * (i + 1));
      [shuffled[i], shuffled[j]] = [shuffled[j], shuffled[i]];
    }
    randomSum += totalScore(chunk(shuffled, sizes), sim);
  }

  const roleCoverage = groups.map((g) => roleCoverageOfVectors(vectors, g));
  const roleCoverageAverage =
    roleCoverage.length > 0 ? roleCoverage.reduce((sum, value) => sum + value, 0) / roleCoverage.length : 0;

  return {
    strategy,
    studentCount: n,
    coveredCount: covered,
    nonZeroPairs,
    totalPairs: (n * (n - 1)) / 2,
    overall: totalScore(groups, sim),
    cohesion,
    baselines: { sequence: baselineSequence, random: RUNS > 0 ? randomSum / RUNS : 0 },
    activeSourceKeys: active.map((s) => s.key),
    roleCoverage,
    roleCoverageAverage,
    roleCoverageTarget: ROLE_COVERAGE_TARGET,
    coverageBySource: coverageBySource(vectors, displaySources),
    untestedCount: untestedAssessmentCount(vectors),
    balance: computeBalance(groups, vectors),
  };
}

/* ---------- 6. 编排 ---------- */

export interface GroupingOptions {
  /** 策略 key；缺省按旧策略（仅标签）以保持既有调用方行为不变 */
  strategy?: string;
  /** 重新生成候选用的确定性变体号（0 起；同输入同变体必得同输出） */
  variant?: number;
  /**
   * 覆盖率口径的源（见 `computeMetrics`）：调用方传「全部注册源」，
   * 分组用 `sources`、覆盖率/角色覆盖用展示向量与展示源。缺省与 `sources` 相同。
   */
  displaySources?: FeatureSourceDef[];
}

export interface GroupingResult {
  /** 与结果同序的学生（已按学号升序；下标即 groups 里的下标） */
  vectors: FeatureVector[];
  /** 各组容量 */
  sizes: number[];
  /** 分组结果（每组为 vectors 的下标，组内升序） */
  groups: number[][];
  /** 每组主型（A 策略的主型配额；其它策略为 null） */
  primaryTypes: (RiasecKey | null)[];
  metrics: GroupingMetrics;
}

/**
 * 完整编排：排序 → 容量 → 相似度 → 分配（按策略）→ 指标。
 * 输入顺序不影响结果（内部先按学号升序稳定排序）。
 */
export function buildGrouping(
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES,
  options: GroupingOptions = {}
): GroupingResult {
  const sorted = [...vectors].sort((a, b) => {
    if (a.userCode !== b.userCode) return a.userCode < b.userCode ? -1 : 1;
    return a.studentId - b.studentId;
  });
  const sizes = computeGroupSizes(sorted.length);
  const sim = computeSimilarities(sorted, sources);
  const strategy = options.strategy ?? GROUPING_STRATEGY_TAGS_ONLY;
  const variant = options.variant ?? 0;
  const display = options.displaySources ?? sources;

  if (strategy === GROUPING_STRATEGY_INTEREST_ROLE || strategy === GROUPING_STRATEGY_INTEREST_CONTRAST) {
    const plan = assignByStrategy(sorted, sim, sizes, strategy, variant);
    // A：再做一次「不破坏角色覆盖」的相似度精修；B 不能做——精修会把「兴趣互补」重新拉回同型聚集
    const guarded =
      strategy === GROUPING_STRATEGY_INTEREST_CONTRAST
        ? plan.groups
        : refineWithRoleGuard(plan.groups, sim, sorted);
    return {
      vectors: sorted,
      sizes,
      groups: guarded,
      primaryTypes: plan.primaryTypes,
      metrics: computeMetrics(guarded, sim, sorted, sources, strategy, display),
    };
  }

  // 旧策略（C）：保持原有贪心 + FM 精修，行为不变
  const active = activeSources(sorted, sources);
  const featured = sorted.map((v) => active.some((s) => hasValue(v.values[s.key], s.kind)));
  const greedy = assignGroups(sizes, sim, featured);
  const refined = refineBySwaps(greedy, sim);
  return {
    vectors: sorted,
    sizes,
    groups: refined,
    primaryTypes: refined.map(() => null),
    metrics: computeMetrics(refined, sim, sorted, sources, strategy, display),
  };
}
