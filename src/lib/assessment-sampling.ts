import { NEAR_DUPLICATE_GROUPS, SAMPLING_EXCLUDED_ORIGINS, type QuestionOrigin } from "./assessment-data";

/**
 * 每次作答的分层确定性抽题（#282）：纯函数、无 I/O，rng 可注入。
 *
 * 核心决策是**确定性派生而不是每次随机**：`draw = f(userId, assessmentId, poolFingerprint, attemptNo)`，
 * 任何路由（start / answer / submit / results）各自重算都得到同一张卷子，`GET /start` 因此保持只读、
 * 不建空草稿行（#223 不变量）；轮换由 `attemptNo`（completed 行数 + 1）承担，重测不复用上一轮。
 *
 * 分层规则（每张卷）：每维固定 `perDimension` 题。**#284 回退期间**原创题（`cn-original`）
 * 整体不进抽题池（`SAMPLING_EXCLUDED_ORIGINS`），每维从 10 道官方题里抽 5 道；验证通过后
 * 常量移除来源，恢复「官方 2-3 + 原创 2-3」配比。`NEAR_DUPLICATE_GROUPS` 同卷至多一题；
 * 拼齐后整体洗牌，再按「避免 3 题及以上连续同维度」修整顺序。
 *
 * 降级阶梯（池子不够时按序放宽并打 warning，不抛错——后台删题不能让作答 500）：
 * 来源配比 → 排除集 → 近重复组。
 */

/** 抽题所需的题库行投影（路由从 `assessment_questions` 行映射而来） */
export interface DrawItem {
  index: number;
  dimension: string;
  origin: QuestionOrigin;
}

/** 抽题所需的题库行投影 + 指纹用版本号 */
export interface PoolItem extends DrawItem {
  version: number;
}

/** 一次抽题的结果：`indexes` 按**呈现顺序**排列 */
export interface DrawResult {
  indexes: number[];
  warnings: string[];
}

export interface DrawOptions {
  /** 完整题库（全部维度） */
  items: readonly DrawItem[];
  /** 维度声明顺序 */
  dimensions: readonly { key: string }[];
  /** 每维度抽几题（`itemsPerAttempt / 维度数`，由调用方保证整除） */
  perDimension: number;
  /** 排除集（上一轮完成结果用过的题号） */
  excludeIndexes?: ReadonlySet<number>;
  /** 近重复题组：同卷至多抽到组内一题（默认取量表常量） */
  nearDuplicateGroups?: readonly (readonly number[])[];
  /** 不参与抽题的来源；默认取全局放行开关（#284），仅测试需要显式传入 */
  excludedOrigins?: ReadonlySet<QuestionOrigin>;
  rng?: () => number;
}

const NO_EXCLUDE: ReadonlySet<number> = new Set();

/**
 * 题库指纹：排序后的「题号:版本」列表 + `scale_version` + 不参与抽题的来源
 * 的短哈希（FNV-1a 32 位 → base36）。
 * 题库一改（加题 / 题面版本自增 / 换量表版本 / 放行状态变化）指纹就变，
 * 卷子自动重派，不会拿旧卷子配新题库。
 */
export function poolFingerprint(
  questions: readonly { index: number; version: number }[],
  scaleVersion: string,
  excludedOrigins: ReadonlySet<QuestionOrigin> = SAMPLING_EXCLUDED_ORIGINS
): string {
  const exclusions = [...excludedOrigins].sort().join(",");
  const canonical =
    questions
      .slice()
      .sort((a, b) => a.index - b.index)
      .map((q) => `${q.index}:${q.version}`)
      .join(",") + `|${scaleVersion}|exclude:${exclusions}`;
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

/** 派生种子：把「谁 + 哪套量表 + 哪个题库指纹 + 第几轮」压成一个 32 位整数 */
export function deriveDrawSeed(
  userId: number,
  assessmentId: number,
  fingerprint: string,
  attemptNo: number
): number {
  const canonical = `${userId}:${assessmentId}:${fingerprint}:${attemptNo}`;
  let hash = 2166136261;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

/** mulberry32：种子 → [0,1) 均匀伪随机序列（确定性，跨平台同种子同序列） */
export function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Fisher-Yates 洗牌（rng 可注入，同种子同顺序） */
function shuffle<T>(list: readonly T[], rng: () => number): T[] {
  const result = [...list];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(rng() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

interface SelectDimensionResult {
  picked: DrawItem[];
  warnings: string[];
}

function isOfficial(item: DrawItem): boolean {
  return item.origin !== "cn-original";
}

/** 题目是否进入抽题池（#284：未验证来源整体排除；题库本身不删题） */
function isEligible(item: DrawItem, excludedOrigins: ReadonlySet<QuestionOrigin>): boolean {
  return !excludedOrigins.has(item.origin);
}

/** 整维（已锁定题 + 本次补抽）允许的官方题数区间：两侧各不少于 2 题 */
function officialBand(total: number): [number, number] {
  const low = Math.max(0, total - 3);
  return [low, Math.max(low, Math.min(total, total - 2))];
}

interface SelectDimensionOptions {
  pool: readonly DrawItem[];
  /** 本次要补抽的题数 */
  count: number;
  rng: () => number;
  excludeIndexes: ReadonlySet<number>;
  groupOf: ReadonlyMap<number, number>;
  /** 前面维度已占用的近重复组；本维抽中的组要写回，所以不是只读集合 */
  usedGroups: Set<number>;
  /** 本维已锁定的题（在途草稿的已答题）：配比按「整维 = 已答 + 补抽」结算，这些题计入配额 */
  prefilled?: readonly DrawItem[];
}

/**
 * 单维度抽 `count` 题，按降级阶梯逐级放宽（来源配比 → 排除集 → 近重复组）：
 * 每级先试「严格来源配比」，配比满足不了才「来源不限只凑数」；只有总数不够才降下一级。
 * 每维 20 题排除 5 题后仍有 15 题，正常题库（校验通过 `validateAssessmentSeed`）走不到降级。
 */
function selectDimension(options: SelectDimensionOptions): SelectDimensionResult {
  const { pool, count, rng, excludeIndexes, groupOf, usedGroups } = options;
  const prefilled = options.prefilled ?? [];
  const warnings: string[] = [];

  // 配比目标是「整维」口径：在途草稿的已答题来源分布改不了，补抽只凑差额，凑不平就记 warning。
  // 池子里没有可抽的原创题时（#284 回退，或本量表本来就只用官方题），配比规则不适用：
  // 整维都从官方题里抽，但仍走排除集 / 近重复组的同一套阶梯。
  const total = count + prefilled.length;
  const mixEnabled = pool.some((item) => item.origin === "cn-original");
  const [bandLow, bandHigh] = mixEnabled ? officialBand(total) : ([total, total] as const);
  const officialDone = prefilled.filter(isOfficial).length;
  const mixOfficialCount = mixEnabled
    ? Math.max(0, Math.min(count, (rng() < 0.5 ? bandLow : bandHigh) - officialDone))
    : count;

  const pick = (
    candidates: readonly DrawItem[],
    enforceMix: boolean,
    enforceGroups: boolean
  ): DrawItem[] | null => {
    // 近重复组在**同一次抽取内**也要唯一：同组的题常常同属一维（如 C 型里的 18 / 56 / 60），
    // 只靠维度间的 usedGroups 过滤挡不住「一维抽 5 题里收下同组两题」。
    const takenGroups = new Set<number>(enforceGroups ? usedGroups : []);
    const available = enforceGroups
      ? candidates.filter((item) => {
          const group = groupOf.get(item.index);
          return group === undefined || !takenGroups.has(group);
        })
      : [...candidates];
    if (available.length < count) return null;
    const shuffleAvailable = (list: DrawItem[]) =>
      shuffle(list, rng).filter((item) => {
        const group = groupOf.get(item.index);
        if (group === undefined) return true;
        if (takenGroups.has(group)) return false;
        takenGroups.add(group);
        return true;
      });
    const official = shuffleAvailable(
      available.filter((item) => item.origin !== "cn-original")
    );
    const original = shuffleAvailable(
      available.filter((item) => item.origin === "cn-original")
    );
    const picked: DrawItem[] = [];
    if (enforceMix) {
      // 严格配比：官方题必须凑满 mixOfficialCount、原创题补足其余，任一侧不足即失败（交给下一级放宽）
      const officialCount = Math.min(mixOfficialCount, count);
      const originalCount = count - officialCount;
      if (official.length < officialCount || original.length < originalCount) return null;
      picked.push(...official.slice(0, officialCount), ...original.slice(0, originalCount));
    } else {
      // 放宽配比：官方优先到配比目标，不足用原创补，还不够再补官方剩余
      const officialCount = Math.min(mixOfficialCount, count);
      picked.push(...official.slice(0, officialCount));
      picked.push(...original.slice(0, count - picked.length));
      if (picked.length < count) picked.push(...official.slice(officialCount));
      if (picked.length < count) return null;
    }
    return picked.slice(0, count);
  };

  // 严格配比只保证「本次补抽」达标；在途草稿的已答题可能把整维官方题数挤出区间，这里补一条 warning。
  const finish = (chosen: DrawItem[]): SelectDimensionResult => {
    if (prefilled.length === 0) return { picked: chosen, warnings };
    const officialTotal = officialDone + chosen.filter(isOfficial).length;
    if (officialTotal < bandLow || officialTotal > bandHigh) {
      warnings.push(
        `来源配比放宽：整维官方题 ${officialTotal} 题，超出 ${bandLow}-${bandHigh} 区间（在途草稿已答题已锁死）`
      );
    }
    return { picked: chosen, warnings };
  };

  // 阶梯各级放宽的是「上轮用过」的排除集，**本卷已锁定的题永不放宽**：同一份卷子里出现重复题号
  // 会让计分引擎判定题目序号重复，在途草稿兼容路径（prefilled = 已答题）尤其要挡死。
  const lockedInPaper = new Set(prefilled.map((item) => item.index));
  const open = pool.filter((item) => !lockedInPaper.has(item.index));

  // 1) 排除集 + 来源配比 + 近重复组全严格
  const base = open.filter((item) => !excludeIndexes.has(item.index));
  let result = pick(base, true, true);
  if (result) return finish(result);

  // 2) 放宽来源配比（排除集与近重复组仍严格）；池里没有原创题时配比本就不适用，不报这条
  if (mixEnabled) warnings.push("来源配比放宽：该维度无法按官方 2-3 + 原创 2-3 抽取");
  result = pick(base, false, true);
  if (result) return finish(result);

  // 3) 放宽排除集（来源配比与近重复组严格）
  warnings.push("排除集放宽：该维度排除上轮题目后不足每维题数");
  result = pick(open, true, true);
  if (result) return finish(result);
  result = pick(open, false, true);
  if (result) return finish(result);

  // 4) 放宽近重复组（来源配比尽量满足）
  warnings.push("近重复组放宽：该维度满足其余约束时无可选题目");
  result = pick(open, true, false);
  if (result) return finish(result);
  result = pick(open, false, false);
  if (result) return finish(result);

  // 池子本身不足每维题数：有多少抽多少，绝不让作答 500
  warnings.push(`池子不足：该维度仅 ${open.length} 题，无法抽满 ${count} 题`);
  return finish([...open]);
}

/** 洗牌后按「最长队列优先」交错排列，避免 3 题及以上连续同维度（平衡题库下必然修得动） */
function interleave(items: readonly DrawItem[]): DrawItem[] {
  const queues = new Map<string, DrawItem[]>();
  for (const item of items) {
    const queue = queues.get(item.dimension);
    if (queue) queue.push(item);
    else queues.set(item.dimension, [item]);
  }
  const dims = [...queues.keys()];
  const result: DrawItem[] = [];
  let lastDim = "";
  let run = 0;
  for (;;) {
    let best: string | undefined;
    for (const dim of dims) {
      const queue = queues.get(dim)!;
      if (queue.length === 0) continue;
      if (dim === lastDim && run >= 2) continue;
      if (!best || queue.length > queues.get(best)!.length) best = dim;
    }
    // 其余维度全空才允许连抽同维度（如某维题数远超其余维度之和），修不动就接受
    if (!best) best = dims.find((dim) => queues.get(dim)!.length > 0);
    if (!best) break;
    const queue = queues.get(best)!;
    result.push(queue.shift()!);
    if (best === lastDim) run += 1;
    else {
      lastDim = best;
      run = 1;
    }
  }
  return result;
}

/** 分层抽题主入口：每维 `perDimension` 题 → 拼齐 → 整体洗牌 → 顺序修整 */
export function drawItems(options: DrawOptions): DrawResult {
  const rng = options.rng ?? Math.random;
  const exclude = options.excludeIndexes ?? NO_EXCLUDE;
  const excludedOrigins = options.excludedOrigins ?? SAMPLING_EXCLUDED_ORIGINS;
  const groups = options.nearDuplicateGroups ?? NEAR_DUPLICATE_GROUPS;
  const groupOf = new Map<number, number>();
  groups.forEach((group, groupId) => {
    for (const index of group) groupOf.set(index, groupId);
  });

  const byDimension = new Map<string, DrawItem[]>();
  for (const item of options.items) {
    if (!isEligible(item, excludedOrigins)) continue;
    const list = byDimension.get(item.dimension);
    if (list) list.push(item);
    else byDimension.set(item.dimension, [item]);
  }

  const picked: DrawItem[] = [];
  const usedGroups = new Set<number>();
  const warnings: string[] = [];
  for (const dimension of options.dimensions) {
    const result = selectDimension({
      pool: byDimension.get(dimension.key) ?? [],
      count: options.perDimension,
      rng,
      excludeIndexes: exclude,
      groupOf,
      usedGroups,
    });
    warnings.push(...result.warnings);
    for (const item of result.picked) {
      picked.push(item);
      const group = groupOf.get(item.index);
      if (group !== undefined) usedGroups.add(group);
    }
  }

  const shuffled = shuffle(picked, rng);
  const ordered = interleave(shuffled);
  return { indexes: ordered.map((item) => item.index), warnings };
}

/** `assessment_results.items_json` 的快照形态：`indexes` 按呈现顺序 */
export interface ItemsSnapshot {
  v: 1;
  pool: string;
  indexes: number[];
}

/**
 * 解析抽题快照（全项目唯一的 `items_json` 解析点，调用方不要自己再 JSON.parse）。
 * 容忍空值、空数组与脏 JSON：解析失败或索引为空一律返回 null——**旧数据读作「全库即本轮」**，
 * 由调用方（`planAttempt`）走「已答 ∪ 确定性补抽」的兼容路径。
 */
export function parseItemsSnapshot(raw: string | null | undefined): ItemsSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as { v?: unknown; pool?: unknown; indexes?: unknown };
  if (candidate.v !== 1 || typeof candidate.pool !== "string" || !candidate.pool) return null;
  if (!Array.isArray(candidate.indexes)) return null;
  const seen = new Set<number>();
  const indexes = candidate.indexes.filter(
    (index): index is number => {
      // 只认正整数题号，且**同卷去重**：脏快照里的重复题号会让计分引擎判定「题目序号重复」而抛错
      if (typeof index !== "number" || !Number.isInteger(index) || index < 1) return false;
      if (seen.has(index)) return false;
      seen.add(index);
      return true;
    }
  );
  if (indexes.length === 0) return null;
  return { v: 1, pool: candidate.pool, indexes };
}

/** 本轮题号口径（路由共用）：一次算出，四个路由对同一份草稿算出的进度/缺答/计分集合互相一致 */
export interface AttemptPlan {
  /** 本轮题号，按呈现顺序 */
  indexes: number[];
  /** 当前题库指纹（快照里 `pool` 字段的取值） */
  poolFingerprint: string;
  /** 抽题降级 warning（路由记到服务端日志即可，不随响应下发） */
  warnings: string[];
}

export interface PlanAttemptOptions {
  /** 题库行投影（含指纹用 version） */
  pool: readonly PoolItem[];
  dimensions: readonly { key: string }[];
  scaleVersion: string;
  /** `assessments.items_per_attempt`：0 = 全量作答（题库即本轮） */
  itemsPerAttempt: number;
  userId: number;
  assessmentId: number;
  /** 该用户该量表 completed 行数 + 1（不新增列，由调用方数出来） */
  attemptNo: number;
  /** 上一轮完成结果用过的题号（排除集）；无上轮结果传空集 */
  excludedIndexes?: ReadonlySet<number>;
  /** 草稿里已作答题号（未过滤的原始键集合）；无草稿/空草稿传空集 */
  answeredIndexes?: ReadonlySet<number>;
  /** 草稿 `items_json` 原文 */
  snapshotRaw?: string | null;
  /** 不参与抽题的来源；默认取全局放行开关（#284），仅测试需要显式传入 */
  excludedOrigins?: ReadonlySet<QuestionOrigin>;
  rng?: () => number;
}

/**
 * 规划本轮卷子，三种来源按优先级：
 *
 * 1. **草稿已有有效快照**（指纹与当前题库一致、题号都在题库内）→ 直接用快照（续答口径）；
 * 2. **在途草稿兼容**（快照无效但已有作答，如升级前建立的草稿）→ 已作答题号 ∪ 确定性补抽到每维
 *    `perDimension` 题——已答的题一道不作废，计分按各维实际已答数折算；
 * 3. **全新一轮** → `drawItems` 按排除集分层抽题。
 *
 * 抽题种子由 `deriveDrawSeed` 从 `userId + assessmentId + 指纹 + attemptNo` 派生：
 * 同一轮内任何路由各自重算都得同一张卷子，`GET /start` 因此保持只读。
 */
export function planAttempt(options: PlanAttemptOptions): AttemptPlan {
  const excludedOrigins = options.excludedOrigins ?? SAMPLING_EXCLUDED_ORIGINS;
  const fingerprint = poolFingerprint(options.pool, options.scaleVersion, excludedOrigins);
  // 只让「已放行来源」进卷：题库本身不删题，历史结果与种子校验仍按全量口径
  const eligible = options.pool.filter((item) => isEligible(item, excludedOrigins));
  const fullBank = options.itemsPerAttempt <= 0;
  if (fullBank) {
    return { indexes: eligible.map((item) => item.index), poolFingerprint: fingerprint, warnings: [] };
  }

  const perDimension = Math.floor(options.itemsPerAttempt / options.dimensions.length);
  const poolSet = new Set(eligible.map((item) => item.index));

  // 1) 快照路径：指纹一致 + 题号都在**可抽题池**内才可信
  //    （题库改版或放行状态变化后旧快照作废，走兼容路径）
  const snapshot = parseItemsSnapshot(options.snapshotRaw);
  if (snapshot && snapshot.pool === fingerprint && snapshot.indexes.every((index) => poolSet.has(index))) {
    return { indexes: snapshot.indexes, poolFingerprint: fingerprint, warnings: [] };
  }

  const rng =
    options.rng ??
    mulberry32(deriveDrawSeed(options.userId, options.assessmentId, fingerprint, options.attemptNo));

  // 2) 在途草稿兼容：已答（且已放行）∪ 补抽到每维 perDimension
  //    #284 回退会把草稿里原创题的作答移出本轮口径，缺口用官方题补上
  const answered = options.answeredIndexes ?? NO_EXCLUDE;
  const answeredInPool = new Set(eligible.filter((item) => answered.has(item.index)).map((item) => item.index));
  if (answeredInPool.size > 0) {
    const picked: DrawItem[] = [];
    const usedGroups = new Set<number>();
    const warnings: string[] = [];
    const groupOf = new Map<number, number>();
    NEAR_DUPLICATE_GROUPS.forEach((group, groupId) => {
      for (const index of group) groupOf.set(index, groupId);
    });
    const byDimension = new Map<string, DrawItem[]>();
    for (const item of eligible) {
      const list = byDimension.get(item.dimension);
      if (list) list.push(item);
      else byDimension.set(item.dimension, [item]);
    }
    for (const dimension of options.dimensions) {
      const pool = byDimension.get(dimension.key) ?? [];
      const fixed = pool
        .filter((item) => answeredInPool.has(item.index))
        .sort((a, b) => a.index - b.index);
      for (const item of fixed) {
        picked.push(item);
        const group = groupOf.get(item.index);
        if (group !== undefined) usedGroups.add(group);
      }
      const need = perDimension - fixed.length;
      if (need <= 0) continue;
      const result = selectDimension({
        pool,
        count: need,
        rng,
        excludeIndexes: answeredInPool,
        groupOf,
        usedGroups,
        prefilled: fixed,
      });
      warnings.push(...result.warnings);
      for (const item of result.picked) {
        picked.push(item);
        const group = groupOf.get(item.index);
        if (group !== undefined) usedGroups.add(group);
      }
    }
    // 兼容路径不重新洗牌（已答题的相对位置保持稳定，续答体验不跳题），
    // 但仍要走与正常抽题同一个**顺序修整**：按维度交错排列，避免出现 3 题及以上连续同维度
    // （连续同维会让学生猜出题目归属，等于泄露维度）。
    const ordered = interleave(picked);
    return { indexes: ordered.map((item) => item.index), poolFingerprint: fingerprint, warnings };
  }

  // 3) 全新一轮：按排除集分层抽题
  const draw = drawItems({
    items: eligible,
    dimensions: options.dimensions,
    perDimension,
    excludeIndexes: options.excludedIndexes ?? NO_EXCLUDE,
    excludedOrigins,
    rng,
  });
  return { indexes: draw.indexes, poolFingerprint: fingerprint, warnings: draw.warnings };
}

/** 序列化抽题快照（写草稿与完成记录用；全项目唯一的写点，与 `parseItemsSnapshot` 成对） */
export function buildItemsSnapshot(indexes: readonly number[], poolFingerprint: string): string {
  return JSON.stringify({ v: 1, pool: poolFingerprint, indexes: [...indexes] } satisfies ItemsSnapshot);
}
