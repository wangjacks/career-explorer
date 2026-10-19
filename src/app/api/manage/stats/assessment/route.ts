import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getAssessmentByCode, getAssessmentStats } from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { parseDimensions } from "@/lib/assessment-flow";
import { finalizeAssessmentStats } from "@/lib/assessment-stats";
import { getSession, writableClassIds } from "../../classes/helpers";

/** 允许的统计范围：`all` = 全校（与既有 stats 端点同口径）；`mine` = 只有本人归属班级 */
const SCOPES = ["all", "mine"] as const;
type Scope = (typeof SCOPES)[number];

/**
 * 教师端测评聚合统计（#229）：班级完成度 / 六型计数 / 三字码排行 / 总数小结。
 *
 * - **纯聚合**：响应体不含姓名、学号等任何个人标识，可直接投屏（个人明细走 `/assessment/roster` 并记审计）；
 * - 范围：`scope=all`（默认）与既有 `/api/manage/stats/*` 一致按**全校**统计；`scope=mine` 只统计本人归属班级。
 *   管理员没有班级归属，`scope=mine` 等同全校（取舍写进 `docs/architecture.md`，代码不再分叉；
 *   管理员要看单班结构时用名册接口按 `classId` 下钻）；
 * - 分母 = 在册学生（未测评也计入），完成率钳到 100% 以内；六型归型依据是结果快照三字码首位
 *   （计分时已按 RIASEC 破平序取最高分维度），这里**不重算分数**，因此与学生端展示必然一致；
 * - 聚合读取不记审计：与既有 stats / 档案列表等本人无权限差异的只读端点同口径（#110 的审计范围是个人信息读取、
 *   管理域写操作、认证事件等）。
 */
async function GET_impl(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session || (session.role !== "admin" && session.role !== "teacher")) {
      return NextResponse.json({ error: "仅教师与管理员可查看测评统计" }, { status: 403 });
    }

    const scopeParam = request.nextUrl.searchParams.get("scope") ?? "all";
    if (!SCOPES.includes(scopeParam as Scope)) {
      return NextResponse.json({ error: "scope 只支持 all / mine" }, { status: 400 });
    }
    const scope = scopeParam as Scope;

    // 教师「只看我的班」：班级集合来自 teacher_classes（与写权限同一来源）；管理员恒为全校
    let classIds: number[] | null = null;
    if (scope === "mine" && session.role === "teacher") {
      classIds = [...((await writableClassIds(session)) ?? [])];
    }

    const assessment = await getAssessmentByCode(RIASEC_CODE);
    if (!assessment) {
      return NextResponse.json({ error: "测评量表未配置" }, { status: 404 });
    }

    const raw = await getAssessmentStats(assessment.id, classIds);
    const dimensions = parseDimensions(assessment.dimensions_json);
    const stats = finalizeAssessmentStats(raw, dimensions);

    return NextResponse.json({
      scope,
      assessment: {
        code: assessment.code,
        name: assessment.name,
        scaleVersion: assessment.scale_version,
      },
      ...stats,
    });
  } catch (err) {
    console.error("Assessment stats GET error:", err);
    return NextResponse.json({ error: "获取测评统计失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
