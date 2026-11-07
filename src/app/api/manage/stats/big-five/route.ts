import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentByCode,
  getCompletionStats,
  getDimensionalResultScores,
  type CompletionStatsRaw,
} from "@/lib/db";
import { isInstalled } from "@/lib/db-config";
import { IPIP_NEO_FFI_CODE } from "@/lib/assessment-data";
import { parseDimensions } from "@/lib/assessment-flow";
import { completionRate } from "@/lib/assessment-stats";
import { parseDimensionalBands, normalizeDimensionalDefinitions } from "@/lib/big-five-stats";
import { getSession, writableClassIds } from "../../classes/helpers";

/** 允许的统计范围：`all` = 全校；`mine` = 只有本人归属班级（管理员 `mine` 等同全校） */
const SCOPES = ["all", "mine"] as const;
type Scope = (typeof SCOPES)[number];

function emptyResult(scope: Scope) {
  return {
    scope,
    assessment: null,
    total: { enrolled: 0, assessed: 0, rate: 0, invalidCount: 0, lastSubmittedAt: null },
    dimensions: [],
  };
}

/** 从完成矩阵原始计数里取该量表的分母与分子（复用 #310 的唯一口径，不另写一套 SQL） */
function sumCompletion(raw: CompletionStatsRaw, assessmentId: number) {
  let enrolled = 0;
  for (const row of raw.profile) enrolled += Math.max(0, row.enrolled);
  let assessed = 0;
  for (const row of raw.assessments) {
    if (row.assessment_id === assessmentId) assessed += Math.max(0, row.assessed);
  }
  return { enrolled, assessed };
}

/**
 * 教师端「人格轮廓」班级分布（#312）：大五人格五维各按低/中/高三档计数。
 *
 * - **纯聚合**：响应不含姓名、学号、逐人分数，也没有平均分/排名；三档数字可直接投屏。
 *   与人相关的结果下钻仍走 `/assessment/roster`（那里单独记审计）。
 * - 量表元信息（名称/版本/维度顺序/启用状态）**只从 `assessments` 表读**，接口不返回任何题目内容。
 * - 三档读结果快照里已落库的 `band`，缺 `band` 时按 `standard` 用 `bandOf` 兜底；脏数据只计入
 *   `invalidCount`，不抛 500、不产生 `NaN`。
 * - 范围：`scope=all`（默认，全校）或 `scope=mine`（教师仅本人归属班级）；`classId` 可再收窄单班。
 *   教师给非本人班级直接 403；管理员可查任意范围。
 */
async function GET_impl(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session || (session.role !== "admin" && session.role !== "teacher")) {
      return NextResponse.json({ error: "仅教师与管理员可查看人格统计" }, { status: 403 });
    }

    const params = request.nextUrl.searchParams;
    const scopeParam = params.get("scope") ?? "all";
    if (!SCOPES.includes(scopeParam as Scope)) {
      return NextResponse.json({ error: "scope 只支持 all / mine" }, { status: 400 });
    }
    const scope = scopeParam as Scope;

    const classIdParam = params.get("classId");
    let classId: number | undefined;
    if (classIdParam !== null && classIdParam.trim() !== "") {
      classId = Number(classIdParam);
      if (!Number.isInteger(classId) || classId <= 0) {
        return NextResponse.json({ error: "classId 必须是正整数" }, { status: 400 });
      }
    }

    // 未安装先短路：此时没有班级/量表可查，也不该让教师归属查询先打到未初始化的库
    if (!isInstalled()) {
      return NextResponse.json(emptyResult(scope));
    }

    // 教师：任何 classId 都先过归属判定（不因 scope=all 而放宽）；scope=mine 再收窄到本人班级
    let classIds: number[] | null = null;
    if (session.role === "teacher") {
      const writable = (await writableClassIds(session)) ?? new Set<number>();
      if (classId !== undefined) {
        if (!writable.has(classId)) {
          return NextResponse.json({ error: "无权查看该班级的人格统计" }, { status: 403 });
        }
        classIds = [classId];
      } else if (scope === "mine") {
        classIds = [...writable];
      }
    } else if (classId !== undefined) {
      classIds = [classId];
    }

    const assessment = await getAssessmentByCode(IPIP_NEO_FFI_CODE);
    // 未种子化/被后台删除：返回空态而不是 500，界面继续显示「未开放」
    if (!assessment) {
      return NextResponse.json(emptyResult(scope));
    }
    if (assessment.scoring_mode !== "dimensional") {
      return NextResponse.json({ error: "该量表不是人格量表" }, { status: 400 });
    }

    const enabled = assessment.enabled === 1;
    // 元信息与三档计数共用同一份归一后的维度定义（去空 key / 重复 key，保留定义顺序）
    const dimensions = normalizeDimensionalDefinitions(parseDimensions(assessment.dimensions_json));

    // 停用：整卡按「未开放」处理。total 也归零，避免出现「三档全 0 但 assessed > 0」这种
    // 违反 `low + medium + high = assessed - invalidCount` 守恒的响应，也不读取任何逐人快照
    if (!enabled) {
      return NextResponse.json({
        scope,
        assessment: {
          code: assessment.code,
          name: assessment.name,
          scaleVersion: assessment.scale_version,
          enabled: false,
          scoringMode: assessment.scoring_mode,
          dimensions,
        },
        total: { enrolled: 0, assessed: 0, rate: 0, invalidCount: 0, lastSubmittedAt: null },
        dimensions: dimensions.map((dimension) => ({
          ...dimension,
          low: 0,
          medium: 0,
          high: 0,
        })),
      });
    }

    // 分母/分子复用 #310 的完成矩阵口径
    const raw = await getCompletionStats([assessment.id], classIds);
    const { enrolled, assessed } = sumCompletion(raw, assessment.id);
    const rate = completionRate(Math.min(enrolled, assessed), enrolled);

    const parsed = parseDimensionalBands(
      await getDimensionalResultScores(assessment.id, classIds),
      dimensions
    );

    return NextResponse.json({
      scope,
      assessment: {
        code: assessment.code,
        name: assessment.name,
        scaleVersion: assessment.scale_version,
        enabled,
        scoringMode: assessment.scoring_mode,
        dimensions,
      },
      total: {
        enrolled,
        assessed,
        rate,
        invalidCount: parsed.invalidCount,
        lastSubmittedAt: parsed.lastSubmittedAt,
      },
      dimensions: parsed.dimensions,
    });
  } catch (err) {
    console.error("Big five stats GET error:", err);
    return NextResponse.json({ error: "获取人格统计失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
