/**
 * 教师端「档案详情」的数据适配（#332）。
 *
 * 目标：弹窗**不复制**学生端的卡片实现，而是把「列表行 payload + 量表元信息」适配成
 * 学生端共享组件消费的同一份视图模型（`ProfileSummary` / `AssessmentResultsData` /
 * 授权卡入参）。因此这里只有纯函数：不发请求、不读 DOM，可直接单测。
 *
 * 数据来源：
 * - `/api/manage/profiles` 的列表行（`assessmentResults[code]` + `assessmentScales`）；
 * - 可选 `/api/manage/profiles/careers`（教师端只读推荐职业，Top3）。
 */

import {
  buildBigFiveBars,
  buildBigFiveHeadline,
  buildCareerCards,
  buildRiasecBars,
  describeTypeCode,
  resultCardMode,
  type AssessmentResultsPayload,
  type AssessmentScaleMeta,
  type CareerApiItem,
  type CareerCardView,
  type RiasecScoreSnapshot,
  type AttributionScaleInput,
} from "./assessment-view";
import type { DimensionScore } from "./assessment-scoring";
import type { AssessmentListItem } from "./assessment-list";
import {
  assessmentCodeFromDetailId,
  buildProfileSummary,
  type ProfileSummary,
  type SummaryCard,
  type SummaryProfileInput,
} from "./profile-summary";
import {
  assessmentLeadOf,
  type ProfileAssessmentScaleView,
  type ProfileScaleResultView,
} from "./profile-assessment";

/** 详情弹窗需要的最小列表行字段（`Profile` 的子集，便于纯函数测试） */
export interface TeacherProfileDetailRow {
  userId?: number;
  studentId: string;
  studentName: string;
  classId?: number | null;
  className?: string | null;
  tags: string[];
  avatarUrl: string;
  evaluationUrl: string;
  evaluationTexts?: string[];
  storageId?: number;
  createdAt: string;
  assessmentResults?: Record<string, ProfileScaleResultView> | null;
}

/** 教师端推荐职业接口的成功响应（与共享端点同形，只取 Top3） */
export interface TeacherCareersPayload {
  careers?: CareerApiItem[];
  attribution?: string;
}

/** 把教师端下发的轻量结果（只带 `{key, standard}`）适配成共享结果卡的 `DimensionScore[]` */
function toDimensionScores(scores: readonly RiasecScoreSnapshot[] | null | undefined): DimensionScore[] {
  if (!Array.isArray(scores)) return [];
  // 轻量快照缺少 raw / band / 作答计数：共享卡片只用 key + standard（buildRiasecBars / buildBigFiveBars 同口径）
  return scores as unknown as DimensionScore[];
}

/** 量表视图 → 学生端清单项（#323 的 `AssessmentListItem`），detail 卡与摘要卡共用 */
export function toAssessmentListItem(
  scale: ProfileAssessmentScaleView,
  result: ProfileScaleResultView | null | undefined
): AssessmentListItem {
  const isHolland = resultCardMode(scale) === "holland";
  // 与列表列同口径：typological 量表要求三字码合法才算已测（脏数据按未测）
  const completed =
    result?.status === "completed" && (!isHolland || assessmentLeadOf(result.typeCode) !== null);
  return {
    code: scale.code,
    name: scale.name,
    questionCount: scale.questionCount ?? 0,
    poolSize: scale.poolSize ?? scale.questionCount ?? 0,
    scoringMode: isHolland ? "typological" : "dimensional",
    scaleVersion: scale.scaleVersion ?? "",
    dimensions: scale.dimensions,
    status: completed ? "completed" : "not-started",
    typeCode: isHolland && completed ? (result?.typeCode ?? null) : null,
    completedAt: completed ? (result?.completedAt ?? "") : "",
    // 教师列表不下发历史版本数：当前结果存在即算一条；旧的「次数」文案在这里没有意义
    historyCount: completed ? 1 : 0,
    inProgress: null,
    attribution: scale.attribution ?? "",
    licenseText: scale.licenseText ?? "",
    disclaimer: scale.disclaimer ?? "",
  };
}

/** 单套量表的当前结果 → `/api/shared/assessment/results` 同形的 payload（history 为空） */
export function toAssessmentResultsPayload(
  scale: ProfileAssessmentScaleView,
  result: ProfileScaleResultView | null | undefined,
  listItem: AssessmentListItem
): AssessmentResultsPayload {
  const isHolland = resultCardMode(scale) === "holland";
  // 与列表同口径：typological 量表要求三字码合法才算已测；dimensional 有当前结果即已测
  const completed = result?.status === "completed" && (!isHolland || listItem.typeCode !== null);
  const assessment: AssessmentScaleMeta = {
    code: scale.code,
    name: scale.name,
    questionCount: scale.questionCount ?? 0,
    poolSize: scale.poolSize ?? scale.questionCount ?? 0,
    scaleVersion: scale.scaleVersion ?? "",
    dimensions: scale.dimensions,
    attribution: scale.attribution ?? "",
    licenseText: scale.licenseText ?? "",
    disclaimer: scale.disclaimer ?? "",
    scoringMode: listItem.scoringMode,
    enabled: true,
  };
  const scores = toDimensionScores(result?.scores ?? null);
  const current =
    completed && result
      ? {
          id: 0,
          typeCode: listItem.typeCode,
          scores,
          completedAt: result.completedAt ?? "",
          isCurrent: true,
          questionCount: scale.questionCount ?? 0,
        }
      : null;
  return { assessment, current, history: [], inProgress: null };
}

export interface TeacherAssessmentDetailData {
  /** 启用中的量表清单（顺序与列表接口一致） */
  scales: AssessmentListItem[];
  /** 量表 code → 结果 payload（未测量表也有 payload，`current` 为 null） */
  payloads: Record<string, AssessmentResultsPayload>;
  /** 详情卡不单独拉接口，因此没有「单套失败」；字段保留给共享组件同构 */
  failedCodes: string[];
  /** 摘要/详情卡用不到推荐职业（Top3 只在速览卡展示） */
  careers: CareerCardView[];
  careersAttribution: string;
  careersFailed: boolean;
  listFailed: boolean;
  /** 授权卡入参（按量表分组，O*NET / IPIP 全文一次） */
  attributionScales: AttributionScaleInput[];
}

/**
 * 由列表行 + 量表清单构造详情弹窗的测评数据（**零额外请求**）。
 *
 * 未测量表也生成 `current: null` 的 payload，共享结果卡据此显示「未测」而不是整块空白。
 */
export function buildTeacherAssessmentDetail(
  scales: readonly ProfileAssessmentScaleView[],
  assessmentResults: Record<string, ProfileScaleResultView> | null | undefined
): TeacherAssessmentDetailData {
  const scaleItems: AssessmentListItem[] = [];
  const payloads: Record<string, AssessmentResultsPayload> = {};
  for (const scale of scales) {
    const result = assessmentResults?.[scale.code] ?? null;
    const listItem = toAssessmentListItem(scale, result);
    scaleItems.push(listItem);
    payloads[scale.code] = toAssessmentResultsPayload(scale, result, listItem);
  }
  return {
    scales: scaleItems,
    payloads,
    failedCodes: [],
    careers: [],
    careersAttribution: "",
    careersFailed: false,
    listFailed: false,
    attributionScales: scales.map((scale) => ({
      code: scale.code,
      name: scale.name,
      attribution: scale.attribution ?? "",
      licenseText: scale.licenseText ?? "",
      disclaimer: scale.disclaimer ?? "",
    })),
  };
}

/** 列表行 → 速览卡的档案资料入参（标签 / 完成度 / 版本数） */
export function toSummaryProfileInput(
  row: TeacherProfileDetailRow,
  versionCount?: number
): SummaryProfileInput {
  return {
    tags: row.tags,
    avatarUrl: row.avatarUrl,
    evaluationUrl: row.evaluationUrl,
    evaluationTexts: row.evaluationTexts,
    submitted: Boolean(row.createdAt),
    ...(typeof versionCount === "number" && versionCount > 0 ? { versionCount } : {}),
  };
}

/**
 * 教师端速览四卡：与学生端同一份 `buildProfileSummary`，仅 `audience: "teacher"`
 * （空态不给「去测评 / 编辑」这类学生动作）。
 */
export function buildTeacherProfileSummary(input: {
  row: TeacherProfileDetailRow;
  detail: TeacherAssessmentDetailData;
  careers?: readonly CareerCardView[];
  careersFailed?: boolean;
  versionCount?: number;
}): ProfileSummary {
  const { row, detail, careers = [], careersFailed = false, versionCount } = input;
  return buildProfileSummary({
    profile: toSummaryProfileInput(row, versionCount),
    scales: detail.scales,
    results: detail.payloads,
    careers,
    audience: "teacher",
    careersFailed,
  });
}

/** 推荐职业接口响应 → 速览卡数据（与共享端点同一切片口径，只取前 3） */
export function buildTeacherCareers(payload: TeacherCareersPayload | null | undefined): {
  careers: CareerCardView[];
  attribution: string;
} {
  return {
    careers: buildCareerCards(payload?.careers).slice(0, 3),
    attribution: typeof payload?.attribution === "string" ? payload.attribution : "",
  };
}

/**
 * 纯展示辅助：速览卡顶部「兴趣三字码 + 主导三型」文案（弹窗身份区下方一行）。
 * 与摘要卡同源（`describeTypeCode` + `buildRiasecBars`），不重写口径。
 */
export function buildInterestQuickView(
  scales: readonly ProfileAssessmentScaleView[],
  assessmentResults: Record<string, ProfileScaleResultView> | null | undefined
): { typeCode: string; labels: string; topBars: { label: string; standard: number }[] } | null {
  const holland = scales.find((scale) => resultCardMode(scale) === "holland");
  if (!holland) return null;
  const result = assessmentResults?.[holland.code];
  if (!result || result.status !== "completed" || !result.typeCode) return null;
  return {
    typeCode: result.typeCode,
    labels: describeTypeCode(result.typeCode),
    topBars: buildRiasecBars(result.scores ?? [], result.typeCode)
      .slice(0, 3)
      .map((bar) => ({ label: bar.label, standard: bar.standard })),
  };
}

/** 纯展示辅助：人格 headline（弹窗身份区下方一行；未测返回 null） */
export function buildPersonalityQuickView(
  scales: readonly ProfileAssessmentScaleView[],
  assessmentResults: Record<string, ProfileScaleResultView> | null | undefined
): { headline: string; bars: { label: string; standard: number }[] } | null {
  const bigFive = scales.find((scale) => resultCardMode(scale) === "big-five");
  if (!bigFive) return null;
  const result = assessmentResults?.[bigFive.code];
  if (!result || result.status !== "completed" || !result.scores || result.scores.length === 0) return null;
  const scores = toDimensionScores(result.scores);
  return {
    headline: buildBigFiveHeadline(scores, bigFive.dimensions),
    bars: buildBigFiveBars(scores, bigFive.dimensions)
      .slice(0, 2)
      .map((bar) => ({ label: bar.label, standard: bar.standard })),
  };
}
/**
 * 速览卡「查看详情」的落点判定（#332）：教师弹窗不跳转页面，只做「展开对应折叠卡 + 滚动」。
 * 与学生端 #323 同一锚点口径（`assessmentDetailId` / `PROFILE_INFO_ID` / `ASSESSMENT_RESULTS_ID`）。
 */
export interface SummaryActionTarget {
  targetId: string;
  /** 需要展开的测评卡 code；非测评锚点为 null */
  expandCode: string | null;
}

export function resolveSummaryActionTarget(card: SummaryCard): SummaryActionTarget | null {
  if (card.cta.action !== "detail" && card.cta.action !== "profile") return null;
  const targetId = card.cta.targetId;
  if (!targetId) return null;
  return { targetId, expandCode: assessmentCodeFromDetailId(targetId) };
}