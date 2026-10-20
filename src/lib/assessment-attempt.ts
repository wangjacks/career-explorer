import {
  getAssessmentDraft,
  getAssessmentQuestionsByCode,
  getAssessmentResults,
  type AssessmentQuestionRow,
  type AssessmentResultRow,
  type AssessmentRow,
} from "./db";
import { filterAnswersToBank, parseAnswers, parseDimensions, type AssessmentAnswers } from "./assessment-flow";
import {
  buildItemsSnapshot,
  parseItemsSnapshot,
  planAttempt,
  type AttemptPlan,
  type PoolItem,
} from "./assessment-sampling";

/**
 * 本轮作答的口径来源（#282）：四个作答侧路由（start / answer / submit / results）共用同一次推导，
 * 保证「下发的卷子」「校验的题号」「计分的题目集合」「进度分母」四者永远一致。
 *
 * 抽题是**确定性派生**（`draw = f(uid, assessmentId, 题库指纹, attemptNo)`）而不是每次随机，
 * 所以这里每次现算即可，无需写库、也无需额外状态列：
 * - `attemptNo` 用「completed 记录数 + 1」数出来，草稿阶段不增长（草稿是 `in_progress`），
 *   因此续答期间同一张卷子稳定不变；
 * - 草稿已有有效快照时以快照为准（题面可能被后台维护过，续答不能换题）；
 * - 上一轮用过的题号来自最近一条 completed 记录的快照，作为本轮排除集。
 */
export interface AttemptContext {
  /** 第几轮（从 1 开始）：completed 记录数 + 1 */
  attemptNo: number;
  /** 整库题号，按题号升序 */
  bankIndexes: number[];
  /** 本轮题号，按呈现顺序（`items_per_attempt = 0` 时即整库） */
  roundIndexes: number[];
  /** 本轮题目行，按呈现顺序——计分与题面下发都只认这份，不用整库 */
  roundQuestions: AssessmentQuestionRow[];
  /** 抽题计划（含题库指纹与降级 warning） */
  plan: AttemptPlan;
  /** 写库用的 `items_json` 快照文本（与 plan 同源，路由不自己拼 JSON） */
  itemsJson: string;
  draft: AssessmentResultRow | undefined;
  /** 该用户该量表的全部 completed 记录，`completed_at` 倒序 */
  completed: AssessmentResultRow[];
  /** 草稿里过滤到本轮的作答：路由的进度、缺答、合并都以它为准 */
  answers: AssessmentAnswers;
  /** `items_per_attempt = 0`：整库即本轮（旧口径 / 未启用抽题的量表） */
  fullBank: boolean;
}

/**
 * 读题库 + 草稿 + 历史结果，推出本轮卷子。
 * 抽题降级 warning 在这里落服务端日志：后台删题导致配比放宽时运维能看到，
 * 但不进响应体（学生侧不需要知道抽题细节，也不该据此推断题目来源）。
 */
export async function loadAttemptContext(assessment: AssessmentRow, userId: number): Promise<AttemptContext> {
  const [questions, draft, completed] = await Promise.all([
    getAssessmentQuestionsByCode(assessment.code),
    getAssessmentDraft(userId, assessment.id),
    getAssessmentResults(userId, assessment.id),
  ]);

  const pool: PoolItem[] = questions.map((question) => ({
    index: question.question_index,
    dimension: question.dimension,
    origin: question.origin,
    version: question.version,
  }));
  const bankIndexes = pool.map((item) => item.index);
  const answeredIndexes = new Set(Object.keys(parseAnswers(draft?.answers_json)).map(Number));
  // 上一轮的题号集合：只有带快照的记录才排除得准。旧记录（`items_json = '[]'`）不排除——
  // 那整库都答过，排除反而会让新轮抽不满。
  const previousSnapshot = parseItemsSnapshot(completed[0]?.items_json);
  const attemptNo = completed.length + 1;

  const plan = planAttempt({
    pool,
    dimensions: parseDimensions(assessment.dimensions_json),
    scaleVersion: assessment.scale_version,
    itemsPerAttempt: assessment.items_per_attempt,
    userId,
    assessmentId: assessment.id,
    attemptNo,
    excludedIndexes: new Set(previousSnapshot?.indexes ?? []),
    answeredIndexes,
    snapshotRaw: draft?.items_json ?? null,
  });
  if (plan.warnings.length > 0) {
    console.warn(
      `抽题降级（assessment=${assessment.code}, uid=${userId}, attemptNo=${attemptNo}）：`,
      plan.warnings.join(" / ")
    );
  }

  const byIndex = new Map(questions.map((question) => [question.question_index, question]));
  const roundIndexes = plan.indexes;
  const roundQuestions = roundIndexes.map((index) => byIndex.get(index)!);

  return {
    attemptNo,
    bankIndexes,
    roundIndexes,
    roundQuestions,
    plan,
    itemsJson: buildItemsSnapshot(roundIndexes, plan.poolFingerprint),
    draft,
    completed,
    answers: filterAnswersToBank(parseAnswers(draft?.answers_json), roundIndexes),
    fullBank: assessment.items_per_attempt <= 0,
  };
}
