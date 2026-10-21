import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getSubmittedProfiles,
  clearSubmissions,
  getEnabledAssessments,
  getCurrentAssessmentResultsByUserCodes,
  type AssessmentResultSummary,
  type AssessmentRow,
} from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { parseDimensions, parseScores } from "@/lib/assessment-flow";
import { assessmentLeadOf } from "@/lib/profile-assessment";
import type {
  ProfileAssessmentScaleView,
  ProfileScaleResultView,
} from "@/lib/profile-assessment";
import {
  parseProfilesQuery,
  type ProfileListQuery,
  type ResolvedProfileListQuery,
} from "@/lib/profile-query";

/** 启用量表行 → 下发结构（列定义与维度标签的唯一来源，前端不写死量表） */
function toScaleView(row: AssessmentRow): ProfileAssessmentScaleView {
  return {
    code: row.code,
    name: row.name,
    scoringMode: row.scoring_mode,
    dimensions: parseDimensions(row.dimensions_json).map(({ key, label }) => ({ key, label })),
  };
}

/**
 * 单行单量表的「当前有效结果」（#330）。
 *
 * - 有当前结果才可能是 completed；无结果一律 none（与旧接口 summary 字段同口径）；
 * - `typological` 量表要求三字码合法才算已测（`XRA` 这类脏值按未测，避免「接口说已测、界面没徽章」）；
 * - `dimensional` 量表没有三字码，有当前结果即 completed，分数快照缺失时 `scores=null`，
 *   由界面降级成「已测（分数缺失）」而不是画假的 0 分画像。
 */
function toScaleResult(
  result: AssessmentResultSummary | undefined,
  scale: ProfileAssessmentScaleView
): ProfileScaleResultView {
  if (!result) {
    return { status: "none", typeCode: null, completedAt: null, scores: null };
  }
  const scores = parseScores(result.scores_json).map(({ key, standard }) => ({ key, standard }));
  const scoresOrNull = scores.length > 0 ? scores : null;

  if (scale.scoringMode === "dimensional") {
    return {
      status: "completed",
      typeCode: null,
      completedAt: result.completed_at ?? null,
      scores: scoresOrNull,
    };
  }

  const assessed = assessmentLeadOf(result.type_code) !== null;
  if (!assessed) {
    return { status: "none", typeCode: null, completedAt: null, scores: null };
  }
  return {
    status: "completed",
    typeCode: result.type_code,
    completedAt: result.completed_at ?? null,
    scores: scoresOrNull,
  };
}

async function GET_impl(request: NextRequest) {
  try {
    // #295：筛选 / 排序 / 分页全部由服务端完成（此前在浏览器里只过滤当页 20 行，跨页学生筛不到）。
    // 参数口径与校验统一在 profile-query.ts，非法参数显式 400，避免静默忽略筛选条件。
    const parsed = parseProfilesQuery(request.nextUrl.searchParams);
    if (!parsed.ok) {
      return NextResponse.json({ error: parsed.error }, { status: 400 });
    }
    const { page, pageSize, filters } = parsed.value;

    // #330：启用中的量表清单（列定义/维度标签唯一来源）。列表主体不依赖它，
    // 因此这里失败只让「双测评列」降级为未测，不让整页 500。
    const scaleEntries: { row: AssessmentRow; view: ProfileAssessmentScaleView }[] = [];
    try {
      const enabled = await getEnabledAssessments();
      for (const row of enabled) scaleEntries.push({ row, view: toScaleView(row) });
    } catch (err) {
      console.error("Profiles assessment scale lookup degraded:", err);
    }
    const scaleViews = scaleEntries.map((entry) => entry.view);

    const resolvedFilters = resolvePersonalityFilter(filters, scaleViews);
    if (!resolvedFilters.ok) {
      return NextResponse.json({ error: resolvedFilters.error }, { status: 400 });
    }

    const { rows, total } = await getSubmittedProfiles(page, pageSize, resolvedFilters.filters);

    // #330：本页学号 × 每套启用量表各批查一次（仍是当页批查，不做全校扫表）。
    // 某套量表查询失败只让该列全部降级为「未测」，其它列与档案列表不受影响。
    const codes = rows.map((row) => row.user_code);
    const resultsByScale = new Map<string, Map<string, AssessmentResultSummary>>();
    if (codes.length > 0) {
      for (const entry of scaleEntries) {
        try {
          const results = await getCurrentAssessmentResultsByUserCodes(entry.row.id, codes);
          const byCode = new Map<string, AssessmentResultSummary>();
          for (const result of results) byCode.set(result.user_code, result);
          resultsByScale.set(entry.view.code, byCode);
        } catch (err) {
          console.error(`Profiles assessment lookup degraded for ${entry.view.code}:`, err);
          resultsByScale.set(entry.view.code, new Map());
        }
      }
    }

    return NextResponse.json({
      data: rows.map((r) => {
        // #94：标签文本直存，原样返回（容忍旧格式）
        let tags: string[] = [];
        try {
          const parsedTags = r.tags ? JSON.parse(r.tags) : [];
          tags = Array.isArray(parsedTags) ? parsedTags.map((t) => String(t)) : [];
        } catch {}
        const assessmentResults: Record<string, ProfileScaleResultView> = {};
        for (const scale of scaleViews) {
          const byCode = resultsByScale.get(scale.code);
          assessmentResults[scale.code] = toScaleResult(byCode?.get(r.user_code), scale);
        }
        // 兼容字段（#234）：取自霍兰德量表的结果，旧前端/导出继续可用
        const holland =
          assessmentResults[RIASEC_CODE] ??
          toScaleResult(undefined, { code: RIASEC_CODE, name: "", scoringMode: "typological", dimensions: [] });
        const legacyAssessed = assessmentLeadOf(holland.typeCode) !== null;
        return {
          // #95：补充数字 userId，供版本历史等关联查询使用
          userId: r.id,
          studentId: r.user_code,
          studentName: r.name,
          tags,
          avatarUrl: r.avatar_url,
          evaluationUrl: r.evaluation_url,
          storageId: r.storage_id,
          createdAt: r.submitted_at,
          // #234 兼容字段：未测统一为 none / null
          assessmentCode: legacyAssessed ? holland.typeCode : null,
          assessmentStatus: legacyAssessed ? "completed" : "none",
          assessmentAt: legacyAssessed ? holland.completedAt : null,
          assessmentScores: legacyAssessed ? holland.scores : null,
          // #330：按量表 code 的当前有效结果（兴趣列 / 人格列都从这里取）
          assessmentResults,
        };
      }),
      // #330：列定义与维度标签随列表下发，前端不写死量表
      assessmentScales: scaleViews,
      total,
      page,
      pageSize,
      totalPages: Math.ceil(total / pageSize),
    });
  } catch (err) {
    console.error("Profiles GET error:", err);
    return NextResponse.json({ error: "获取档案列表失败" }, { status: 500 });
  }
}

/**
 * 解析人格筛选需要的信息（#330）：把维度 key 映射成「启用中的维度型量表」里的数组下标。
 *
 * 为什么要路由来算：`scores_json` 是**数组顺序**快照，SQL 按 `$[i]` 取分；下标只能由
 * 量表的 `dimensions_json` 决定，前端传下标等于把注入点交给客户端。维度不属于任何启用
 * 量表时显式 400（而不是返回空列表——那样老师会以为「没人测出这个维度」）。
 */
function resolvePersonalityFilter(
  filters: ProfileListQuery,
  scales: readonly ProfileAssessmentScaleView[]
): { ok: true; filters: ResolvedProfileListQuery } | { ok: false; error: string } {
  const personality = filters.personality;
  if (!personality) return { ok: true, filters };
  const dimensional = scales.filter((scale) => scale.scoringMode === "dimensional");

  if (personality.mode === "dimension") {
    for (const scale of dimensional) {
      const index = scale.dimensions.findIndex((dimension) => dimension.key === personality.key);
      if (index >= 0) {
        return {
          ok: true,
          filters: { ...filters, personalitySql: { scaleCode: scale.code, dimensionIndex: index } },
        };
      }
    }
    return { ok: false, error: `人格量表没有维度 ${personality.key}（或人格量表未启用）` };
  }

  // 「已测 / 未测」只需要知道按哪套量表判：取启用中的第一套维度型量表。
  const scale = dimensional[0];
  if (!scale) return { ok: false, error: "人格量表还没有启用，暂时无法按人格测评筛选" };
  return { ok: true, filters: { ...filters, personalitySql: { scaleCode: scale.code } } };
}

async function DELETE_impl(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的记录" }, { status: 400 });
    }
    const deleted = await clearSubmissions(ids);
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 条记录` });
  } catch (err) {
    console.error("Profiles DELETE error:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
export const DELETE = withDemoScope(DELETE_impl);
