/**
 * 数据列表「兴趣测评」列与兴趣字母筛选的展示口径（#234 / #305）。
 *
 * 纯函数、无 IO：组件只负责渲染，判定（有没有测、三字码是否包含所选字母、筛不筛掉这一行）
 * 都在这里并被单测锁住——仓库没有 DOM 测试环境，界面逻辑先落纯函数再测。
 */

import { RIASEC_KEYS, type RiasecKey } from "./assessment-match";

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
}

/** 兴趣字母筛选胶囊的取值：全部 / 六型 / 未测 */
export type AssessmentInterestFilter = "all" | RiasecKey | "none";

/** 筛选胶囊顺序：全部、R、I、A、S、E、C、未测（固定顺序，不随数据变化） */
export const ASSESSMENT_INTEREST_FILTERS: ReadonlyArray<{ value: AssessmentInterestFilter; label: string }> = [
  { value: "all", label: "全部" },
  ...RIASEC_KEYS.map((key) => ({ value: key as AssessmentInterestFilter, label: key })),
  { value: "none", label: "未测" },
];

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
