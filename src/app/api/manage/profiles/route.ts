import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getSubmittedProfiles,
  getStudents,
  getClasses,
  clearSubmissions,
  getEnabledAssessments,
  getCurrentAssessmentResultsByUserCodes,
  type AssessmentResultSummary,
  type AssessmentRow,
} from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { parseScores } from "@/lib/assessment-flow";
import { assessmentLeadOf, profileScaleViewOf } from "@/lib/profile-assessment";
import type {
  ProfileAssessmentScaleView,
  ProfileScaleResultView,
} from "@/lib/profile-assessment";
import { parseProfilesQuery, resolveProfilePersonalityFilter } from "@/lib/profile-query";
import { extractEvaluationWords, parseStoredEvaluationTexts } from "@/lib/evaluation-text";
import { WriteGuard } from "../write-guard";

const PATH = "/api/manage/profiles";
const ENTRY = { action: "profile:clear", method: "DELETE", path: PATH, resource_type: "profile" } as const;
const OUT_OF_SCOPE_STUDENT = "该学生不在你管理的班级";

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
    let scaleLoadFailed = false;
    try {
      const enabled = await getEnabledAssessments();
      for (const row of enabled) {
        scaleEntries.push({
          row,
          view: profileScaleViewOf({
            ...row,
            // 本卷题量：启用抽题时是抽题数，否则等于题库总量（与 /api/shared/assessment/list 同口径）
            question_count: row.items_per_attempt > 0 ? row.items_per_attempt : row.question_count,
            pool_size: row.question_count,
          }),
        });
      }
    } catch (err) {
      scaleLoadFailed = true;
      console.error("Profiles assessment scale lookup degraded:", err);
    }
    const scaleViews = scaleEntries.map((entry) => entry.view);

    const resolvedFilters = resolveProfilePersonalityFilter(filters, scaleViews);
    if (!resolvedFilters.ok) {
      // 量表清单读取失败 ≠ 没有启用的维度型量表：前者是服务端故障，按 503 让客户端重试，
      // 不能把 DB 故障误报成 400 参数错误（无筛选时列表仍照常降级返回）。
      if (scaleLoadFailed) {
        return NextResponse.json({ error: "测评量表暂时读取失败，请稍后重试" }, { status: 503 });
      }
      return NextResponse.json({ error: resolvedFilters.error }, { status: 400 });
    }

    const { rows, total } = await getSubmittedProfiles(page, pageSize, resolvedFilters.filters);

    // #332：详情弹窗要展示「班级」；班级表很小，一次查询按 id 映射，失败只让该字段降级为空
    const classNames = new Map<number, string>();
    try {
      for (const item of await getClasses()) classNames.set(item.id, item.name);
    } catch (err) {
      console.error("Profiles class name lookup degraded:", err);
    }

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
        // 状态与徽章同源：三字码合法才算「已测」，避免接口说 completed、界面显示未测
        const holland =
          assessmentResults[RIASEC_CODE] ??
          toScaleResult(undefined, { code: RIASEC_CODE, name: "", scoringMode: "typological", dimensions: [] });
        const legacyAssessed = assessmentLeadOf(holland.typeCode) !== null;
        const evaluationTexts = parseStoredEvaluationTexts(r.evaluation_text);
        return {
          // #95：补充数字 userId，供版本历史等关联查询使用
          userId: r.id,
          studentId: r.user_code,
          studentName: r.name,
          // #243：教师面板据此判断行是否在其管辖班级内，决定是否展示删除入口
          classId: r.class_id,
          // #332：详情弹窗「身份区」展示班级；班级表读取失败时为 null
          className: r.class_id == null ? null : classNames.get(r.class_id) ?? null,
          tags,
          avatarUrl: r.avatar_url,
          evaluationUrl: r.evaluation_url,
          evaluationTexts,
          evaluationWords: extractEvaluationWords(evaluationTexts),
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

async function DELETE_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const guard = await WriteGuard.from(request);
    if (!guard.session) return guard.unauthenticated();

    let payload: unknown;
    try {
      payload = await request.json();
    } catch {
      return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
    }
    const ids = (payload as { ids?: unknown } | null)?.ids;
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的记录" }, { status: 400 });
    }

    // 去重后统一以字符串学号处理：后续批量预检、清除与审计用同一份目标集合
    const codes = [...new Set(ids.map(String))];
    const roster = await getStudents();
    const classOf = new Map(roster.map((s) => [s.user_code, s.class_id]));
    const missing = codes.filter((code) => !classOf.has(code));

    // 归属校验（#243）：教师只能清除本人管辖班级学生的档案；不在册 id 同样按越界处理。
    // 整批预检通过后才落写入，任一越界即整批拒绝，不留半删状态。
    if (!guard.canWriteGlobal) {
      const foreign = codes.filter(
        (code) => classOf.has(code) && !guard.canWriteClass(classOf.get(code) ?? null)
      );
      if (missing.length > 0 || foreign.length > 0) {
        return guard.deny(ENTRY, null, OUT_OF_SCOPE_STUDENT, 403, {
          requested: codes.length,
          missing: missing.length,
          foreign: foreign.length,
        });
      }
    } else if (missing.length > 0) {
      return guard.deny(
        ENTRY,
        null,
        `有 ${missing.length} 名学生不存在或已不在名单中`,
        404,
        { requested: codes.length, missing: missing.length }
      );
    }

    const deleted = await clearSubmissions(codes);
    void recordAudit({
      ...guard.actor,
      ...ENTRY,
      resource_id: null,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { requested: codes.length, ids: codes, deleted },
    });
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 条记录` });
  } catch (err) {
    console.error("Profiles DELETE error:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
export const DELETE = withDemoScope(DELETE_impl);