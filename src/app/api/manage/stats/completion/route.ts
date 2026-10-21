import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getCompletionStats, getEnabledAssessments } from "@/lib/db";
import { isInstalled } from "@/lib/db-config";
import {
  COMPLETION_PROFILE_KEY,
  finalizeCompletionStats,
  type CompletionScale,
} from "@/lib/completion-stats";
import { getSession, writableClassIds } from "../../classes/helpers";

/** 允许的统计范围：`all` = 所有班级（与既有 stats 端点同口径）；`mine` = 只有本人归属班级 */
const SCOPES = ["all", "mine"] as const;
type Scope = (typeof SCOPES)[number];

/** 未安装/量表缺失时的最小响应：只保留档案列，界面不出现 500 */
function profileOnlyResult(scope: Scope) {
  return {
    scope,
    columns: [{ key: COMPLETION_PROFILE_KEY, label: "档案提交" }],
    rows: [],
    unassigned: null,
    total: {
      enrolled: 0,
      cells: { [COMPLETION_PROFILE_KEY]: { done: 0, rate: 0 } },
    },
  };
}

/**
 * 班级完成矩阵（#310）：一个班 × 一件事的完成度，列由启用量表动态驱动。
 *
 * - **纯聚合**：响应不含姓名/学号，可直接投屏；个人明细走 `/assessment/roster`（单独记审计）。
 *   因此本端点与既有 `/stats/assessment` 同口径**不记审计**。
 * - 范围：`scope=all`（默认）为所有班级；`scope=mine` 对教师收窄到 `teacher_classes`。
 *   管理员没有班级归属，`scope=mine` 等同所有班级。
 * - 教师切到「所有班级」时响应里的 `canDrilldown` 恒 false（#314 看板只读聚合）；
 *   教师「我带的班」与管理员保持 true。
 * - 量表读取失败时退化为只有档案列；未安装时返回空矩阵，均不抛 500。
 */
async function GET_impl(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session || (session.role !== "admin" && session.role !== "teacher")) {
      return NextResponse.json({ error: "仅教师与管理员可查看完成度统计" }, { status: 403 });
    }

    const scopeParam = request.nextUrl.searchParams.get("scope") ?? "all";
    if (!SCOPES.includes(scopeParam as Scope)) {
      return NextResponse.json({ error: "scope 只支持 all / mine" }, { status: 400 });
    }
    const scope = scopeParam as Scope;

    if (!isInstalled()) {
      return NextResponse.json(profileOnlyResult(scope));
    }

    let classIds: number[] | null = null;
    if (scope === "mine" && session.role === "teacher") {
      classIds = [...((await writableClassIds(session)) ?? [])];
    }

    let assessments: CompletionScale[] = [];
    try {
      const enabled = await getEnabledAssessments();
      assessments = enabled
        .filter((row) => row.enabled === 1)
        .map((row) => ({
          id: row.id,
          code: row.code,
          name: row.name,
          scoringMode: row.scoring_mode,
        }));
    } catch (err) {
      // 量表表缺失/未种子化：退化为只有档案列，不让整个看板 500
      console.error("Completion stats: enabled assessments unavailable:", err);
    }

    const raw = await getCompletionStats(
      assessments.map((assessment) => assessment.id),
      classIds
    );
    const canDrilldown = session.role === "admin" || scope === "mine";
    const result = finalizeCompletionStats(raw, assessments, { classIds, canDrilldown });

    return NextResponse.json({ scope, ...result });
  } catch (err) {
    console.error("Completion stats GET error:", err);
    return NextResponse.json({ error: "获取完成度统计失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
