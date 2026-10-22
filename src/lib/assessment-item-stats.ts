/**
 * 题目质量回收的统计口径（#285）：只读、纯函数，CLI 与单测共用。
 *
 * 数据来源只有一处：`assessment_results` 里**完成记录**的 `items_json` 快照 + `answers_json`。
 * 快照让「哪 30 题」可复原，因此逐题统计不再要求同一套题在所有被试间可比：
 * - 单题样本 = 所有抽到该题并作答的完成记录；
 * - `r_it` = 该题与**同一张卷子同维度其余题为总分**的相关（不是整库固定 5 题）；
 * - α 按「同一维度的 5 题组合」分组（同一张卷子的题集才可比），而不是按人算；
 * - 含反向计分题的量表（IPIP 25 道反向题）先按 `6 − 原始值` 转成计分方向，再做全部统计；
 *   CSV 的 `reverse_scored` 列保留原始方向，避免把反向题误判成低区分度题。
 *
 * 阈值与处置（见 docs/assessment-validation.md §7，改这里要同步改文档）：
 * - 单题 n < 50：样本不足，不给结论；
 * - 均值 < 1.6 / > 4.4：地板 / 天花板题 → 淘汰；
 * - r_it < 0.30（或无法计算）：区分度不足 → 淘汰；
 * - 某个同维 5 题组合的 α < 0.55：复查该维度题池（不是自动淘汰）；
 * - 官方题与原创题同维均值差 > 0.5：整批原创题复评。
 *
 * 本层只处理聚合数字，不接触 user_id、姓名、学号；历史结果即使题目已退役也照常统计
 * （退役只影响后续抽题，不影响快照解释，见 `assessment-data.ts` 的 `RETIRED_QUESTIONS`）。
 * `mean` / `sd` / `r_it` / α 都是**计分方向**上的值；反向题的原始作答在进入统计前已转换。
 */

/**
 * 本文件刻意保持**零 import**：`scripts/assessment-item-stats.mjs` 用 Node 的 TS 类型剥离直接加载它，
 * 而 Node ESM 不支持无扩展名的相对导入。统计函数与 `assessment-validation.ts` 同口径，
 * 单测会逐值对照两份实现，避免口径漂移。
 */

/** 题目来源（与 `assessment-data.ts` 的同名联合类型结构一致；此处不 import，保持叶子模块） */
export type ItemOrigin = "onet-mini" | "onet-sf" | "cn-original" | "ipip";

// ── 判定阈值（#285 验收线；与 #227 的 alpha ≥ 0.7 / CITC ≥ 0.3 是两套口径，不可互相替代）──

/** 单题累计作答门槛：低于此值噪声大于信号，脚本标注「样本不足」而不给结论 */
export const ITEM_MIN_SAMPLE = 50;
/** 单题均值下限：低于此值为地板题 */
export const ITEM_MEAN_FLOOR = 1.6;
/** 单题均值上限：高于此值为天花板题 */
export const ITEM_MEAN_CEILING = 4.4;
/** 校正题目-总分相关下限：低于此值淘汰 */
export const ITEM_RIT_MIN = 0.3;
/** 同维 5 题组合的 α 复查线 */
export const DIMENSION_ALPHA_MIN = 0.55;
/**
 * 计算卷面组合 α 的最少作答人数。
 *
 * 2 是数学下限；抽样口径下同一 5 题组合往往只有很少人作答，报告同时输出组合总数与
 * 可计算组合数，审阅时据此判断 α 的可信度。单题 `r_it` 才是主要淘汰依据。
 */
export const ALPHA_FORM_MIN_SAMPLE = 2;
/** 官方题与原创题同维均值差的上限 */
export const SOURCE_MEAN_GAP_MAX = 0.5;

export type ItemVerdict = "keep" | "retire" | "insufficient";
export type ItemFlag =
  | "sample-too-small"
  | "floor"
  | "ceiling"
  | "low-rit"
  | "no-variation"
  | "rit-uncomputable";
export type DimensionVerdict = "ok" | "review" | "insufficient" | "not-applicable";
export type SourceVerdict = "ok" | "review-original" | "insufficient" | "not-applicable";
export type SamplingStatus = "active" | "origin-gated" | "retired";

/** 题库行的统计投影（题面只用于 CSV 定位，不参与计算） */
export interface ItemQuestion {
  index: number;
  dimension: string;
  origin: ItemOrigin;
  version: number;
  prompt: string;
  /**
   * 反向计分题：统计前按 `6 − 原始值` 转换（与 `assessment-scoring.ts` 的 `REVERSE_FACTOR` 一致）。
   * IPIP 五大量表含 25 道反向题；不转换会把它们误判成低区分度题。
   */
  reverseScored?: boolean;
}

/** 一次完成记录的快照投影：本轮题号 + 有效作答（1–5） */
export interface AttemptRecord {
  /** 本轮题号（`items_json.indexes`，呈现顺序不影响统计） */
  indexes: readonly number[];
  /** 题号 → 1–5 作答；非整数 / 越界值在分析时忽略 */
  answers: Readonly<Record<number, number>>;
}

export interface ItemStat {
  index: number;
  dimension: string;
  origin: ItemOrigin;
  /** 原始题库的方向标记；CSV 用它区分反向题 */
  reverseScored: boolean;
  version: number;
  prompt: string;
  /** 该题累计作答次数 */
  n: number;
  mean: number | null;
  /** 样本标准差（ddof = 1）；n < 2 时为 null */
  sd: number | null;
  /** 校正题目-总分相关（单题 vs 同卷同维其余题之和） */
  rit: number | null;
  verdict: ItemVerdict;
  flags: ItemFlag[];
  samplingStatus: SamplingStatus;
  /** 给人看的中文说明（CSV 的 note 列） */
  note: string;
}

export interface DimensionStat {
  key: string;
  label: string;
  /** 题库里该维题数（含已退役、未放行） */
  itemCount: number;
  /** 达到单题样本门槛的题数 */
  analyzedItems: number;
  /** 各可计算卷面组合 α 按人数加权的均值 */
  alpha: number | null;
  /** 可计算卷面组合里最低的 α */
  alphaMin: number | null;
  /** 出现过的同维 5 题组合数（含只有 1 人的组合） */
  alphaFormTotal: number;
  /** α 可计算的组合数 */
  alphaForms: number;
  /** α 低于复查线的组合数 */
  alphaFormsBelow: number;
  verdict: DimensionVerdict;
  officialMean: number | null;
  originalMean: number | null;
  /** 官方题均值 − 原创题均值（绝对值超过 0.5 触发整批复评） */
  sourceGap: number | null;
  sourceVerdict: SourceVerdict;
}

export interface ItemQualityReport {
  items: ItemStat[];
  dimensions: DimensionStat[];
  /** 参与统计的有效完成记录数 */
  attemptCount: number;
  /** 题号全部无效 / 空快照等被跳过的记录数（由调用方统计） */
  skippedAttemptCount: number;
  /** 本次分析使用的放行门与退役集（写进报告，便于复核口径） */
  excludedOrigins: ItemOrigin[];
  retiredIndexes: number[];
}

export interface AnalyzeOptions {
  questions: readonly ItemQuestion[];
  attempts: readonly AttemptRecord[];
  dimensions: readonly { key: string; label: string }[];
  /** 不进入抽题池的来源（#284）；用于给逐题行标注状态 */
  excludedOrigins?: ReadonlySet<ItemOrigin>;
  /** 已退役题号（#285）；历史作答仍然纳入统计 */
  retiredIndexes?: ReadonlySet<number>;
  /** 调用方已跳过的记录数（无快照等），只透传到报告 */
  skippedAttemptCount?: number;
}

const ORIGIN_ORDER: Record<ItemOrigin, number> = {
  "onet-mini": 0,
  "onet-sf": 1,
  "cn-original": 2,
  ipip: 3,
};

function mean(values: readonly number[]): number {
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

/** 样本方差（ddof = 1，与 R 的 var() 一致） */
function variance(values: readonly number[]): number {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return values.reduce((acc, value) => acc + (value - avg) ** 2, 0) / (values.length - 1);
}

/** 样本标准差（ddof = 1，与 SPSS / R 的 sd() 一致）；少于两个观测返回 null */
function sampleSd(values: readonly number[]): number | null {
  return values.length < 2 ? null : Math.sqrt(variance(values));
}

/** 皮尔逊积差相关（与 `assessment-validation.ts` 同口径，见文件头说明） */
function pearsonCorrelation(xs: readonly number[], ys: readonly number[]): number | null {
  if (xs.length !== ys.length) return null;
  const n = xs.length;
  if (n < 2) return null;
  const leftVariance = variance(xs);
  const rightVariance = variance(ys);
  if (leftVariance <= 0 || rightVariance <= 0) return null;
  const leftMean = mean(xs);
  const rightMean = mean(ys);
  let covariance = 0;
  for (let index = 0; index < n; index += 1) {
    covariance += (xs[index] - leftMean) * (ys[index] - rightMean);
  }
  const r = covariance / (n - 1) / Math.sqrt(leftVariance * rightVariance);
  return Math.max(-1, Math.min(1, r));
}

/** Cronbach's α（与 `assessment-validation.ts` 同口径，见文件头说明）；不可计算返回 null */
function cronbachAlpha(rows: readonly (readonly number[])[]): number | null {
  const columns = rows.length > 0 ? rows[0].length : 0;
  if (columns < 2) return null;
  const usable = rows.filter(
    (row) =>
      Array.isArray(row) &&
      row.length === columns &&
      row.every((value) => Number.isFinite(value))
  );
  if (usable.length < 2) return null;
  const totalScores = usable.map((row) => row.reduce((sum, value) => sum + value, 0));
  const totalVariance = variance(totalScores);
  if (totalVariance <= 0) return null;
  let itemVarianceSum = 0;
  for (let column = 0; column < columns; column += 1) {
    itemVarianceSum += variance(usable.map((row) => row[column]));
  }
  const alpha = (columns / (columns - 1)) * (1 - itemVarianceSum / totalVariance);
  return Math.min(1, alpha);
}

/**
 * 计分方向转换：反向题按 `6 − 值` 取反（`LIKERT_MIN + LIKERT_MAX`，与 `assessment-scoring.ts`
 * 的 `REVERSE_FACTOR` 同口径）；本文件保持零 import，故本地实现。
 */
function scoredValue(question: ItemQuestion, raw: number): number {
  return question.reverseScored === true ? 6 - raw : raw;
}

/** 仅保留 1–5 的整数作答；完成记录理论上只有合法值，这里对脏数据再兜一层 */
function sanitizeAnswers(raw: Readonly<Record<number, number>>): Map<number, number> {
  const answers = new Map<number, number>();
  for (const [key, value] of Object.entries(raw)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 1) continue;
    if (typeof value !== "number" || !Number.isInteger(value) || value < 1 || value > 5) continue;
    answers.set(index, value);
  }
  return answers;
}

/**
 * 单题判定（纯查表，便于用固定输入锁阈值）。
 *
 * 样本不足优先于其它指标：n < 50 时即使均值极端也不给「淘汰」结论——那可能只是小样本噪声。
 */
export function classifyItem(input: {
  n: number;
  mean: number | null;
  sd: number | null;
  rit: number | null;
}): { verdict: ItemVerdict; flags: ItemFlag[] } {
  if (input.n < ITEM_MIN_SAMPLE) {
    return { verdict: "insufficient", flags: ["sample-too-small"] };
  }
  const flags: ItemFlag[] = [];
  if (input.mean !== null && input.mean < ITEM_MEAN_FLOOR) flags.push("floor");
  if (input.mean !== null && input.mean > ITEM_MEAN_CEILING) flags.push("ceiling");
  if (input.sd === 0) flags.push("no-variation");
  if (input.rit === null) flags.push("rit-uncomputable");
  else if (input.rit < ITEM_RIT_MIN) flags.push("low-rit");
  return { verdict: flags.length === 0 ? "keep" : "retire", flags };
}

function itemNote(stat: Pick<ItemStat, "n" | "mean" | "rit" | "flags">): string {
  const parts: string[] = [];
  if (stat.flags.includes("sample-too-small")) {
    parts.push(`样本不足：n=${stat.n}，未达 ${ITEM_MIN_SAMPLE} 次，不作判定`);
  }
  if (stat.flags.includes("floor")) {
    parts.push(`地板题：均值 ${(stat.mean ?? 0).toFixed(2)} < ${ITEM_MEAN_FLOOR.toFixed(2)}`);
  }
  if (stat.flags.includes("ceiling")) {
    parts.push(`天花板题：均值 ${(stat.mean ?? 0).toFixed(2)} > ${ITEM_MEAN_CEILING.toFixed(2)}`);
  }
  if (stat.flags.includes("no-variation")) parts.push("作答无变异");
  if (stat.flags.includes("low-rit")) {
    parts.push(`区分度不足：r_it ${(stat.rit ?? 0).toFixed(2)} < ${ITEM_RIT_MIN.toFixed(2)}`);
  } else if (stat.flags.includes("rit-uncomputable")) {
    parts.push("r_it 无法计算");
  }
  return parts.length > 0 ? parts.join("；") : "达标";
}

function samplingStatusOf(
  question: ItemQuestion,
  excludedOrigins: ReadonlySet<ItemOrigin>,
  retiredIndexes: ReadonlySet<number>
): SamplingStatus {
  if (retiredIndexes.has(question.index)) return "retired";
  if (excludedOrigins.has(question.origin)) return "origin-gated";
  return "active";
}

/** 同维卷面组合的键：题号排序后拼接，呈现顺序不同也视为同一组合 */
function formKey(indexes: readonly number[]): string {
  return [...indexes].sort((a, b) => a - b).join(":");
}

/**
 * 逐题 + 逐维统计。
 *
 * 脏数据的处理：
 * - 快照里有题库外的题号、重复题号：去重并丢弃题库外的；
 * - 作答值非 1–5 整数：丢弃该题作答；
 * - 没有有效题目的记录：计入 `attemptCount` 之外的跳过数由调用方给。
 */
export function analyzeItemQuality(options: AnalyzeOptions): ItemQualityReport {
  const excludedOrigins = options.excludedOrigins ?? new Set<ItemOrigin>();
  const retiredIndexes = options.retiredIndexes ?? new Set<number>();
  const byIndex = new Map<number, ItemQuestion>();
  for (const question of options.questions) {
    if (!Number.isInteger(question.index) || question.index < 1) continue;
    byIndex.set(question.index, question);
  }
  const dimensionOrder = options.dimensions.map((dimension) => dimension.key);
  const dimensionRank = new Map(dimensionOrder.map((key, index) => [key, index]));

  const itemValues = new Map<number, number[]>();
  /** r_it 的配对值：只收「同维至少还有一题作答」的记录，与 itemRestSums 等长 */
  const itemRitValues = new Map<number, number[]>();
  const itemRestSums = new Map<number, number[]>();
  /** form key → 完整作答的行（每行按题号升序） */
  const formRows = new Map<string, number[][]>();
  /** dimension key → form keys */
  const formsByDimension = new Map<string, Set<string>>();

  let attemptCount = 0;
  for (const attempt of options.attempts) {
    const answers = sanitizeAnswers(attempt.answers);
    const seenIndexes = new Set<number>();
    const round: ItemQuestion[] = [];
    for (const index of attempt.indexes) {
      if (!Number.isInteger(index) || seenIndexes.has(index)) continue;
      const question = byIndex.get(index);
      if (!question) continue;
      seenIndexes.add(index);
      round.push(question);
    }
    if (round.length === 0) continue;
    attemptCount += 1;

    const byDimension = new Map<string, ItemQuestion[]>();
    for (const question of round) {
      const list = byDimension.get(question.dimension);
      if (list) list.push(question);
      else byDimension.set(question.dimension, [question]);
    }

    for (const [dimension, questions] of byDimension) {
      const sorted = [...questions].sort((a, b) => a.index - b.index);
      const key = formKey(sorted.map((question) => question.index));
      let forms = formsByDimension.get(dimension);
      if (!forms) {
        forms = new Set();
        formsByDimension.set(dimension, forms);
      }
      forms.add(key);

      const answered = sorted.filter((question) => answers.has(question.index));
      // 单题均值 / 标准差按所有有效作答算；r_it 才需要「同卷同维其余题」，至少两题才有配对。
      // 反向题先转换成计分方向（6 − 原始值），否则 IPIP 的 25 道反向题会被误判为负区分度。
      for (const question of answered) {
        const value = scoredValue(question, answers.get(question.index)!);
        const values = itemValues.get(question.index);
        if (values) values.push(value);
        else itemValues.set(question.index, [value]);
      }
      if (answered.length >= 2) {
        const total = answered.reduce(
          (sum, question) => sum + scoredValue(question, answers.get(question.index)!),
          0
        );
        for (const question of answered) {
          const value = scoredValue(question, answers.get(question.index)!);
          const ritValues = itemRitValues.get(question.index);
          if (ritValues) ritValues.push(value);
          else itemRitValues.set(question.index, [value]);
          const rests = itemRestSums.get(question.index);
          const rest = total - value;
          if (rests) rests.push(rest);
          else itemRestSums.set(question.index, [rest]);
        }
      }

      // α 只用于「完整作答」的行：缺答的行放进 α 会让列均值和协方差不可比
      if (sorted.length >= 2 && answered.length === sorted.length) {
        const row = sorted.map((question) => scoredValue(question, answers.get(question.index)!));
        const rows = formRows.get(key);
        if (rows) rows.push(row);
        else formRows.set(key, [row]);
      }
    }
  }

  const items: ItemStat[] = [...byIndex.values()]
    .filter((question) => dimensionRank.has(question.dimension))
    .map((question) => {
      const values = itemValues.get(question.index) ?? [];
      const ritValues = itemRitValues.get(question.index) ?? [];
      const rests = itemRestSums.get(question.index) ?? [];
      const avg = values.length > 0 ? mean(values) : null;
      const sd = sampleSd(values);
      const rit = ritValues.length >= 2 ? pearsonCorrelation(ritValues, rests) : null;
      const classification = classifyItem({ n: values.length, mean: avg, sd, rit });
      const stat: ItemStat = {
        index: question.index,
        dimension: question.dimension,
        origin: question.origin,
        reverseScored: question.reverseScored === true,
        version: question.version,
        prompt: question.prompt,
        n: values.length,
        mean: avg,
        sd,
        rit,
        verdict: classification.verdict,
        flags: classification.flags,
        samplingStatus: samplingStatusOf(question, excludedOrigins, retiredIndexes),
        note: "",
      };
      stat.note = itemNote(stat);
      return stat;
    })
    .sort(
      (a, b) =>
        (dimensionRank.get(a.dimension) ?? 0) - (dimensionRank.get(b.dimension) ?? 0) ||
        ORIGIN_ORDER[a.origin] - ORIGIN_ORDER[b.origin] ||
        a.index - b.index
    );

  const itemsByDimension = new Map<string, ItemStat[]>();
  for (const item of items) {
    const list = itemsByDimension.get(item.dimension);
    if (list) list.push(item);
    else itemsByDimension.set(item.dimension, [item]);
  }

  const dimensions: DimensionStat[] = options.dimensions.map((dimension) => {
    const dimensionItems = itemsByDimension.get(dimension.key) ?? [];
    const forms = [...(formsByDimension.get(dimension.key) ?? new Set<string>())];
    const alphaSamples: { alpha: number; rows: number }[] = [];
    let alphaFormsBelow = 0;
    for (const key of forms) {
      const rows = formRows.get(key) ?? [];
      if (rows.length < ALPHA_FORM_MIN_SAMPLE) continue;
      const alpha = cronbachAlpha(rows);
      if (alpha === null) continue;
      alphaSamples.push({ alpha, rows: rows.length });
      if (alpha < DIMENSION_ALPHA_MIN) alphaFormsBelow += 1;
    }
    const totalRows = alphaSamples.reduce((sum, sample) => sum + sample.rows, 0);
    const alpha =
      alphaSamples.length > 0 && totalRows > 0
        ? alphaSamples.reduce((sum, sample) => sum + sample.alpha * sample.rows, 0) / totalRows
        : null;
    const alphaMin =
      alphaSamples.length > 0 ? Math.min(...alphaSamples.map((sample) => sample.alpha)) : null;

    const gated = dimensionItems.filter((item) => item.n >= ITEM_MIN_SAMPLE && item.mean !== null);
    const official = gated.filter((item) => item.origin.startsWith("onet-"));
    const original = gated.filter((item) => item.origin === "cn-original");
    const hasOriginalPool = dimensionItems.some((item) => item.origin === "cn-original");
    const hasOfficialPool = dimensionItems.some((item) => item.origin.startsWith("onet-"));
    const officialMean = official.length > 0 ? mean(official.map((item) => item.mean!)) : null;
    const originalMean = original.length > 0 ? mean(original.map((item) => item.mean!)) : null;
    const sourceGap =
      officialMean !== null && originalMean !== null ? officialMean - originalMean : null;

    let sourceVerdict: SourceVerdict;
    if (!hasOriginalPool) sourceVerdict = "not-applicable";
    else if (!hasOfficialPool || officialMean === null || originalMean === null) sourceVerdict = "insufficient";
    else sourceVerdict = Math.abs(sourceGap!) > SOURCE_MEAN_GAP_MAX ? "review-original" : "ok";

    let verdict: DimensionVerdict;
    if (dimensionItems.length < 2) verdict = "not-applicable";
    else if (alphaSamples.length === 0) verdict = "insufficient";
    else if (alphaFormsBelow > 0) verdict = "review";
    else verdict = "ok";

    return {
      key: dimension.key,
      label: dimension.label,
      itemCount: dimensionItems.length,
      analyzedItems: gated.length,
      alpha,
      alphaMin,
      alphaFormTotal: forms.length,
      alphaForms: alphaSamples.length,
      alphaFormsBelow,
      verdict,
      officialMean,
      originalMean,
      sourceGap,
      sourceVerdict,
    };
  });

  return {
    items,
    dimensions,
    attemptCount,
    skippedAttemptCount: options.skippedAttemptCount ?? 0,
    excludedOrigins: [...excludedOrigins].sort(),
    retiredIndexes: [...retiredIndexes].sort((a, b) => a - b),
  };
}

// ── CSV 输出 ──

const CSV_HEADERS = [
  "dimension",
  "dimension_label",
  "origin",
  "reverse_scored",
  "item_index",
  "version",
  "prompt",
  "n",
  "mean",
  "sd",
  "r_it",
  "item_verdict",
  "flags",
  "sampling_status",
  "dimension_alpha",
  "dimension_alpha_min",
  "dimension_alpha_form_total",
  "dimension_alpha_forms",
  "dimension_alpha_forms_below",
  "dimension_verdict",
  "official_mean",
  "original_mean",
  "source_gap",
  "source_verdict",
  "note",
] as const;

/** CSV 转义：含逗号 / 引号 / 换行的单元格整体加引号，内部引号翻倍 */
function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const text = String(value);
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function csvNumber(value: number | null | undefined, digits = 3): string {
  return value === null || value === undefined || !Number.isFinite(value) ? "" : value.toFixed(digits);
}

/**
 * 逐题 CSV：按「维度声明顺序 → 来源 → 题号」排序，来源天然分组。
 *
 * 每个题行重复同维的 α / 来源差异列，方便在 Excel 里按维度筛选；空值表示「不可计算」，
 * 不写 NaN，也不把样本不足的题伪装成 0。
 */
export function toItemCsv(report: ItemQualityReport): string {
  const dimensionOf = new Map(report.dimensions.map((dimension) => [dimension.key, dimension]));
  const lines: string[] = [CSV_HEADERS.join(",")];
  for (const item of report.items) {
    const dimension = dimensionOf.get(item.dimension);
    lines.push(
      [
        item.dimension,
        csvCell(dimension?.label ?? item.dimension),
        item.origin,
        item.reverseScored ? 1 : 0,
        item.index,
        item.version,
        csvCell(item.prompt),
        item.n,
        csvNumber(item.mean),
        csvNumber(item.sd),
        csvNumber(item.rit),
        item.verdict,
        item.flags.join("|"),
        item.samplingStatus,
        csvNumber(dimension?.alpha ?? null),
        csvNumber(dimension?.alphaMin ?? null),
        dimension?.alphaFormTotal ?? 0,
        dimension?.alphaForms ?? 0,
        dimension?.alphaFormsBelow ?? 0,
        dimension?.verdict ?? "insufficient",
        csvNumber(dimension?.officialMean ?? null),
        csvNumber(dimension?.originalMean ?? null),
        csvNumber(dimension?.sourceGap ?? null),
        dimension?.sourceVerdict ?? "not-applicable",
        csvCell(item.note),
      ].join(",")
    );
  }
  return `${lines.join("\n")}\n`;
}
