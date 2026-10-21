import type { NextRequest } from "next/server";
import type { UserRow } from "@/lib/db";
import {
  getClasses,
  getClassGroupMembers,
  getClassGroups,
  getGroupBatchDetail,
  getGroupBatches,
  getStudents,
} from "@/lib/db";
import { getRequestContext, recordAudit, type AuditActor } from "@/lib/audit";
import {
  FEATURE_SOURCES,
  TAG_ONLY_SOURCES,
  buildFeatureVectors,
  coverageBySource,
  describeSourceMeta,
  describeSources,
  dominantRiasecOf,
  featureLabels,
  rolesOf,
  roleLabelOf,
  untestedAssessmentCount,
  withWeights,
  type FeatureSourceDef,
  type FeatureVector,
} from "@/lib/grouping-features";
import {
  DEFAULT_GROUPING_STRATEGY,
  GROUPING_STRATEGIES,
  GROUP_SIZE_CAP,
  ROLE_COVERAGE_TARGET,
  buildGrouping,
  computeGroupSizes,
  computeMetrics,
  computeSimilarities,
  groupingStrategyLabel,
  isGroupingStrategyKey,
  type GroupingMetrics,
} from "@/lib/grouping-utils";
import { loadAssessmentFeatureContext, type AssessmentFeatureAvailability } from "@/lib/grouping-assessment";
import { RIASEC_KEYS, type RiasecKey } from "@/lib/assessment-match";

/** 名单排序与算法内部一致（学号升序，学号相同再按 id），保证下标对齐与结果可复现 */
export function sortRoster(students: UserRow[]): UserRow[] {
  return [...students].sort((a, b) => {
    if (a.user_code !== b.user_code) return a.user_code < b.user_code ? -1 : 1;
    return a.id - b.id;
  });
}

/** getSession() 的会话形状（结构类型，helpers 不依赖认证模块的具体签名） */
type SessionLike = { uid?: number | null; name?: string | null; role?: string | null } | null | undefined;

/** 会话 → 操作者快照；token 载荷不含 user_code，这里不做额外查库 */
export function actorOf(session: SessionLike): AuditActor {
  return {
    actor_id: session?.uid ?? null,
    actor_user_code: null,
    actor_name: session?.name ?? null,
    actor_role: session?.role ?? null,
  };
}

/**
 * 失败路径的审计写入器（AGENTS.md：管理域写操作成败均记）。
 * 每个请求建一次，action/method/path/resource_type 固定，调用处只给错误原因与定位信息。
 */
export function groupFailureWriter(
  request: NextRequest,
  entry: { action: string; method: string; path: string; resource_type: string }
): (session: SessionLike, error: string, metadata?: unknown) => void {
  const { ip, user_agent } = getRequestContext(request);
  return (session, error, metadata = null) => {
    void recordAudit({
      ...actorOf(session),
      ...entry,
      resource_id: null,
      status: "failed",
      error_message: error,
      ip,
      user_agent,
      metadata,
    });
  };
}

/* ---------- 视图（#101 / #345） ---------- */

export interface GroupMemberRoleView {
  key: string;
  label: string;
}

export interface GroupMemberView {
  userId: number;
  userCode: string;
  name: string;
  avatarUrl: string | null;
  storageId: number;
  /** 按特征源的展示标签（源无关；标签源=标签名，兴趣源=主导型，性格源=角色） */
  featureLabels: Record<string, string[]>;
  /** 主导兴趣型（#345；无兴趣结果时 null） */
  dominantType: RiasecKey | null;
  /** 命中的角色（大五 C/E/O/A 高维映射，仅用于分组决策展示） */
  roles: GroupMemberRoleView[];
}

export interface GroupView {
  groupNo: number;
  memberCount: number;
  /** 组内平均相似度；组内不足 2 人记 null */
  cohesion: number | null;
  /** 组长（#345）：未设置为 null */
  leaderUserId: number | null;
  leaderName: string | null;
  /** 组内角色覆盖数（0–4） */
  roleCoverage: number;
  /** 主型（A 策略的配额；当前分组不记录，界面按成员主导型汇总展示） */
  primaryType: RiasecKey | null;
  members: GroupMemberView[];
}

export interface GroupingBatchView {
  id: number;
  createdAt: string;
  strategy: string;
  strategyLabel: string;
  studentCount: number;
  taggedCount: number;
  createdByName: string | null;
  metrics: GroupingMetrics | null;
  /** 批次头记录的特征源（含权重与版本）；解析失败为 null */
  featureSources: { key: string; kind: string; weight: number; version?: string }[] | null;
}

export interface GroupingView {
  hasGrouping: boolean;
  /** 该班学生数（参与分组的人数） */
  studentCount: number;
  /** 有特征的学生数（覆盖率分子） */
  coveredCount: number;
  nonZeroPairs: number;
  totalPairs: number;
  overall: number;
  baselines: { sequence: number; random: number };
  activeSourceKeys: string[];
  /** 源的展示元信息：界面据此说明「按什么分组」 */
  sources: { key: string; label: string; kind: string; version: string }[];
  /** 三种策略（界面选择器用；含默认标记） */
  strategies: typeof GROUPING_STRATEGIES;
  defaultStrategy: string;
  /** 分源覆盖率（标签 / 兴趣 / 性格） */
  coverageBySource: { key: string; label: string; covered: number; total: number }[];
  /** 兴趣与性格都没做的学生数 */
  untestedCount: number;
  /** 两组角色覆盖均值 / 目标（界面指标卡） */
  roleCoverageAverage: number;
  roleCoverageTarget: number;
  /** 本班两套测评数据是否可读（某套失败时该策略退化到可用源） */
  assessmentAvailable: AssessmentFeatureAvailability;
  /** 当前分组每组角色覆盖（与 groups 下标一致） */
  groups: GroupView[];
  /**
   * 本班还没进组的学生（自动分组之后新转入、批量导入漏填组号都会落到这里）。
   * 界面必须列出他们并给「移动」入口，否则这个缺口只能靠重新自动分组来补，而那会覆盖手工调整。
   */
  ungrouped: GroupMemberView[];
  /** 最近一次自动分组（用于展示「上次自动分组于…」） */
  latestBatch: GroupingBatchView | null;
  /** 与最近一次自动分组的差异处数（含手工调整与名单变动） */
  diffCount: number;
}

/** 该班学生（role=student 且 class_id 命中），已按学号升序 */
export function rosterOf(students: UserRow[], classId: number): UserRow[] {
  return sortRoster(students.filter((s) => s.role === "student" && s.class_id === classId));
}

/** 组号上限：一个班不可能有几百组；同时避免超大组号落进 `group_no INT` 的取值范围之外（两库对越界整数的处理不同） */
export const MAX_GROUP_NO = 999;

/**
 * 班级是否存在。传一个不存在的 classId 时两库都会因外键被拒，但那只是 500 + 一句驱动原文；
 * 路由内先查一次，给出可读的 404，并让两库的响应码与文案对齐。
 */
export async function classExists(classId: number): Promise<boolean> {
  return (await getClasses()).some((c) => c.id === classId);
}

/**
 * 解析 JSON 请求体；非法 JSON 属客户端错误，按 400 处理而不是冒 500。
 * （`/api/manage/*` 其余端点沿用「body 解析异常 → 外层 catch → 500」的旧行为，新代码不再复制它。）
 */
export async function parseJsonBody<T = Record<string, unknown>>(request: NextRequest): Promise<T | null> {
  try {
    return (await request.json()) as T;
  } catch {
    return null;
  }
}

/** 解析入库的 metrics JSON（批次回看 / 当前指标共用；损坏返回 null） */
export function parseMetrics(raw: string | null): GroupingMetrics | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as GroupingMetrics;
    return parsed && typeof parsed === "object" ? parsed : null;
  } catch {
    return null;
  }
}

/** 解析入库的 feature_sources JSON（批次头；损坏返回 null） */
export function parseFeatureSources(raw: string | null): GroupingBatchView["featureSources"] {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as { key: string; kind: string; weight: number; version?: string }[];
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function memberView(vector: FeatureVector, user: UserRow): GroupMemberView {
  const dominantType = dominantRiasecOf(vector);
  return {
    userId: user.id,
    userCode: user.user_code,
    name: user.name,
    avatarUrl: user.avatar_url,
    storageId: user.storage_id,
    featureLabels: featureLabels(vector, FEATURE_SOURCES),
    dominantType,
    roles: rolesOf(vector).map((role) => ({ key: role, label: roleLabelOf(role) })),
  };
}

/** 读当前分组并算出全部展示所需指标（源无关） */
export async function buildGroupingView(classId: number): Promise<GroupingView> {
  const [students, classGroups, links, batches] = await Promise.all([
    getStudents(),
    getClassGroups(classId),
    getClassGroupMembers(classId),
    getGroupBatches(classId),
  ]);

  const roster = rosterOf(students, classId);
  // #345：测评上下文只影响「分组依据展示 / 角色覆盖」，读失败时降级为只有标签
  const loaded = await loadAssessmentFeatureContext(roster);
  const vectors = buildFeatureVectors(roster, FEATURE_SOURCES, { assessments: loaded.context });
  const sim = computeSimilarities(vectors, FEATURE_SOURCES);
  const indexOf = new Map(roster.map((s, i) => [s.id, i]));
  const groupNoById = new Map(classGroups.map((g) => [g.id, g.group_no]));
  const leaderByNo = new Map(classGroups.map((g) => [g.group_no, g.leader_user_id]));

  const membersByNo = new Map<number, number[]>();
  for (const g of classGroups) membersByNo.set(g.group_no, []);
  for (const link of links) {
    const groupNo = groupNoById.get(link.group_id);
    const index = indexOf.get(link.user_id);
    if (groupNo === undefined || index === undefined) continue;
    membersByNo.get(groupNo)?.push(index);
  }

  const sortedNos = [...membersByNo.keys()].sort((a, b) => a - b);
  const indexGroups = sortedNos.map((no) => (membersByNo.get(no) ?? []).sort((a, b) => a - b));
  const metrics = computeMetrics(indexGroups, sim, vectors, FEATURE_SOURCES);

  const groups: GroupView[] = sortedNos.map((no, i) => {
    const members = indexGroups[i]
      .map((index) => ({ index, user: roster[index] }))
      .sort((a, b) => (a.user.user_code < b.user.user_code ? -1 : 1))
      .map(({ index, user }) => memberView(vectors[index], user));
    const leaderUserId = leaderByNo.get(no) ?? null;
    // 主导型汇总：按成员主导型出现次数取最多（平局按 RIASEC 顺序），只用于界面说明
    const typeCounts = new Map<RiasecKey, number>();
    for (const index of indexGroups[i]) {
      const dominant = dominantRiasecOf(vectors[index]);
      if (dominant) typeCounts.set(dominant, (typeCounts.get(dominant) ?? 0) + 1);
    }
    const primaryType =
      [...typeCounts.entries()].sort((a, b) => b[1] - a[1] || RIASEC_KEYS.indexOf(a[0]) - RIASEC_KEYS.indexOf(b[0]))[0]?.[0] ??
      null;
    return {
      groupNo: no,
      memberCount: indexGroups[i].length,
      cohesion: metrics.cohesion[i] ?? null,
      leaderUserId,
      leaderName: leaderUserId == null ? null : members.find((m) => m.userId === leaderUserId)?.name ?? null,
      roleCoverage: metrics.roleCoverage?.[i] ?? 0,
      primaryType,
      members,
    };
  });

  // 最近一次自动分组 + 与它的差异（只与最近一批比）
  const latest = batches[0];
  let latestBatch: GroupingBatchView | null = null;
  let diffCount = 0;
  if (latest) {
    latestBatch = {
      id: latest.id,
      createdAt: latest.created_at,
      strategy: latest.strategy,
      strategyLabel: groupingStrategyLabel(latest.strategy),
      studentCount: latest.student_count,
      taggedCount: latest.tagged_count,
      createdByName: latest.created_by_name,
      metrics: parseMetrics(latest.metrics),
      featureSources: parseFeatureSources(latest.feature_sources),
    };
    const detail = await getGroupBatchDetail(latest.id);
    const batchGroupNo = new Map(detail.groups.map((g) => [g.id, g.group_no]));
    const previous = new Map<number, number>();
    for (const m of detail.members) {
      const no = batchGroupNo.get(m.group_id);
      if (no !== undefined) previous.set(m.user_id, no);
    }
    const current = new Map<number, number>();
    for (const link of links) {
      const no = groupNoById.get(link.group_id);
      if (no !== undefined) current.set(link.user_id, no);
    }
    for (const [userId, no] of current) if (previous.get(userId) !== no) diffCount += 1;
    for (const userId of previous.keys()) if (!current.has(userId)) diffCount += 1;
  }

  // 未进组的学生：全班减去所有组里的 id（组里挂着已转走/已删除的学生时不会误判）
  const groupedIds = new Set<number>();
  for (const indexes of indexGroups) for (const index of indexes) groupedIds.add(index);
  const ungrouped: GroupMemberView[] = roster
    .map((user, index) => ({ user, index }))
    .filter(({ index }) => !groupedIds.has(index))
    .map(({ user, index }) => memberView(vectors[index], user));

  return {
    hasGrouping: classGroups.length > 0,
    studentCount: metrics.studentCount,
    coveredCount: metrics.coveredCount,
    nonZeroPairs: metrics.nonZeroPairs,
    totalPairs: metrics.totalPairs,
    overall: metrics.overall,
    baselines: metrics.baselines,
    activeSourceKeys: metrics.activeSourceKeys,
    sources: describeSourceMeta(FEATURE_SOURCES),
    strategies: GROUPING_STRATEGIES,
    defaultStrategy: DEFAULT_GROUPING_STRATEGY,
    coverageBySource: coverageBySource(vectors, FEATURE_SOURCES),
    untestedCount: untestedAssessmentCount(vectors),
    roleCoverageAverage:
      metrics.roleCoverageAverage ?? 0,
    roleCoverageTarget: ROLE_COVERAGE_TARGET,
    assessmentAvailable: loaded.available,
    groups,
    ungrouped,
    latestBatch,
    diffCount,
  };
}

/* ---------- 预览（#345：不落库） ---------- */

/** 预览入参（已校验/归一化）：策略 + 可选权重 + 确定性变体 + 换人后的分组 */
export interface PreviewOptions {
  strategy: string;
  weights?: Record<string, number> | null;
  variant: number;
  /** 预览里换人后提交的分组（未校验）：给出时按它重算指标，不再重新分配 */
  groups?: unknown;
}

export interface PreviewGroupView {
  groupNo: number;
  memberCount: number;
  cohesion: number | null;
  /** 主型（A/B 策略按主导型分配的配额；C 为成员主导型出现最多者） */
  primaryType: RiasecKey | null;
  /** 角色覆盖数（0–4） */
  roleCoverage: number;
  /** 建议组长：默认选角色覆盖最多的成员（可被教师改选）；未设置时为 null */
  suggestedLeaderUserId: number | null;
  members: GroupMemberView[];
}

export interface GroupingPreview {
  strategy: string;
  strategyLabel: string;
  variant: number;
  /** 实际参与计算的源（含权重；标签源可能因缺测评自动降级） */
  sources: { key: string; label: string; kind: string; weight: number }[];
  coverageBySource: { key: string; label: string; covered: number; total: number }[];
  untestedCount: number;
  assessmentAvailable: AssessmentFeatureAvailability;
  degraded: string[];
  studentCount: number;
  groupSize: number;
  expectedGroupCount: number;
  roleCoverageTarget: number;
  metrics: GroupingMetrics;
  groups: PreviewGroupView[];
}

/** 策略是否需要测评源（C 只用标签） */
export function isAssessmentStrategy(strategy: string): boolean {
  return strategy !== "idf-cosine";
}

/** 按策略挑特征源：A/B 用「标签 + 兴趣 + 性格」（缺测评的源会被 activeSources 自动剔除），C 只用标签 */
export function sourcesForStrategy(strategy: string, weights: Record<string, number> | null): FeatureSourceDef[] {
  if (!isAssessmentStrategy(strategy)) return TAG_ONLY_SOURCES;
  return withWeights(weights, FEATURE_SOURCES);
}

/** 归一化策略入参：缺失 → 默认策略；非法 → null（路由给 400） */
export function parseStrategy(value: unknown): string | null {
  if (value === undefined || value === null || value === "") return DEFAULT_GROUPING_STRATEGY;
  if (typeof value !== "string" || !isGroupingStrategyKey(value)) return null;
  return value;
}

/** 归一化权重入参：只接受 0–1 的数字，未知 key 忽略；非法值返回 null（路由给 400） */
export function parseWeights(value: unknown): Record<string, number> | null {
  if (value === undefined || value === null) return {};
  if (typeof value !== "object" || Array.isArray(value)) return null;
  const out: Record<string, number> = {};
  for (const source of FEATURE_SOURCES) {
    const raw = (value as Record<string, unknown>)[source.key];
    if (raw === undefined) continue;
    if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0 || raw > 1) return null;
    out[source.key] = raw;
  }
  return out;
}

/** 归一化变体号：0–99 的非负整数（超出按 99 钳制；非整数返回 null） */
export function parseVariant(value: unknown): number | null {
  if (value === undefined || value === null || value === "") return 0;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0) return null;
  return Math.min(value, 99);
}

export type GroupingPreviewResult =
  | { ok: true; preview: GroupingPreview }
  | { ok: false; error: string };

/**
 * 生成分组预览（**不写库**）。
 *
 * 与「应用」共用同一套算法/口径：教师在预览里看到的指标就是应用后批次归档的指标。
 * 换人后前端把新分组提交回来，这里用与「应用」相同的校验与指标口径重算——
 * 原始测评分不下发客户端，客户端算不出也不该算这些数。
 */
export async function buildGroupingPreview(
  classId: number,
  options: PreviewOptions
): Promise<GroupingPreviewResult> {
  const roster = rosterOf(await getStudents(), classId);
  if (roster.length === 0) return { ok: false, error: "该班没有学生，无法分组" };

  const loaded = await loadAssessmentFeatureContext(roster);
  const sources = sourcesForStrategy(options.strategy, options.weights ?? null);
  const vectors = buildFeatureVectors(roster, sources, { assessments: loaded.context });
  const result = buildGrouping(vectors, sources, { strategy: options.strategy, variant: options.variant });

  let applied: AppliedGroupInput[] | null = null;
  if (options.groups !== undefined && options.groups !== null) {
    const normalized = normalizeAppliedGroups(options.groups, roster);
    if (!normalized.ok) return { ok: false, error: normalized.error };
    applied = normalized.groups;
  }
  const metrics = applied
    ? metricsForAppliedGroups(applied, result.vectors, options.strategy, sources)
    : result.metrics;
  const indexByUserId = new Map(result.vectors.map((vector, index) => [vector.studentId, index]));
  const layout = applied
    ? applied.map((group) => ({
        groupNo: group.groupNo,
        indexes: group.userIds
          .map((userId) => indexByUserId.get(userId))
          .filter((index): index is number => index !== undefined)
          .sort((a, b) => a - b),
      }))
    : result.groups.map((indexes, i) => ({ groupNo: i + 1, indexes }));
  // 主型是算法分配的主型配额，不是成员属性的汇总：重算指标时按组号沿用同一份确定性候选的结果
  const basePrimaryByNo = new Map(result.groups.map((_, i) => [i + 1, result.primaryTypes[i] ?? null]));

  const groups: PreviewGroupView[] = layout.map((group, i) => {
    const members = group.indexes
      .map((index) => ({ index, user: roster[index] }))
      .sort((a, b) => (a.user.user_code < b.user.user_code ? -1 : 1))
      .map(({ index, user }) => memberView(result.vectors[index], user));
    const roleCoverage = metrics.roleCoverage?.[i] ?? 0;
    // 建议组长：命中角色最多者（同分取组内学号最小），教师可改
    let suggested: number | null = null;
    let bestRoles = -1;
    for (const member of members) {
      if (member.roles.length > bestRoles) {
        bestRoles = member.roles.length;
        suggested = member.userId;
      }
    }
    return {
      groupNo: group.groupNo,
      memberCount: group.indexes.length,
      cohesion: metrics.cohesion[i] ?? null,
      primaryType: applied
        ? basePrimaryByNo.get(group.groupNo) ?? null
        : result.primaryTypes[i] ?? null,
      roleCoverage,
      suggestedLeaderUserId: suggested,
      members,
    };
  });

  return {
    ok: true,
    preview: {
      strategy: options.strategy,
      strategyLabel: groupingStrategyLabel(options.strategy),
      variant: options.variant,
      sources: sources.map((s) => ({ key: s.key, label: s.label, kind: s.kind, weight: s.weight })),
      coverageBySource: coverageBySource(result.vectors, sources),
      untestedCount: untestedAssessmentCount(result.vectors),
      assessmentAvailable: loaded.available,
      degraded: loaded.degraded,
      studentCount: roster.length,
      groupSize: GROUP_SIZE_CAP,
      expectedGroupCount: computeGroupSizes(roster.length).length,
      roleCoverageTarget: ROLE_COVERAGE_TARGET,
      metrics,
      groups,
    },
  };
}

/* ---------- 应用（#345：校验提交上来的分组） ---------- */

export interface AppliedGroupInput {
  groupNo: number;
  userIds: number[];
  leaderUserId: number | null;
}

export type NormalizeGroupsResult =
  | { ok: true; groups: AppliedGroupInput[] }
  | { ok: false; error: string };

/**
 * 校验客户端提交的分组（预览里做过换人 / 设组长的那一份）：
 * - 组号为 1..999 的正整数且不重复；
 * - 人数 ≤ 5 且组间人数差 ≤ 1（与算法同一规模规则，手工越界由「移动成员」单独承担）；
 * - 学生不重不漏，且全部属于本班（以名单为准，不信客户端）；
 * - 组长必须是本组成员。
 */
export function normalizeAppliedGroups(input: unknown, roster: UserRow[]): NormalizeGroupsResult {
  if (!Array.isArray(input) || input.length === 0) return { ok: false, error: "分组不能为空" };
  const rosterIds = new Set(roster.map((s) => s.id));
  const seenUsers = new Set<number>();
  const seenGroupNos = new Set<number>();
  const groups: AppliedGroupInput[] = [];

  for (let i = 0; i < input.length; i += 1) {
    const raw = input[i];
    if (typeof raw !== "object" || raw === null) return { ok: false, error: `第 ${i + 1} 组格式错误` };
    const item = raw as Record<string, unknown>;
    const groupNo = Number(item.groupNo);
    if (!Number.isInteger(groupNo) || groupNo <= 0 || groupNo > MAX_GROUP_NO) {
      return { ok: false, error: `第 ${i + 1} 组的组号无效` };
    }
    if (seenGroupNos.has(groupNo)) return { ok: false, error: `组号 ${groupNo} 重复` };
    seenGroupNos.add(groupNo);
    if (!Array.isArray(item.userIds)) return { ok: false, error: `第 ${groupNo} 组缺少成员` };
    const userIds: number[] = [];
    for (const value of item.userIds) {
      const userId = Number(value);
      if (!Number.isInteger(userId) || !rosterIds.has(userId)) {
        return { ok: false, error: `第 ${groupNo} 组包含非本班学生` };
      }
      if (seenUsers.has(userId)) return { ok: false, error: "同一学生不能出现在多个组" };
      seenUsers.add(userId);
      userIds.push(userId);
    }
    const leaderRaw = item.leaderUserId;
    const leaderUserId = leaderRaw === undefined || leaderRaw === null ? null : Number(leaderRaw);
    if (leaderUserId !== null && (!Number.isInteger(leaderUserId) || !userIds.includes(leaderUserId))) {
      return { ok: false, error: `第 ${groupNo} 组的组长必须是本组成员` };
    }
    groups.push({ groupNo, userIds, leaderUserId });
  }

  if (seenUsers.size !== rosterIds.size) {
    return { ok: false, error: "分组必须包含本班全部学生（名单在预览后发生变化，请重新生成）" };
  }
  const sizes = groups.map((g) => g.userIds.length);
  if (sizes.some((size) => size > GROUP_SIZE_CAP)) {
    return { ok: false, error: `每组最多 ${GROUP_SIZE_CAP} 人` };
  }
  if (Math.max(...sizes) - Math.min(...sizes) > 1) {
    return { ok: false, error: "各组人数差距不能超过 1 人" };
  }
  return { ok: true, groups };
}

/** 用「应用时提交的分组」重算指标（日志/批次归档与预览同口径，但不信客户端算的数） */
export function metricsForAppliedGroups(
  groups: AppliedGroupInput[],
  vectors: FeatureVector[],
  strategy: string,
  sources: FeatureSourceDef[]
): GroupingMetrics {
  const indexByUserId = new Map(vectors.map((v, index) => [v.studentId, index]));
  const indexGroups = groups.map((g) =>
    g.userIds
      .map((userId) => indexByUserId.get(userId))
      .filter((index): index is number => index !== undefined)
      .sort((a, b) => a - b)
  );
  const sim = computeSimilarities(vectors, sources);
  return computeMetrics(indexGroups, sim, vectors, sources, strategy);
}

/** 批次头特征源 JSON（含权重与版本；与 `describeSources` 同一口径） */
export function describeBatchSources(sources: FeatureSourceDef[]): string {
  return describeSources(sources);
}
