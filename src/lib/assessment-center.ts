import { MAX_RESULT_VERSIONS, formatResultTime } from "./assessment-flow";

/**
 * 测评中心页（#222）的纯逻辑：把 `GET /api/shared/assessment/results`（或 #291 列表接口的单套归一结果）
 * 归一成「未开始 / 进行中 / 已完成」三态视图，并算题目耗时估算与进度百分比。
 *
 * 页面只负责渲染，三态判定不写进组件，这样「三种状态分支」可以直接单测
 * （`assessment-center.test.ts`），也避免页面与服务端进度口径各算一遍。
 * 多量表的选择与清单行在 `assessment-list.ts`（#291），三态仍只在这里判定一次。
 */

/** 单题耗时估算（秒）：30 题 ≈ 4 分钟；只为给一个量级，不需要精确 */
export const ESTIMATE_SECONDS_PER_QUESTION = 8;

/** 最小耗时（分钟）：题量少时也显示「约 1 分钟」，避免出现「约 0 分钟」 */
export const MIN_ESTIMATED_MINUTES = 1;

export type AssessmentCenterStatus = "not-started" | "in-progress" | "completed";

/** 接口返回的字段都当作不可信：UI 只消费归一后的值 */
export interface AssessmentCenterPayload {
  assessment?: {
    /** 每次作答的题量（启用抽题时是抽题数，不是题库总量） */
    questionCount?: unknown;
    /** 题库总量（启用抽题时大于 `questionCount`；旧接口没有该字段） */
    poolSize?: unknown;
    enabled?: unknown;
    code?: unknown;
    name?: unknown;
  } | null;
  current?: { typeCode?: unknown; completedAt?: unknown } | null;
  /** 历史版本数组（results 接口）：有它时以数组长度为准 */
  history?: unknown;
  /**
   * 历史版本条数（#291 的 list 接口只下发计数、不下发整份历史）：
   * 没有 `history` 数组时用它算「结果版本」与是否撞上限。
   */
  historyCount?: unknown;
  inProgress?: { answered?: unknown; total?: unknown } | null;
}

export interface AssessmentCenterView {
  status: AssessmentCenterStatus;
  /** 本次测评题量（接口题库为空时为 0） */
  questionCount: number;
  /**
   * 题库总量（#283）：启用抽题时大于 `questionCount`，页面据此补「题库 N 题」；
   * 字段缺失或与每次题量冲突时收敛为 `questionCount`，页面不显示「从 N 题中抽取」。
   */
  poolSize: number;
  estimatedMinutes: number;
  /** 进行中已答题数 / 总题数（未进行中时为 0） */
  answered: number;
  total: number;
  /** 已答百分比（0–100 整数） */
  percent: number;
  /** 最近一次完成的三字码（dimensional 量表为 null） */
  typeCode: string | null;
  /** 最近一次完成时间（`YYYY-MM-DD HH:mm`；无完成为空串） */
  completedAt: string;
  /** 已完成版本条数（接口 `history` 含当前版本，最多 `MAX_RESULT_VERSIONS` 条） */
  historyCount: number;
  /** 版本数是否被接口上限截断：为 true 时页面显示 `10+`，不谎报正好 10 次 */
  historyCapped: boolean;
  /** 进行中且题目已全部答完（只差提交）：页面据此把「继续作答」文案换成「去提交」 */
  draftComplete: boolean;
  /** 量表是否开放；关闭时页面不提供「开始 / 继续作答」入口 */
  enabled: boolean;
}

/** 接口给的正整数计数（其余一律按 0），供列表归一（#291）共用同一口径 */
export function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** 接口给的文本（去首尾空白，非字符串按空串），供列表归一（#291）共用同一口径 */
export function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/** 进度百分比：总数为 0 返回 0，并钳在 0–100（数据异常时进度条不越界） */
export function progressPercent(answered: number, total: number): number {
  if (!Number.isFinite(answered) || !Number.isFinite(total) || total <= 0) return 0;
  return Math.max(0, Math.min(100, Math.round((answered / total) * 100)));
}

/** 耗时估算（分钟）：按单题秒数向上取整，最少 1 分钟；题量为 0 返回 0（页面显示「—」） */
export function estimateMinutes(questionCount: number): number {
  if (!Number.isFinite(questionCount) || questionCount <= 0) return 0;
  return Math.max(MIN_ESTIMATED_MINUTES, Math.ceil((questionCount * ESTIMATE_SECONDS_PER_QUESTION) / 60));
}

/**
 * 三态判定（优先级：进行中 > 已完成 > 未开始）。
 *
 * 「已完成」之后又开了一轮（重测）时，草稿优先于旧结果：此时学生最该做的是把这一轮答完，
 * 旧结果的三字码仍保留在 `typeCode` 里，页面可作为次要信息展示。
 */
export function deriveAssessmentCenter(payload: AssessmentCenterPayload | null | undefined): AssessmentCenterView {
  const questionCount = toCount(payload?.assessment?.questionCount);
  // 题库不可能小于一次卷子：旧接口缺字段（0）或脏数据冲突时都按「题库 = 每次题量」收敛，
  // 页面因此不会出现「从 30 题中抽 30 题」或「题库 20 题、每次 30 题」这类自相矛盾的显示。
  const rawPoolSize = toCount(payload?.assessment?.poolSize);
  const poolSize = rawPoolSize >= questionCount ? rawPoolSize : questionCount;
  const enabled = payload?.assessment?.enabled !== false;

  const rawDraft = payload?.inProgress;
  const rawDraftTotal = toCount(rawDraft?.total);
  // 分母一律取本轮题量：服务端下发的草稿总数与本次题量冲突时（旧口径 120、脏数据更小），
  // 进度仍显示 n/本轮题量，不会出现 12/120 或被脏值提前判定为「可以提交」。
  const draftTotal = questionCount > 0 ? questionCount : rawDraftTotal;
  const draftAnswered = Math.min(toCount(rawDraft?.answered), draftTotal);
  const inProgress = draftAnswered > 0;

  const rawTypeCode = payload?.current?.typeCode;
  const typeCode = typeof rawTypeCode === "string" && rawTypeCode.trim() !== "" ? rawTypeCode.trim() : null;
  const rawCompletedAt = payload?.current?.completedAt;
  const completedAt = typeof rawCompletedAt === "string" ? formatResultTime(rawCompletedAt) : "";
  const hasCurrent = Boolean(payload?.current) && (typeCode !== null || completedAt !== "");
  // results 接口给 history 数组；#291 的 list 接口只给条数（不下发整份历史）
  const historyCount = Array.isArray(payload?.history) ? payload.history.length : toCount(payload?.historyCount);

  const status: AssessmentCenterStatus = inProgress ? "in-progress" : hasCurrent ? "completed" : "not-started";

  return {
    status,
    questionCount,
    poolSize,
    estimatedMinutes: estimateMinutes(questionCount),
    answered: inProgress ? draftAnswered : 0,
    total: inProgress ? draftTotal : questionCount,
    percent: inProgress ? progressPercent(draftAnswered, draftTotal) : 0,
    typeCode,
    completedAt,
    historyCount,
    // 接口至多回传 MAX_RESULT_VERSIONS 条（含当前版本）；正好撞上限时视为可能被截断
    historyCapped: historyCount >= MAX_RESULT_VERSIONS,
    draftComplete: inProgress && draftTotal > 0 && draftAnswered >= draftTotal,
    enabled,
  };
}
