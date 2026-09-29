import { NextRequest, NextResponse } from "next/server";
import { applyGroupingResult, getStudents } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, canModifyClass } from "../classes/helpers";
import { buildFeatureVectors, describeSources } from "@/lib/grouping-features";
import { GROUP_SIZE_CAP, GROUPING_STRATEGY, buildGrouping } from "@/lib/grouping-utils";
import { buildGroupingView, rosterOf } from "./helpers";

/** GET：读某班当前分组 + 指标 + 与最近一次自动分组的差异（**读不限班级**，教师可查看全校） */
export async function GET(request: NextRequest) {
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
 * POST：触发自动分组。
 * 语义是**完全覆盖**当前分组（手工调整不可恢复），并追加一份历史批次归档；
 * 两步必须在同一事务内完成，否则中途失败会留下「当前已覆盖但没有归档」的不一致态。
 */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as { classId?: unknown };
    const classId = Number(body.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }
    // 写操作限教师所带班级（admin 全量）；与班级改名等既有写端点共用同一判定
    if (!(await canModifyClass(session, classId))) {
      return NextResponse.json({ error: "无权对该班级分组" }, { status: 403 });
    }

    const roster = rosterOf(await getStudents(), classId);
    if (roster.length === 0) {
      return NextResponse.json({ error: "该班没有学生，无法分组" }, { status: 400 });
    }

    const result = buildGrouping(buildFeatureVectors(roster));
    const groups = result.groups.map((indexes, i) => ({
      group_no: i + 1,
      user_ids: indexes.map((index) => result.vectors[index].studentId),
    }));
    const batch = {
      classId,
      strategy: GROUPING_STRATEGY,
      featureSources: describeSources(),
      groupSize: GROUP_SIZE_CAP,
      studentCount: result.metrics.studentCount,
      taggedCount: result.metrics.coveredCount,
      metrics: JSON.stringify(result.metrics),
      actorId: session.uid ?? null,
      actorName: session.name ?? null,
      actorRole: session.role ?? null,
      groups: result.groups.map((indexes, i) => ({
        groupNo: i + 1,
        cohesion: result.metrics.cohesion[i],
        members: indexes.map((index) => ({
          userId: result.vectors[index].studentId,
          userCode: result.vectors[index].userCode,
          name: roster.find((s) => s.id === result.vectors[index].studentId)?.name ?? null,
        })),
      })),
    };

    const batchId = await applyGroupingResult(classId, groups, batch);
    void recordAudit({
      actor_id: session.uid ?? null, actor_user_code: null, actor_name: session.name ?? null, actor_role: session.role ?? null,
      action: "group:generate", method: "POST", path: "/api/manage/groups",
      resource_type: "group-batch", resource_id: String(batchId),
      status: "success", error_message: null, ip, user_agent,
      metadata: {
        classId,
        groupCount: groups.length,
        studentCount: result.metrics.studentCount,
        coveredCount: result.metrics.coveredCount,
        nonZeroPairs: result.metrics.nonZeroPairs,
        overall: Number(result.metrics.overall.toFixed(6)),
        baselineSequence: Number(result.metrics.baselines.sequence.toFixed(6)),
        baselineRandom: Number(result.metrics.baselines.random.toFixed(6)),
        activeSourceKeys: result.metrics.activeSourceKeys,
      },
    });

    return NextResponse.json({ ok: true, batchId, view: await buildGroupingView(classId) });
  } catch (err) {
    console.error("Groups POST error:", err);
    return NextResponse.json({ error: "自动分组失败" }, { status: 500 });
  }
}
