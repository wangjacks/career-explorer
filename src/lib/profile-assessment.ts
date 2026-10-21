/**
 * 数据列表「兴趣测评」列与兴趣字母筛选的展示口径（#234 / #305 / #330）。
 *
 * 纯函数、无 IO：组件只负责渲染，判定（有没有测、三字码是否包含所选字母、筛不筛掉这一行）
 * 都在这里并被单测锁住——仓库没有 DOM 测试环境，界面逻辑先落纯函数再测。
 *
 * #330 新增「双测评列 + 互斥筛选」的视图模型：`AssessmentFilter` 联合类型从类型层面保证
 * 「兴趣条件」与「人格条件」不可能同时存在（同时传参由服务端再拦一次，见 `profile-query.ts`）。
 */

import { RIASEC_KEYS, type RiasecKey } from "./assessment-match";
import { buildBigFiveHeadline, type RiasecScoreSnapshot } from "./assessment-view";
import type { ProfileInterestFilter, ProfilePersonalityFilter } from "./profile-query";

/** `/api/manage/profiles` 行里的测评字段（#234） */
export interface ProfileAssessmentFields {
  /** 霍兰德三字码；未测为 null */
  assessmentCode?: string | null;
  /** `completed` 已测 / `none` 未测（接口自述，判定以有无三字码为准） */
  assessmentStatus?: string | null;
  /** 完成时间；未测为 null */
  assessmentAt?: string | null;
  /** 六型标准分快照（详情弹窗条形用，与结果页同一份快照）；未测为 null */
  assessmentScores?: unknown[] | null;
  /** #330：按量表 code 的当前有效结果（双列展示用） */
  assessmentResults?: Record<string, ProfileScaleResultView> | null;
}

/** 单套量表的当前结果（#330 接口下发口径） */
export interface ProfileScaleResultView {
  status: "completed" | "none";
  /** 三字码（仅 typological 量表有）；dimensional 量表为 null */
  typeCode: string | null;
  /** 完成时间；未测为 null */
  completedAt: string | null;
  /** 维度分快照（只含 `{ key, standard }`）；未测 / 快照损坏为 null */
  scores: RiasecScoreSnapshot[] | null;
}

/** 启用中的量表定义（#330 接口下发，列定义与维度标签的唯一来源） */
export interface ProfileAssessmentScaleView {
  code: string;
  name: string;
  /** `typological`（霍兰德三字码）/ `dimensional`（大五等） */
  scoringMode: "typological" | "dimensional" | string;
  dimensions: { key: string; label: string }[];
}

/** 兴趣字母筛选胶囊的取值：全部 / 六型 / 未测（旧接口兼容用；新界面用 `AssessmentFilter`） */
export type AssessmentInterestFilter = "all" | RiasecKey | "none";

/** 筛选胶囊顺序：全部、R、I、A、S、E、C、未测（固定顺序，不随数据变化） */
export const ASSESSMENT_INTEREST_FILTERS: ReadonlyArray<{ value: AssessmentInterestFilter; label: string }> = [
  { value: "all", label: "全部" },
  ...RIASEC_KEYS.map((key) => ({ value: key as AssessmentInterestFilter, label: key })),
  { value: "none", label: "未测" },
];

/** 人格筛选方向：偏高 / 偏低（阈值 50，与结果页同一口径） */
export type PersonalityDirection = "high" | "low";

/**
 * 数据列表的「测评筛选」状态（#330）。
 *
 * **联合类型即互斥**：同一时刻只可能是「无筛选 / 兴趣条件 / 人格条件」三者之一，
 * 类型层面就写不出「兴趣 + 人格同时生效」，组件不需要再靠 if 兜。
 */
export type AssessmentFilter =
  | { kind: "none" }
  | ({ kind: "interest" } & ProfileInterestFilter)
  | ({ kind: "personality" } & ProfilePersonalityFilter);

/** 无筛选（默认态） */
export const ASSESSMENT_FILTER_NONE: AssessmentFilter = { kind: "none" };

/** 是否处于「已筛选」状态 */
export function hasAssessmentFilter(filter: AssessmentFilter): boolean {
  return filter.kind !== "none";
}

/** 三字码首位（归型依据）；无码、非 RIASEC 字母返回 null */
export function assessmentLeadOf(code: string | null | undefined): RiasecKey | null {
  if (typeof code !== "string") return null;
  const lead = code.trim().slice(0, 1).toUpperCase();
  return (RIASEC_KEYS as readonly string[]).includes(lead) ? (lead as RiasecKey) : null;
}

/** 该行是否已测（有合法三字码即算已测，不依赖 status 字段） */
export function isAssessed(row: ProfileAssessmentFields): boolean {
  return assessmentLeadOf(row.assessmentCode) !== null;
}

/**
 * 该行是否命中兴趣字母筛选：
 * - `all` 全部通过；
 * - `none` 只留未测（没有合法三字码的行）；
 * - 六型按三字码任意位置是否包含该字母匹配。
 */
export function matchesAssessmentInterest(
  row: ProfileAssessmentFields,
  filter: AssessmentInterestFilter
): boolean {
  if (filter === "all") return true;
  const lead = assessmentLeadOf(row.assessmentCode);
  if (filter === "none") return lead === null;
  return (
    lead !== null &&
    typeof row.assessmentCode === "string" &&
    row.assessmentCode.trim().toUpperCase().includes(filter.toUpperCase())
  );
}

/**
 * 详情条形是否有可画的数据：快照缺失/损坏（解析后为空）时整块条形不渲染——
 * 否则会画出六条 0，比不显示更误导。徽章与完成时间仍照常显示。
 */
export function hasAssessmentScores(row: ProfileAssessmentFields): boolean {
  return Array.isArray(row.assessmentScores) && row.assessmentScores.length > 0;
}

// ─────────────────────────────────────────────────────────────────────────────
// #330 双测评列 + 互斥筛选的视图模型
// ─────────────────────────────────────────────────────────────────────────────

/** 兴趣多选上限（与 `PROFILE_INTEREST_MAX_KEYS` 同口径；这里再导出便于界面提示） */
export const ASSESSMENT_INTEREST_MAX_KEYS = 3;

/** 选中的兴趣字母筛选项：点字母时在「多选集合」里增删，最后一个被取消即回到「全部」 */
export function toggleInterestLetter(filter: AssessmentFilter, key: RiasecKey): AssessmentFilter {
  // 另一类条件（人格）在切换 tab 时由界面清空；这里只处理兴趣自身
  const current = filter.kind === "interest" && filter.mode === "letters" ? filter.keys : [];
  const exists = current.includes(key);
  // 已选满 3 个时再加入新字母不生效（三字码只有 3 位；静默丢弃先选的字母会让老师困惑）
  if (!exists && current.length >= ASSESSMENT_INTEREST_MAX_KEYS) return filter;
  const next = exists ? current.filter((item) => item !== key) : [...current, key];
  const ordered = RIASEC_KEYS.filter((item): item is RiasecKey => next.includes(item));
  if (ordered.length === 0) return ASSESSMENT_FILTER_NONE;
  return { kind: "interest", mode: "letters", keys: ordered };
}

/** 兴趣「未测」筛选（与字母条件互斥，选中即清掉字母） */
export function selectInterestNone(): AssessmentFilter {
  return { kind: "interest", mode: "none" };
}

/** 人格「已测」筛选（任一维度有当前结果） */
export function selectPersonalityAny(): AssessmentFilter {
  return { kind: "personality", mode: "any" };
}

/** 人格「未测」筛选 */
export function selectPersonalityNone(): AssessmentFilter {
  return { kind: "personality", mode: "none" };
}

/**
 * 人格「单维度 + 方向」筛选。
 *
 * 方向由调用方决定：点维度胶囊时传当前方向（切换维度保留方向），点「偏高/偏低」时传新方向；
 * 因此这里不再自作聪明做「保留旧值」的合并——那会让显式切方向失效。
 */
export function selectPersonalityDimension(
  filter: AssessmentFilter,
  key: string,
  dir: PersonalityDirection = "high"
): AssessmentFilter {
  // 同一维度上切换方向时 filter 已是 dimension 模式，方向直接取入参
  void filter;
  return {
    kind: "personality",
    mode: "dimension",
    key: key.toUpperCase(),
    dir,
  };
}

/** 人格维度标签（筛选项与已应用 chip 用；量表明细缺失时回退 key） */
export function personalityDimensionLabel(
  key: string,
  scales: readonly ProfileAssessmentScaleView[]
): string {
  for (const scale of scales) {
    if (scale.scoringMode !== "dimensional") continue;
    const dimension = scale.dimensions.find((item) => item.key === key.toUpperCase());
    if (dimension) return dimension.label;
  }
  return key;
}

/** 找出启用中的「维度型」量表（目前只有 IPIP 大五；多套时以第一套为准，后续再加量表选择） */
export function findDimensionalScale(
  scales: readonly ProfileAssessmentScaleView[]
): ProfileAssessmentScaleView | null {
  return scales.find((scale) => scale.scoringMode === "dimensional") ?? null;
}

/** 找出启用中的霍兰德量表（三字码列用） */
export function findTypologicalScale(
  scales: readonly ProfileAssessmentScaleView[]
): ProfileAssessmentScaleView | null {
  return scales.find((scale) => scale.scoringMode === "typological") ?? null;
}

/** 取某套量表的当前结果；缺失或旧接口无该字段时为 null */
export function scaleResultOf(
  row: ProfileAssessmentFields,
  scaleCode: string | null | undefined
): ProfileScaleResultView | null {
  if (!scaleCode || !row.assessmentResults) return null;
  return row.assessmentResults[scaleCode] ?? null;
}

/**
 * 人格列 Top2 画像（与结果页同一口径）：只认「当前有效 + 快照可用」的结果；
 * 未测或分数快照缺失返回 null（界面画灰胶囊，**不画假的 0 分画像**）。
 */
export function personalityHeadlineOf(
  result: ProfileScaleResultView | null,
  scale: ProfileAssessmentScaleView | null
): string | null {
  if (!result || !scale || result.status !== "completed") return null;
  const scores = result.scores ?? [];
  if (scores.length === 0) return null;
  const headline = buildBigFiveHeadline(
    scores as Parameters<typeof buildBigFiveHeadline>[0],
    scale.dimensions
  );
  return headline || null;
}

/** 人格列的悬停说明：完成时间（未测时为空串，界面走灰胶囊） */
export function personalityTooltipOf(result: ProfileScaleResultView | null): string {
  if (!result || result.status !== "completed") return "人格测评未完成";
  const label = personalityResultLabel(result);
  return result.completedAt ? `${label} · 完成于 ${result.completedAt}` : label;
}

/** 结果状态文案（快照缺失时区分「已测但分数缺失」，避免和未测混为一谈） */
export function personalityResultLabel(result: ProfileScaleResultView): string {
  if (result.status !== "completed") return "未测";
  return result.scores && result.scores.length > 0 ? "已完成" : "已完成（分数快照缺失）";
}

/** 已应用筛选的 chip 文案；无筛选返回 null（界面不渲染 chip） */
export function assessmentFilterChipText(
  filter: AssessmentFilter,
  scales: readonly ProfileAssessmentScaleView[]
): string | null {
  if (filter.kind === "none") return null;
  if (filter.kind === "interest") {
    return filter.mode === "none" ? "兴趣：未测" : `兴趣：${filter.keys.join("·")}（同时包含）`;
  }
  if (filter.mode === "none") return "人格：未测";
  if (filter.mode === "any") return "人格：已测";
  return `人格：${personalityDimensionLabel(filter.key, scales)}${filter.dir === "high" ? "偏高" : "偏低"}`;
}

/** 测评筛选 → 服务端查询参数（互斥由联合类型保证，只会返回其中一个字段） */
export function assessmentFilterToQuery(filter: AssessmentFilter): {
  interest?: ProfileInterestFilter;
  personality?: ProfilePersonalityFilter;
} {
  if (filter.kind === "interest") {
    return filter.mode === "none"
      ? { interest: { mode: "none" } }
      : { interest: { mode: "letters", keys: filter.keys } };
  }
  if (filter.kind === "personality") {
    if (filter.mode === "none") return { personality: { mode: "none" } };
    if (filter.mode === "any") return { personality: { mode: "any" } };
    return { personality: { mode: "dimension", key: filter.key, dir: filter.dir } };
  }
  return {};
}

