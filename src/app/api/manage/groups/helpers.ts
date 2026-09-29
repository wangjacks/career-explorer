import type { NextRequest } from "next/server";
import type { UserRow } from "@/lib/db";
import {
  getClassGroupMembers,
  getClassGroups,
  getGroupBatchDetail,
  getGroupBatches,
  getStudents,
} from "@/lib/db";
import { getRequestContext, recordAudit, type AuditActor } from "@/lib/audit";
import {
  FEATURE_SOURCES,
  buildFeatureVectors,
  describeSourceMeta,
  featureLabels,
  type FeatureVector,
} from "@/lib/grouping-features";
import { computeMetrics, computeSimilarities, type GroupingMetrics } from "@/lib/grouping-utils";

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

export interface GroupMemberView {
  userId: number;
  userCode: string;
  name: string;
  avatarUrl: string | null;
  storageId: number;
  /** 按特征源的展示标签（源无关；本期只有 tags） */
  featureLabels: Record<string, string[]>;
}

export interface GroupView {
  groupNo: number;
  memberCount: number;
  /** 组内平均相似度；组内不足 2 人记 null */
  cohesion: number | null;
  members: GroupMemberView[];
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
  sources: { key: string; label: string; kind: string }[];
  groups: GroupView[];
  /** 最近一次自动分组（用于展示「上次自动分组于…」） */
  latestBatch: {
    id: number;
    createdAt: string;
    strategy: string;
    studentCount: number;
    taggedCount: number;
    createdByName: string | null;
    metrics: GroupingMetrics | null;
  } | null;
  /** 与最近一次自动分组的差异处数（含手工调整与名单变动） */
  diffCount: number;
}

/** 该班学生（role=student 且 class_id 命中），已按学号升序 */
export function rosterOf(students: UserRow[], classId: number): UserRow[] {
  return sortRoster(students.filter((s) => s.role === "student" && s.class_id === classId));
}

function memberView(vector: FeatureVector, user: UserRow): GroupMemberView {
  return {
    userId: user.id,
    userCode: user.user_code,
    name: user.name,
    avatarUrl: user.avatar_url,
    storageId: user.storage_id,
    featureLabels: featureLabels(vector, FEATURE_SOURCES),
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
  const vectors = buildFeatureVectors(roster, FEATURE_SOURCES);
  const sim = computeSimilarities(vectors, FEATURE_SOURCES);
  const indexOf = new Map(roster.map((s, i) => [s.id, i]));
  const groupNoById = new Map(classGroups.map((g) => [g.id, g.group_no]));

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

  const groups: GroupView[] = sortedNos.map((no, i) => ({
    groupNo: no,
    memberCount: indexGroups[i].length,
    cohesion: metrics.cohesion[i],
    members: indexGroups[i]
      .map((index) => ({ index, user: roster[index] }))
      .sort((a, b) => (a.user.user_code < b.user.user_code ? -1 : 1))
      .map(({ index, user }) => memberView(vectors[index], user)),
  }));

  // 最近一次自动分组 + 与它的差异（只与最近一批比）
  const latest = batches[0];
  let latestBatch: GroupingView["latestBatch"] = null;
  let diffCount = 0;
  if (latest) {
    let parsedMetrics: GroupingMetrics | null = null;
    try {
      parsedMetrics = latest.metrics ? (JSON.parse(latest.metrics) as GroupingMetrics) : null;
    } catch {
      parsedMetrics = null;
    }
    latestBatch = {
      id: latest.id,
      createdAt: latest.created_at,
      strategy: latest.strategy,
      studentCount: latest.student_count,
      taggedCount: latest.tagged_count,
      createdByName: latest.created_by_name,
      metrics: parsedMetrics,
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
    groups,
    latestBatch,
    diffCount,
  };
}
