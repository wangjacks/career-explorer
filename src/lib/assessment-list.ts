import { RIASEC_CODE } from "./assessment-data";
import {
  deriveAssessmentCenter,
  estimateMinutes,
  toCount,
  toText,
  type AssessmentCenterPayload,
  type AssessmentCenterStatus,
} from "./assessment-center";
import { MAX_RESULT_VERSIONS, answerProgress, type AssessmentAnswers } from "./assessment-flow";
import type { ScoringMode } from "./assessment-scoring";

/**
 * 测评中心多量表（#291）的纯逻辑：把 `GET /api/shared/assessment/list` 的返回归一成
 * 「每套量表一行」的清单，并决定「我的测评」卡展示哪一套（最近活跃量表）。
 *
 * 三态、耗时、进度仍复用 `assessment-center.ts`（#222/#283 的口径只有一个），
 * 本文件只负责「多套量表之间怎么选、每行怎么排」——这部分是纯函数，可直接单测
 * （`assessment-list.test.ts`），页面与接口都只消费这里的结果。
 */

/** 答题页路径（href 由 `quizHref` 统一拼，页面不自己写 `?code=`） */
export const ASSESSMENT_QUIZ_PATH = "/dashboard/student/assessment/quiz";

/** 一套量表在测评中心的完整视图（list 接口的响应项，服务端归一后下发） */
export interface AssessmentListItem {
  code: string;
  name: string;
  /** 每次作答的题量（#283：启用抽题时是抽题数，不是题库总量） */
  questionCount: number;
  /** 题库总量 */
  poolSize: number;
  scoringMode: ScoringMode;
  scaleVersion: string;
  dimensions: { key: string; label: string }[];
  status: AssessmentCenterStatus;
  /** 最近一次完成的三字码（dimensional 量表为 null） */
  typeCode: string | null;
  /** 最近一次完成时间（`YYYY-MM-DD HH:mm`；无完成为空串） */
  completedAt: string;
  /** 已完成版本条数（含当前版本；与 results 同口径，至多 `MAX_RESULT_VERSIONS` 条） */
  historyCount: number;
  /** 进行中的草稿进度；没有草稿或还没答过题为 null */
  inProgress: { answered: number; total: number; updatedAt: string } | null;
  /** 署名 / 授权 / 免责：页底授权卡按主测评展示（与 results 接口同一份库字段） */
  attribution: string;
  licenseText: string;
  disclaimer: string;
}

/** 服务端归一一套量表的入参：作答口径来自 `loadAttemptContext`，路由只做搬运 */
export interface AssessmentListSource {
  assessment: {
    code: string;
    name: string;
    scoringMode: ScoringMode;
    scaleVersion: string;
    dimensions: { key: string; label: string }[];
    attribution: string;
    licenseText: string;
    disclaimer: string;
  };
  /** 本轮题号（#282：启用抽题时是抽中的 30 题） */
  roundIndexes: readonly number[];
  /** 整库题号 */
  bankIndexes: readonly number[];
  /** 服务端草稿：只传过滤到本轮的作答；没有草稿为 null */
  draft: { answers: AssessmentAnswers; updatedAt: string } | null;
  /** 该用户该量表的完成记录（新→旧，含当前版本标记） */
  completed: { typeCode: string | null; completedAt: string | null; isCurrent: boolean }[];
}

/**
 * 归一单套量表（#291，服务端调用）：题量 / 草稿进度 / 三态都走 `deriveAssessmentCenter`，
 * 列表接口不另算一套口径。
 *
 * 草稿进度与 results 接口同款：只认**本轮题号**（不是整库 120），答 0 题不展示进度。
 */
export function buildAssessmentListItem(source: AssessmentListSource): AssessmentListItem {
  const progress = source.draft ? answerProgress(source.draft.answers, source.roundIndexes) : null;
  const inProgress =
    source.draft && progress && progress.answered > 0
      ? { answered: progress.answered, total: progress.total, updatedAt: source.draft.updatedAt }
      : null;
  const current = source.completed.find((row) => row.isCurrent) ?? null;
  // results 接口的 history 数组至多 10 条，页面按「10+」展示；list 也按同一上限计数，
  // 否则完成 12 次会显示成「12+」（列表其实知道确切条数，加号反而误导）。
  const historyCount = Math.min(source.completed.length, MAX_RESULT_VERSIONS);

  const view = deriveAssessmentCenter({
    assessment: {
      questionCount: source.roundIndexes.length,
      poolSize: source.bankIndexes.length,
      enabled: true,
      code: source.assessment.code,
      name: source.assessment.name,
    },
    current: current ? { typeCode: current.typeCode, completedAt: current.completedAt } : null,
    historyCount,
    inProgress,
  });

  return {
    code: source.assessment.code,
    name: source.assessment.name,
    questionCount: view.questionCount,
    poolSize: view.poolSize,
    scoringMode: source.assessment.scoringMode,
    scaleVersion: source.assessment.scaleVersion,
    dimensions: source.assessment.dimensions,
    status: view.status,
    typeCode: view.typeCode,
    completedAt: view.completedAt,
    historyCount: view.historyCount,
    inProgress,
    attribution: source.assessment.attribution,
    licenseText: source.assessment.licenseText,
    disclaimer: source.assessment.disclaimer,
  };
}

function normalizeStatus(record: Record<string, unknown>, inProgress: boolean, completedAt: string, typeCode: string): AssessmentCenterStatus {
  if (record.status === "not-started" || record.status === "in-progress" || record.status === "completed") {
    return record.status;
  }
  // 状态字段异常时按同一优先级兜底（进行中 > 已完成 > 未开始），与 deriveAssessmentCenter 一致
  if (inProgress) return "in-progress";
  return completedAt !== "" || typeCode !== "" ? "completed" : "not-started";
}

/**
 * 客户端归一 list 接口返回的数组（#291）：接口字段一律当作不可信，坏行直接丢弃。
 *
 * 没有 `code` 的行必须丢：清单行与「最近活跃」都要能定位到一套量表，缺标识的行没法作答。
 */
export function normalizeAssessmentList(raw: unknown): AssessmentListItem[] {
  if (!Array.isArray(raw)) return [];
  const items: AssessmentListItem[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object") continue;
    const record = entry as Record<string, unknown>;
    const code = toText(record.code);
    if (code === "") continue;

    const questionCount = toCount(record.questionCount);
    // 题库不可能小于一次卷子：与 deriveAssessmentCenter 同口径收敛
    const poolSize = Math.max(questionCount, toCount(record.poolSize));

    const rawDraft = record.inProgress;
    const draft = rawDraft !== null && typeof rawDraft === "object" ? (rawDraft as Record<string, unknown>) : null;
    const draftTotal = questionCount > 0 ? questionCount : toCount(draft?.total);
    const draftAnswered = Math.min(toCount(draft?.answered), draftTotal);
    const inProgress =
      draft && draftAnswered > 0
        ? { answered: draftAnswered, total: draftTotal, updatedAt: toText(draft.updatedAt) }
        : null;

    const typeCode = toText(record.typeCode);
    const completedAt = toText(record.completedAt);
    const dimensions = Array.isArray(record.dimensions)
      ? record.dimensions
          .map((dimension) =>
            dimension !== null && typeof dimension === "object" ? (dimension as Record<string, unknown>) : null
          )
          .map((dimension) => ({ key: toText(dimension?.key), label: toText(dimension?.label) }))
          .filter((dimension) => dimension.key !== "")
      : [];

    items.push({
      code,
      name: toText(record.name) || code,
      questionCount,
      poolSize,
      scoringMode: record.scoringMode === "dimensional" ? "dimensional" : "typological",
      scaleVersion: toText(record.scaleVersion),
      dimensions,
      status: normalizeStatus(record, inProgress !== null, completedAt, typeCode),
      typeCode: typeCode === "" ? null : typeCode,
      completedAt,
      historyCount: toCount(record.historyCount),
      inProgress,
      attribution: toText(record.attribution),
      licenseText: toText(record.licenseText),
      disclaimer: toText(record.disclaimer),
    });
  }
  return items;
}

/** 把列表项还原成 `deriveAssessmentCenter` 的入参：状态卡 / 清单行的视图不另算一套 */
export function assessmentCenterPayloadOf(item: AssessmentListItem): AssessmentCenterPayload {
  return {
    assessment: {
      questionCount: item.questionCount,
      poolSize: item.poolSize,
      enabled: true,
      code: item.code,
      name: item.name,
    },
    current:
      item.completedAt !== "" || item.typeCode !== null
        ? { typeCode: item.typeCode, completedAt: item.completedAt }
        : null,
    historyCount: item.historyCount,
    inProgress: item.inProgress,
  };
}

/** 取时间最新的那一项（空串视为最早；相同时间保留列表靠前的一项，结果可复现） */
function latestBy<T>(items: readonly T[], keyOf: (item: T) => string): T {
  return items.reduce((best, item) => (keyOf(item) > keyOf(best) ? item : best));
}

/**
 * 「我的测评」卡展示哪一套量表（#291）——最近活跃量表：
 * 1. 有草稿的优先，取 `updatedAt` 最新的一套（学生最该做的是把它答完）；
 * 2. 否则取最近完成的一套（`completedAt` 最新）；
 * 3. 都没有时回到主测评 `riasec`；主测评也不在列表里（被停用）则取列表第一套。
 *
 * 三套都为空（没有启用的量表）返回 null，页面据此展示「暂无可用测评」。
 */
export function deriveLatestActive(items: readonly AssessmentListItem[] | null | undefined): AssessmentListItem | null {
  if (!Array.isArray(items) || items.length === 0) return null;

  const withDraft = items.filter((item) => item.inProgress !== null);
  if (withDraft.length > 0) return latestBy(withDraft, (item) => item.inProgress?.updatedAt ?? "");

  const completed = items.filter((item) => item.completedAt !== "");
  if (completed.length > 0) return latestBy(completed, (item) => item.completedAt);

  return items.find((item) => item.code === RIASEC_CODE) ?? items[0];
}

/** 答题页地址：每套量表进自己的卷子（答题页按 `?code=` 取量表，#289） */
export function quizHref(code: string): string {
  return `${ASSESSMENT_QUIZ_PATH}?code=${encodeURIComponent(code)}`;
}

/** 状态卡「结果形式」的文案：按计分模式说结果长什么样（大五没有三字码） */
export function resultFormCopy(mode: ScoringMode): string {
  return mode === "dimensional" ? "五大人格画像" : "三字码 + 六型分布";
}

/** 测验列表卡（#291）的一行：每套启用的量表都有一行，状态来自本人各自的作答数据 */
export interface AssessmentListRow {
  code: string;
  name: string;
  questionCount: number;
  estimatedMinutes: number;
  status: AssessmentCenterStatus;
  /** 题库非空才给作答入口（空库显示「题库准备中」） */
  canStart: boolean;
  /** 答题页地址（带 `?code=`，进入对应量表） */
  href: string;
}

/**
 * 清单行构造（#291）：直通 list 接口的逐套状态，不再有「主测评才有入口」的分支——
 * 答题页自 #289 起按 `?code=` 取量表，每套量表都能进自己的卷子。
 */
export function buildAssessmentList(items: readonly AssessmentListItem[] | null | undefined): AssessmentListRow[] {
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({
    code: item.code,
    name: item.name,
    questionCount: item.questionCount,
    estimatedMinutes: estimateMinutes(item.questionCount),
    status: item.status,
    canStart: item.questionCount > 0,
    href: quizHref(item.code),
  }));
}
