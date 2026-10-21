/**
 * 「我的档案 · 速览」四卡视图模型（#323）：纯函数，先测后用。
 *
 * 期 2 在折叠详情之上加一层结论区（兴趣类型 / 人格特质 / 推荐职业 Top3 / 我的档案），
 * 让首屏不用展开任何折叠卡就能读完结论。这里只做「数据 → 结论卡」的映射，
 * **所有分数、排序、中文兜底都复用 `assessment-view.ts` 的 builders**（不重写第二套算法），
 * 因此摘要与详情必然一致。
 *
 * 每种卡都有三态，且互不影响：
 * - `ready`：有数据，右上「查看详情」→ 展开并滚动到对应折叠卡；
 * - `empty`：没测过（或还没有结果）→ 给「去测评 / 继续作答」；
 * - `degraded`：接口失败或数据缺失 → 给一个指针（如「查看全部职业」），不报错。
 *
 * **失败绝不能说成「没测过」**：单套结果补拉失败（`failedCodes`）与清单失败（`listFailed`）
 * 都走 `degraded`，只有确实取到「没有结果」才是 `empty`——与期 1 详情卡同一口径。
 */

import {
  buildBigFiveBars,
  buildBigFiveHeadline,
  buildRiasecBars,
  describeTypeCode,
  resultCardMode,
  type AssessmentResultsPayload,
  type CareerCardView,
} from "./assessment-view";
import { quizHref, type AssessmentListItem } from "./assessment-list";

/** 摘要卡种类 */
export type SummaryCardKind = "interest" | "personality" | "careers" | "profile";

/** 摘要卡状态（三态互不影响） */
export type SummaryCardState = "ready" | "empty" | "degraded";

/** 点击摘要卡后要做什么：跳答题页 / 进编辑态 / 展开并滚动到详情 / 纯展示 */
export type SummaryAction = "quiz" | "edit" | "detail" | "profile" | "none";

/** 分数条（摘要卡最多 3 条） */
export interface SummaryBar {
  label: string;
  /** 0–100 标准分（与详情卡同一份值，只做展示） */
  standard: number;
  /** 进度条宽度（0–100） */
  percent: number;
}

/** 推荐职业 / 资料卡里的条目 */
export interface SummaryItem {
  title: string;
  /** 次要信息（英文名、职业群·学历等），可为空 */
  subtitle: string;
}

export interface SummaryCardCta {
  label: string;
  action: SummaryAction;
  /** `detail` / `profile` 时滚动到的元素 id */
  targetId?: string;
  /** `quiz` 时跳转的地址 */
  href?: string;
}

export interface SummaryCard {
  kind: SummaryCardKind;
  title: string;
  state: SummaryCardState;
  /** 结论主体（最多 2 行 / 3 个数字） */
  headline?: string;
  /** 三字码（兴趣卡专用，大字号展示） */
  code?: string;
  /** headline 下的一行说明 */
  caption?: string;
  bars?: SummaryBar[];
  items?: SummaryItem[];
  /** 标签胶囊（资料卡用，最多 6 个） */
  tokens?: string[];
  /** 三项完成度（资料卡用） */
  completion?: { label: string; done: boolean }[];
  cta: SummaryCardCta;
}

export interface ProfileSummary {
  cards: SummaryCard[];
}

/** 已归档的档案资料（页面 `MyProfile` 的子集，摘要只消费这些） */
export interface SummaryProfileInput {
  tags: string[];
  avatarUrl: string;
  evaluationUrl: string;
  submitted: boolean;
}

export interface BuildProfileSummaryInput {
  profile: SummaryProfileInput | null;
  scales: readonly AssessmentListItem[];
  results: Record<string, AssessmentResultsPayload>;
  careers: readonly CareerCardView[];
  /** 量表清单整体失败（摘要卡统一降级到结果区） */
  listFailed?: boolean;
  /** 单套结果补拉失败的 code：那一张摘要卡降级，不能当成「没测过」 */
  failedCodes?: readonly string[];
  /** 推荐职业接口失败（有霍兰德结果但没有推荐时区分「失败」与「为空」） */
  careersFailed?: boolean;
}

/** 结果区容器 id：清单失败时摘要卡统一指向这里重试 */
export const ASSESSMENT_RESULTS_ID = "assessment-results";
/** 「我的档案资料」卡 id：资料摘要卡指向这里 */
export const PROFILE_INFO_ID = "profile-info";

/** 折叠详情卡的 DOM id（与 `AssessmentResultsSection` 生成规则一致） */
export function assessmentDetailId(code: string): string {
  return `assessment-card-${code}`;
}

const DETAIL_ID_PREFIX = "assessment-card-";

/**
 * 从摘要卡的锚点 id 反解量表 code（页面据此展开对应折叠卡）。
 *
 * id 规则只在这里定义一次：页面不再自己拼 `"assessment-card-"` 前缀，
 * 改了命名也不会只改一半（非详情锚点如 `profile-info` / 结果区返回 null）。
 */
export function assessmentCodeFromDetailId(targetId: string): string | null {
  return targetId.startsWith(DETAIL_ID_PREFIX) ? targetId.slice(DETAIL_ID_PREFIX.length) : null;
}

/** 摘要卡最多展示几个标签胶囊 */
const MAX_SUMMARY_TAGS = 6;
/** 推荐职业摘要卡只展示前 3 条 */
const SUMMARY_CAREERS = 3;

const RESULTS_FALLBACK_CTA: SummaryCardCta = {
  label: "查看详情",
  action: "detail",
  targetId: ASSESSMENT_RESULTS_ID,
};

function toBars(rows: readonly { label: string; standard: number; percent: number }[], limit: number): SummaryBar[] {
  return rows.slice(0, limit).map((row) => ({ label: row.label, standard: row.standard, percent: row.percent }));
}

function findScale(scales: readonly AssessmentListItem[], mode: "holland" | "big-five"): AssessmentListItem | null {
  return scales.find((item) => resultCardMode(item) === mode) ?? null;
}

/**
 * 构造四张速览卡（兴趣 / 人格 / 推荐职业 / 我的档案）。
 *
 * 输入全部来自页面已经拿到的同一份数据（#323：数据只拉一次），本函数不发请求、不读 DOM。
 */
export function buildProfileSummary(input: BuildProfileSummaryInput): ProfileSummary {
  const {
    profile,
    scales,
    results,
    careers,
    listFailed = false,
    failedCodes = [],
    careersFailed = false,
  } = input;
  const hollandScale = findScale(scales, "holland");
  const bigFiveScale = findScale(scales, "big-five");
  const hollandPayload = hollandScale ? results[hollandScale.code] : undefined;
  const bigFivePayload = bigFiveScale ? results[bigFiveScale.code] : undefined;
  const hollandCurrent = hollandPayload?.current ?? null;
  // 单套补拉失败时「有没有结果」是未知的：摘要卡必须降级，不能说成没测过
  const hollandFailed = hollandScale !== null && failedCodes.includes(hollandScale.code);
  const bigFiveFailed = bigFiveScale !== null && failedCodes.includes(bigFiveScale.code);

  return {
    cards: [
      buildInterestCard({ hollandScale, hollandPayload, hollandFailed, listFailed }),
      buildPersonalityCard({ bigFiveScale, bigFivePayload, bigFiveFailed, listFailed }),
      buildCareersCard({ hollandScale, hollandCurrent, hollandFailed, careers, listFailed, careersFailed }),
      buildProfileCard(profile),
    ],
  };
}

/** 单套结果读不到时的降级卡：指向那张带「重试」的详情卡，不误导学生重测 */
function scaleFailedCard(base: Pick<SummaryCard, "kind" | "title">, code: string): SummaryCard {
  return {
    ...base,
    state: "degraded",
    headline: "暂时读不到这套测评的结果",
    caption: "可以到下方详情里重试",
    cta: { label: "查看详情", action: "detail", targetId: assessmentDetailId(code) },
  };
}

function buildInterestCard(input: {
  hollandScale: AssessmentListItem | null;
  hollandPayload: AssessmentResultsPayload | undefined;
  hollandFailed: boolean;
  listFailed: boolean;
}): SummaryCard {
  const { hollandScale, hollandPayload, hollandFailed, listFailed } = input;
  const base = { kind: "interest" as const, title: "兴趣类型" };

  if (listFailed) {
    return {
      ...base,
      state: "degraded",
      headline: "暂时读不到测评结论",
      caption: "可以到下方测评区重试",
      cta: RESULTS_FALLBACK_CTA,
    };
  }
  if (!hollandScale) {
    return {
      ...base,
      state: "degraded",
      headline: "兴趣测评暂未开放",
      caption: "开放后做完就能看到三字码与适合的职业方向",
      cta: { label: "查看测评区", action: "detail", targetId: ASSESSMENT_RESULTS_ID },
    };
  }
  if (hollandFailed) {
    return scaleFailedCard(base, hollandScale.code);
  }
  if (!hollandPayload?.current) {
    const inProgress = hollandPayload?.inProgress ?? null;
    return {
      ...base,
      state: "empty",
      headline: inProgress ? "兴趣测评还没答完" : "还没测兴趣类型",
      caption: inProgress
        ? `上次答到 ${inProgress.answered}/${inProgress.total} 题，接着做就能看到结论`
        : "做完就能看到你的三字码、六型分布与适合的职业方向",
      cta: {
        label: inProgress ? "继续作答" : "去测评",
        action: "quiz",
        href: quizHref(hollandScale.code),
      },
    };
  }

  const code = hollandPayload.current.typeCode ?? "";
  return {
    ...base,
    state: "ready",
    code: code || undefined,
    headline: code ? describeTypeCode(code) : "兴趣结果已生成",
    caption: "兴趣最强的三种类型，按先后顺序",
    bars: toBars(buildRiasecBars(hollandPayload.current.scores, hollandPayload.current.typeCode), 3),
    cta: { label: "查看详情", action: "detail", targetId: assessmentDetailId(hollandScale.code) },
  };
}

function buildPersonalityCard(input: {
  bigFiveScale: AssessmentListItem | null;
  bigFivePayload: AssessmentResultsPayload | undefined;
  bigFiveFailed: boolean;
  listFailed: boolean;
}): SummaryCard {
  const { bigFiveScale, bigFivePayload, bigFiveFailed, listFailed } = input;
  const base = { kind: "personality" as const, title: "人格特质" };

  if (listFailed) {
    return {
      ...base,
      state: "degraded",
      headline: "暂时读不到测评结论",
      caption: "可以到下方测评区重试",
      cta: RESULTS_FALLBACK_CTA,
    };
  }
  if (!bigFiveScale) {
    return {
      ...base,
      state: "degraded",
      headline: "人格测评暂未开放",
      caption: "开放后做完就能看到五维画像与主要特质",
      cta: { label: "查看测评区", action: "detail", targetId: ASSESSMENT_RESULTS_ID },
    };
  }
  if (bigFiveFailed) {
    return scaleFailedCard(base, bigFiveScale.code);
  }
  if (!bigFivePayload?.current) {
    const inProgress = bigFivePayload?.inProgress ?? null;
    return {
      ...base,
      state: "empty",
      headline: inProgress ? "人格测评还没答完" : "还没测人格特质",
      caption: inProgress
        ? `上次答到 ${inProgress.answered}/${inProgress.total} 题，接着做就能看到结论`
        : "做完就能看到你的五维画像与主要特质",
      cta: {
        label: inProgress ? "继续作答" : "去测评",
        action: "quiz",
        href: quizHref(bigFiveScale.code),
      },
    };
  }

  const dimensions = bigFivePayload.assessment.dimensions;
  const headline = buildBigFiveHeadline(bigFivePayload.current.scores, dimensions);
  return {
    ...base,
    state: "ready",
    headline: headline || "人格结果已生成",
    caption: "最高的两项特质",
    bars: toBars(buildBigFiveBars(bigFivePayload.current.scores, dimensions), 2),
    cta: { label: "查看详情", action: "detail", targetId: assessmentDetailId(bigFiveScale.code) },
  };
}

function buildCareersCard(input: {
  hollandScale: AssessmentListItem | null;
  hollandCurrent: AssessmentResultsPayload["current"];
  hollandFailed: boolean;
  careers: readonly CareerCardView[];
  listFailed: boolean;
  careersFailed: boolean;
}): SummaryCard {
  const { hollandScale, hollandCurrent, hollandFailed, careers, listFailed, careersFailed } = input;
  const base = { kind: "careers" as const, title: "推荐职业" };
  const detailTarget = hollandScale
    ? { label: "查看全部职业", action: "detail" as const, targetId: assessmentDetailId(hollandScale.code) }
    : RESULTS_FALLBACK_CTA;

  if (listFailed) {
    return {
      ...base,
      state: "degraded",
      headline: "暂时读不到推荐职业",
      caption: "可以到下方测评区重试",
      cta: RESULTS_FALLBACK_CTA,
    };
  }
  // 兴趣结果这次没取到：推荐职业无从算起，但不能说成「还没测兴趣」
  if (hollandScale && hollandFailed) {
    return {
      ...base,
      state: "degraded",
      headline: "暂时读不到推荐职业",
      caption: "兴趣结果这次没取到，可以到详情里重试",
      cta: { label: "查看详情", action: "detail", targetId: assessmentDetailId(hollandScale.code) },
    };
  }
  if (!hollandScale || !hollandCurrent) {
    return {
      ...base,
      state: "empty",
      headline: "做完兴趣测评后生成推荐职业",
      caption: "根据你的六型兴趣匹配职业库，中文名优先展示",
      cta: hollandScale
        ? { label: "去测评", action: "quiz", href: quizHref(hollandScale.code) }
        : { label: "查看测评区", action: "detail", targetId: ASSESSMENT_RESULTS_ID },
    };
  }
  if (careers.length === 0) {
    return {
      ...base,
      state: "degraded",
      headline: careersFailed ? "推荐职业暂时没取到" : "还没有匹配到推荐职业",
      caption: "兴趣结果不受影响，可以到详情里查看完整方向",
      cta: detailTarget,
    };
  }

  return {
    ...base,
    state: "ready",
    headline: "可能适合你的方向",
    caption: `按匹配度取前 ${Math.min(SUMMARY_CAREERS, careers.length)} 个`,
    items: careers.slice(0, SUMMARY_CAREERS).map((career) => ({
      title: career.displayName,
      subtitle: [career.meta, career.hasChineseName ? career.englishName : ""].filter(Boolean).join(" · "),
    })),
    cta: { label: "查看详情", action: "detail", targetId: assessmentDetailId(hollandScale.code) },
  };
}

function buildProfileCard(profile: SummaryProfileInput | null): SummaryCard {
  const base = { kind: "profile" as const, title: "我的档案" };

  if (!profile) {
    return {
      ...base,
      state: "degraded",
      headline: "档案资料暂时读不到",
      caption: "可以稍后刷新页面重试",
      cta: { label: "查看详情", action: "profile", targetId: PROFILE_INFO_ID },
    };
  }

  const completion = [
    { label: "标签", done: profile.tags.length > 0 },
    { label: "头像", done: Boolean(profile.avatarUrl) },
    { label: "评价词云", done: Boolean(profile.evaluationUrl) },
  ];
  const doneCount = completion.filter((item) => item.done).length;
  const tokens = profile.tags.slice(0, MAX_SUMMARY_TAGS);

  return {
    ...base,
    state: "ready",
    headline: profile.submitted ? `已完成 ${doneCount}/3 项资料` : "档案还没提交",
    caption: profile.submitted ? "标签 / 头像 / 评价词云" : "标签必填，头像与评价词云选填",
    tokens,
    completion,
    cta: !profile.submitted
      ? { label: "开始填写", action: "edit" }
      : !profile.evaluationUrl
        ? { label: "补充评价词云", action: "edit" }
        : { label: "查看详情", action: "profile", targetId: PROFILE_INFO_ID },
  };
}
