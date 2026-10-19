import { MAX_RESULT_VERSIONS, formatResultTime } from "./assessment-flow";

/**
 * 测评中心页（#222）的纯逻辑：把 `GET /api/shared/assessment/results` 的返回归一成
 * 「未开始 / 进行中 / 已完成」三态视图，并算题目耗时估算与进度百分比。
 *
 * 页面只负责渲染，三态判定不写进组件，这样「三种状态分支」可以直接单测
 * （`assessment-center.test.ts`），也避免页面与服务端进度口径各算一遍。
 */

/** 单题耗时估算（秒）：30 题 ≈ 4 分钟；只为给一个量级，不需要精确 */
export const ESTIMATE_SECONDS_PER_QUESTION = 8;

/** 最小耗时（分钟）：题量少时也显示「约 1 分钟」，避免出现「约 0 分钟」 */
export const MIN_ESTIMATED_MINUTES = 1;

export type AssessmentCenterStatus = "not-started" | "in-progress" | "completed";

/** 接口返回的字段都当作不可信：UI 只消费归一后的值 */
export interface AssessmentCenterPayload {
  assessment?: { questionCount?: unknown; enabled?: unknown; code?: unknown; name?: unknown } | null;
  /**
   * 多量表预留（#225）：接口将来若一次返回多套量表，就用这个数组（每项形状同 `assessment`）；
   * 当前接口只返回单个 `assessment`，列表卡退化成一条。
   */
  assessments?: unknown[] | null;
  current?: { typeCode?: unknown; completedAt?: unknown } | null;
  history?: unknown;
  inProgress?: { answered?: unknown; total?: unknown } | null;
}

export interface AssessmentCenterView {
  status: AssessmentCenterStatus;
  /** 本次测评题量（接口题库为空时为 0） */
  questionCount: number;
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

function toCount(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
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
  const enabled = payload?.assessment?.enabled !== false;

  const rawDraft = payload?.inProgress;
  const draftTotal = Math.max(0, toCount(rawDraft?.total) || questionCount);
  const draftAnswered = Math.min(toCount(rawDraft?.answered), draftTotal);
  const inProgress = draftAnswered > 0;

  const rawTypeCode = payload?.current?.typeCode;
  const typeCode = typeof rawTypeCode === "string" && rawTypeCode.trim() !== "" ? rawTypeCode.trim() : null;
  const rawCompletedAt = payload?.current?.completedAt;
  const completedAt = typeof rawCompletedAt === "string" ? formatResultTime(rawCompletedAt) : "";
  const hasCurrent = Boolean(payload?.current) && (typeCode !== null || completedAt !== "");
  const historyCount = Array.isArray(payload?.history) ? payload.history.length : 0;

  const status: AssessmentCenterStatus = inProgress ? "in-progress" : hasCurrent ? "completed" : "not-started";

  return {
    status,
    questionCount,
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

/** 测验列表卡（#225）的一行 */
export interface AssessmentListRow {
  code: string;
  name: string;
  questionCount: number;
  estimatedMinutes: number;
  /** 主测评沿用三态判定；后续新增量表没有作答进度，先按「未开始」展示 */
  status: AssessmentCenterStatus;
  enabled: boolean;
  /** 题库非空且量表开放时才给「开始 / 继续作答」入口 */
  canStart: boolean;
}

function toText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * 把接口返回归一成「测验列表」（#225）：当前接口只返回单套 RIASEC，列表就是 1 行；
 * 将来多量表时让接口返回 `assessments` 数组即可，渲染结构不用改。
 *
 * 列表只消费 `assessment` / `assessments` 的**展示字段**（code / name / 题量 / 是否开放），
 * 三态与耗时沿用 `deriveAssessmentCenter` / `estimateMinutes`，不另算一套。
 * 没有 code 的行直接丢弃：列表卡要能点进对应量表，缺标识的行没有渲染价值。
 */
export function buildAssessmentList(
  payload: AssessmentCenterPayload | null | undefined,
  view?: AssessmentCenterView
): AssessmentListRow[] {
  const center = view ?? deriveAssessmentCenter(payload);
  const single = payload?.assessment ?? null;
  const rawList: unknown[] =
    Array.isArray(payload?.assessments) && payload.assessments.length > 0
      ? payload.assessments
      : single
        ? [single]
        : [];

  return rawList
    .map((raw, index) => {
      const item = (raw ?? {}) as { code?: unknown; name?: unknown; questionCount?: unknown; enabled?: unknown };
      const code = toText(item.code);
      const questionCount = toCount(item.questionCount);
      const enabled = item.enabled !== false;
      return {
        code,
        name: toText(item.name) || code,
        questionCount,
        estimatedMinutes: estimateMinutes(questionCount),
        // 只有主测评（单套量表的那个）知道本人进度；多量表预留项先按未开始算
        status: index === 0 && single ? center.status : ("not-started" as AssessmentCenterStatus),
        enabled,
        canStart: enabled && questionCount > 0,
      };
    })
    .filter((row) => row.code !== "");
}
