import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { applyGroupingResult, getStudents } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, canModifyClass } from "../classes/helpers";
import { buildFeatureVectors } from "@/lib/grouping-features";
import { GROUP_SIZE_CAP, buildGrouping, computeGroupSizes } from "@/lib/grouping-utils";
import { loadAssessmentFeatureContext } from "@/lib/grouping-assessment";
import {
  actorOf,
  buildGroupingView,
  describeBatchSources,
  groupFailureWriter,
  metricsForAppliedGroups,
  normalizeAppliedGroups,
  parseJsonBody,
  parseStrategy,
  parseVariant,
  parseWeights,
  rosterOf,
  sourcesForStrategy,
} from "./helpers";

const GENERATE_AUDIT = {
  action: "group:generate",
  method: "POST",
  path: "/api/manage/groups",
  resource_type: "group-batch",
} as const;

/** GET：读某班当前分组 + 指标 + 与最近一次自动分组的差异（**读不限班级**，教师可查看全校） */
async function GET_impl(request: NextRequest) {
  try {
    const classId = Number(request.nextUrl.searchParams.get("classId"));
    if (!Number.isInteger(classId) || classId <= 0) {
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }
    const view = await buildGroupingView(classId);
    return NextResponse.json(view);
  } catch (err) {
    console.error("Groups GET error:", err);
    return NextResponse.json({ error: "获取分组失败" }, { status: 500 });
  }
}

/**
 * POST：应用分组（#345）。
 *
 * 两种入参：
 * - 只给 `classId`（+ 可选 strategy / weights / variant）：服务端按策略生成（默认「兴趣相近 + 性格互补」）；
 * - 带 `groups`（预览里换过人 / 设过组长的那一份）：服务端**重新校验**（本班、不重不漏、≤5 人、组间差 ≤1、组长本组），
 *   并按当前数据重算指标后落库——客户端传来的指标一律不信。
 *
 * 语义是**完全覆盖**当前分组（手工调整不可恢复），并追加一份历史批次归档；
 * 两步必须在同一事务内完成，否则中途失败会留下「当前已覆盖但没有归档」的不一致态。
 */
async function POST_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  // 覆盖式写操作的失败与被拒也要留痕（AGENTS.md：管理域写操作成败均记）
  const fail = groupFailureWriter(request, GENERATE_AUDIT);
  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await parseJsonBody<{
      classId?: unknown;
      strategy?: unknown;
      weights?: unknown;
      variant?: unknown;
      groups?: unknown;
    }>(request);
    if (!body) {
      fail(session, "请求体不是合法 JSON");
      return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
    }
    const classId = Number(body.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      fail(session, "缺少或无效的 classId", { classId: body.classId });
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }
    // 写操作限教师所带班级（admin 全量）；与班级改名等既有写端点共用同一判定
    if (!(await canModifyClass(session, classId))) {
      fail(session, "无权对该班级分组", { classId });
      return NextResponse.json({ error: "无权对该班级分组" }, { status: 403 });
    }

    const strategy = parseStrategy(body.strategy);
    if (!strategy) {
      fail(session, "未知的分组策略", { classId, strategy: body.strategy });
      return NextResponse.json({ error: "未知的分组策略" }, { status: 400 });
    }
    const weights = parseWeights(body.weights);
    if (!weights) {
      fail(session, "权重必须是 0–1 的数字", { classId, weights: body.weights });
      return NextResponse.json({ error: "权重必须是 0–1 的数字" }, { status: 400 });
    }
    const variant = parseVariant(body.variant);
    if (variant === null) {
      fail(session, "variant 必须是非负整数", { classId, variant: body.variant });
      return NextResponse.json({ error: "variant 必须是非负整数" }, { status: 400 });
    }

    const roster = rosterOf(await getStudents(), classId);
    if (roster.length === 0) {
      fail(session, "该班没有学生，无法分组", { classId });
      return NextResponse.json({ error: "该班没有学生，无法分组" }, { status: 400 });
    }

    // 分组依赖的测评上下文：读取失败只让「兴趣/性格」源降级（策略退化），不阻断分组
    const loaded = await loadAssessmentFeatureContext(roster);
    const sources = sourcesForStrategy(strategy, weights);
    const vectors = buildFeatureVectors(roster, sources, { assessments: loaded.context });

    // 预览提交上来的分组优先（含手工换人 / 组长）；没给就服务端按策略生成
    const appliedInput = body.groups !== undefined ? normalizeAppliedGroups(body.groups, roster) : null;
    if (appliedInput && !appliedInput.ok) {
      fail(session, appliedInput.error, { classId });
      return NextResponse.json({ error: appliedInput.error }, { status: 400 });
    }
    const generated = appliedInput ? null : buildGrouping(vectors, sources, { strategy, variant });
    const appliedGroups =
      appliedInput?.groups ??
      generated!.groups.map((indexes, i) => ({
        groupNo: i + 1,
        userIds: indexes.map((index) => generated!.vectors[index].studentId),
        leaderUserId: null,
      }));

    // 指标用「实际要落库的分组」重算（预览可能被教师换过人，不能沿用预览的指标）
    const metrics = metricsForAppliedGroups(appliedGroups, vectors, strategy, sources);
    const userById = new Map(roster.map((student) => [student.id, student]));
    const groupsSql = appliedGroups.map((group) => ({
      group_no: group.groupNo,
      user_ids: group.userIds,
      leader_user_id: group.leaderUserId,
    }));
    const batch = {
      classId,
      strategy,
      featureSources: describeBatchSources(sources),
      groupSize: GROUP_SIZE_CAP,
      studentCount: roster.length,
      taggedCount: metrics.coveredCount,
      metrics: JSON.stringify(metrics),
      actorId: session.uid ?? null,
      actorName: session.name ?? null,
      actorRole: session.role ?? null,
      groups: appliedGroups.map((group, i) => ({
        groupNo: group.groupNo,
        cohesion: metrics.cohesion[i] ?? null,
        leaderUserId: group.leaderUserId,
        members: group.userIds.map((userId) => {
          const user = userById.get(userId);
          return {
            userId,
            userCode: user?.user_code ?? null,
            name: user?.name ?? null,
          };
        }),
      })),
    };

    const batchId = await applyGroupingResult(classId, groupsSql, batch);
    void recordAudit({
      ...actorOf(session),
      ...GENERATE_AUDIT,
      resource_id: String(batchId),
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: {
        classId,
        strategy,
        variant,
        weights,
        groupCount: appliedGroups.length,
        expectedGroupCount: computeGroupSizes(roster.length).length,
        studentCount: roster.length,
        coveredCount: metrics.coveredCount,
        untestedCount: metrics.untestedCount ?? null,
        roleCoverageAverage: metrics.roleCoverageAverage ?? null,
        nonZeroPairs: metrics.nonZeroPairs,
        overall: Number(metrics.overall.toFixed(6)),
        baselineSequence: Number(metrics.baselines.sequence.toFixed(6)),
        baselineRandom: Number(metrics.baselines.random.toFixed(6)),
        activeSourceKeys: metrics.activeSourceKeys,
        fromPreview: appliedInput !== null,
        leaderCount: appliedGroups.filter((group) => group.leaderUserId != null).length,
        assessmentDegraded: loaded.degraded,
      },
    });

    return NextResponse.json({
      ok: true,
      batchId,
      // #346 起「应用分组」会同时创建学生端小组工作区；本 issue 先返回 null，等 #346 提供接口后接线
      workspaceId: null,
      view: await buildGroupingView(classId),
    });
  } catch (err) {
    console.error("Groups POST error:", err);
    fail(session, err instanceof Error ? err.message : "自动分组失败");
    return NextResponse.json({ error: "自动分组失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
export const POST = withDemoScope(POST_impl);