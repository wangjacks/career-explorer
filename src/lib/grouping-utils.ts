/**
 * 分组算法（纯函数，#101）。
 *
 * 目标（同质聚类）：最大化 Σ 组内两两相似度。
 * 因为全体两两相似度之和是常数，它**等价于最小化组间相似度**。
 *
 * 流程：先按「组规模规则」定好各组容量 → 容量受限分配（相似度贪心）+ FM 式交换精修
 *      → 无特征学生按学号顺序补满剩余槽位。
 * 全程确定性：进入前按学号排序、所有平局按下标打破、不使用随机数。
 */

import {
  FEATURE_SOURCES,
  activeSources,
  hasValue,
  type FeatureKind,
  type FeatureSourceDef,
  type FeatureVector,
} from "./grouping-features";

/** 每组人数上限（由业务规则固定为 5；下限在 n 较小时自然放宽） */
export const GROUP_SIZE_CAP = 5;

/** 策略名，写进 group_batches.strategy */
export const GROUPING_STRATEGY = "idf-cosine";

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

/** 逐源相似度矩阵：按 kind 分派，按 weight 加权求和；无参与源时全 0（退化为确定性分配） */
export function computeSimilarities(
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): number[][] {
  const n = vectors.length;
  const sim: number[][] = Array.from({ length: n }, () => new Array<number>(n).fill(0));
  const active = activeSources(vectors, sources);
  if (active.length === 0) return sim;
  const totalWeight = active.reduce((sum, s) => sum + s.weight, 0);
  for (const source of active) {
    const perSource = similarityForSource(vectors, source);
    const share = source.weight / totalWeight;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        const add = share * perSource[i][j];
        if (add === 0) continue;
        sim[i][j] += add;
        sim[j][i] += add;
      }
    }
  }
  return sim;
}

function similarityForSource(vectors: FeatureVector[], source: FeatureSourceDef): number[][] {
  const kind: FeatureKind = source.kind;
  if (kind === "numeric") return numericSimilarity(vectors, source);
  if (kind === "categorical") return categoricalSimilarity(vectors, source);
  return setSimilarity(vectors, source);
}

/**
 * 集合型（本期唯一在用）：IDF 加权二元余弦。
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
    return Array.isArray(raw) ? raw : [];
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

/* ---------- 3. 容量受限分配 ---------- */

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

    for (let step = 0; step < stepsPerPass; step++) {
      const move = bestSwap(groups, sim);
      if (!move) break;
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

/** 全量扫描所有跨组交换，返回目标函数增量最大的一个（平局取更小的组号/下标） */
function bestSwap(
  groups: number[][],
  sim: number[][]
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

/* ---------- 4. 指标与基线 ---------- */

export interface GroupingMetrics {
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

export function computeMetrics(
  groups: number[][],
  sim: number[][],
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): GroupingMetrics {
  const n = vectors.length;
  const active = activeSources(vectors, sources);
  // 覆盖率按**全部注册源**统计「有特征的人」——与「源是否参与计算」是两件事：
  // 班里只有 1 人有标签时，源不足以参与相似度，但覆盖率必须如实显示 1/N
  let covered = 0;
  for (const v of vectors) {
    if (sources.some((s) => hasValue(v.values[s.key], s.kind))) covered += 1;
  }
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
  const order = Array.from({ length: n }, (_, i) => i);
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

  return {
    studentCount: n,
    coveredCount: covered,
    nonZeroPairs,
    totalPairs: (n * (n - 1)) / 2,
    overall: totalScore(groups, sim),
    cohesion,
    baselines: { sequence: baselineSequence, random: RUNS > 0 ? randomSum / RUNS : 0 },
    activeSourceKeys: active.map((s) => s.key),
  };
}

/* ---------- 5. 编排 ---------- */

export interface GroupingResult {
  /** 与结果同序的学生（已按学号升序；下标即 groups 里的下标） */
  vectors: FeatureVector[];
  /** 各组容量 */
  sizes: number[];
  /** 分组结果（每组为 vectors 的下标，组内升序） */
  groups: number[][];
  metrics: GroupingMetrics;
}

/**
 * 完整编排：排序 → 容量 → 相似度 → 贪心分配 → FM 精修 → 指标。
 * 输入顺序不影响结果（内部先按学号升序稳定排序）。
 */
export function buildGrouping(
  vectors: FeatureVector[],
  sources: FeatureSourceDef[] = FEATURE_SOURCES
): GroupingResult {
  const sorted = [...vectors].sort((a, b) => {
    if (a.userCode !== b.userCode) return a.userCode < b.userCode ? -1 : 1;
    return a.studentId - b.studentId;
  });
  const sizes = computeGroupSizes(sorted.length);
  const sim = computeSimilarities(sorted, sources);
  const active = activeSources(sorted, sources);
  const featured = sorted.map((v) => active.some((s) => hasValue(v.values[s.key], s.kind)));
  const greedy = assignGroups(sizes, sim, featured);
  const refined = refineBySwaps(greedy, sim);
  return { vectors: sorted, sizes, groups: refined, metrics: computeMetrics(refined, sim, sorted, sources) };
}
