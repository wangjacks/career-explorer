import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getEnabledAssessments, getUserById } from "@/lib/db";
import { parseDimensions } from "@/lib/assessment-flow";
import { loadAttemptContext } from "@/lib/assessment-attempt";
import { buildAssessmentListItem } from "@/lib/assessment-list";
import { verifyToken } from "@/lib/token";
import { getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 测评中心的多量表列表（#291）：只回 `enabled = 1` 的量表，每套带本人在该量表上的
 * 三态 / 最近三字码与完成时间 / 进行中进度。
 *
 * 逐套口径与 results 接口完全一致：`loadAttemptContext` 一次算出本轮题号与草稿进度，
 * 再由 `buildAssessmentListItem` 调 `deriveAssessmentCenter` 归一成视图——服务端只下发归一后的值，
 * 页面不另算一套（停用量表不出现：历史结果仍可在「我的档案」查看）。
 *
 * 鉴权同 results：只按会话 uid 读取，**不接受任何 userId 参数**，因此不存在越权读他人进度的路径。
 */
async function GET_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const result = await verifyToken(token);
    if (!result.valid) return NextResponse.json({ error: "登录已过期，请重新登录" }, { status: 401 });
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "仅学生本人可查看测评状态" }, { status: 403 });
    }
    const user = await getUserById(result.uid);
    if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 401 });

    const assessments = await getEnabledAssessments();
    // 逐套只读本人数据；定义字段（署名 / 授权 / 免责）随响应下发，页面与档案区共用同一份库文案
    const items = await Promise.all(
      assessments.map(async (assessment) => {
        const context = await loadAttemptContext(assessment, user.id);
        return buildAssessmentListItem({
          assessment: {
            code: assessment.code,
            name: assessment.name,
            scoringMode: assessment.scoring_mode,
            scaleVersion: assessment.scale_version,
            dimensions: parseDimensions(assessment.dimensions_json),
            attribution: assessment.attribution,
            licenseText: assessment.license_text,
            disclaimer: assessment.disclaimer,
          },
          roundIndexes: context.roundIndexes,
          bankIndexes: context.bankIndexes,
          draft: context.draft ? { answers: context.answers, updatedAt: context.draft.updated_at } : null,
          completed: context.completed.map((row) => ({
            typeCode: row.type_code,
            completedAt: row.completed_at,
            isCurrent: row.is_current === 1,
          })),
        });
      })
    );

    await recordAudit({
      actor_id: user.id,
      actor_user_code: user.user_code,
      actor_name: user.name,
      actor_role: user.role,
      action: "assessment:list",
      method: "GET",
      path: "/api/shared/assessment/list",
      resource_type: "assessment",
      resource_id: null,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { count: items.length, codes: items.map((item) => item.code) },
    });

    return NextResponse.json({ assessments: items });
  } catch (err) {
    console.error("Assessment list GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
