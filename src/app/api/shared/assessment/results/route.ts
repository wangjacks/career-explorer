import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentByCode,
  getAssessmentDraft,
  getAssessmentQuestionsByCode,
  getAssessmentResults,
  getCurrentAssessmentResult,
  getUserById,
  normalizeAssessmentCode,
} from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import {
  answerProgress,
  filterAnswersToBank,
  formatResultTime,
  parseAnswers,
  parseDimensions,
  parseScores,
} from "@/lib/assessment-flow";
import { verifyToken } from "@/lib/token";
import { getRequestContext, recordAudit } from "@/lib/audit";

/** 历史版本最多回传条数：界面只需要「当前 + 最近几版」，防止响应随作答次数无限膨胀 */
const MAX_HISTORY = 10;

/**
 * 结果查询（#223）：当前有效结果 + 历史版本 + 进行中的作答进度，供「我的档案」测评区（#224）消费。
 *
 * 自鉴权：只按会话 uid 读取本人结果，**不提供任何 userId 参数**，因此不存在越权读他人结果的路径。
 * 结果里的得分是**快照**（当时算出的六维分 + 三字码），不随题库/换算改动重算。
 */
export async function GET(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const result = await verifyToken(token);
    if (!result.valid) return NextResponse.json({ error: "登录已过期，请重新登录" }, { status: 401 });
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "仅学生本人可查看测评结果" }, { status: 403 });
    }
    const user = await getUserById(result.uid);
    if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 401 });

    const code = normalizeAssessmentCode(request.nextUrl.searchParams.get("code") ?? RIASEC_CODE);
    const assessment = await getAssessmentByCode(code);
    if (!assessment) return NextResponse.json({ error: "测评不存在" }, { status: 404 });

    const [questions, current, all, draft] = await Promise.all([
      getAssessmentQuestionsByCode(code),
      getCurrentAssessmentResult(user.id, assessment.id),
      getAssessmentResults(user.id, assessment.id),
      getAssessmentDraft(user.id, assessment.id),
    ]);

    const bankIndexes = questions.map((q) => q.question_index);
    const draftAnswers = filterAnswersToBank(parseAnswers(draft?.answers_json), bankIndexes);
    const draftProgress = answerProgress(draftAnswers, bankIndexes);

    const toView = (row: (typeof all)[number]) => ({
      id: row.id,
      typeCode: row.type_code,
      scores: parseScores(row.scores_json),
      completedAt: formatResultTime(row.completed_at),
      isCurrent: row.is_current === 1,
    });
    const history = all.slice(0, MAX_HISTORY).map(toView);

    await recordAudit({
      actor_id: user.id,
      actor_user_code: user.user_code,
      actor_name: user.name,
      actor_role: user.role,
      action: "assessment:results",
      method: "GET",
      path: "/api/shared/assessment/results",
      resource_type: "assessment",
      resource_id: code,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { hasCurrent: Boolean(current), historyCount: history.length },
    });

    return NextResponse.json({
      assessment: {
        code: assessment.code,
        name: assessment.name,
        questionCount: bankIndexes.length,
        /** 是否开放（#222 测评中心据此决定给不给「开始 / 继续作答」入口；停用后历史结果仍可读） */
        enabled: assessment.enabled === 1,
        scaleVersion: assessment.scale_version,
        dimensions: parseDimensions(assessment.dimensions_json),
        attribution: assessment.attribution,
        licenseText: assessment.license_text,
        disclaimer: assessment.disclaimer,
      },
      current: current ? toView(current) : null,
      history,
      // 进行中的作答进度（未完成过或正在重测时给「继续作答」用）；没有草稿时为 null
      inProgress:
        draft && draftProgress.answered > 0
          ? { answered: draftProgress.answered, total: draftProgress.total, updatedAt: draft.updated_at }
          : null,
    });
  } catch (err) {
    console.error("Assessment results GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
