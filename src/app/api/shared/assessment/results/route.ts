import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getAssessmentByCode, getUserById, normalizeAssessmentCode, type AssessmentResultRow } from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import {
  MAX_RESULT_VERSIONS,
  answerProgress,
  formatResultTime,
  parseAnswers,
  parseDimensions,
  parseScores,
} from "@/lib/assessment-flow";
import { loadAttemptContext } from "@/lib/assessment-attempt";
import { parseItemsSnapshot } from "@/lib/assessment-sampling";
import { verifyToken } from "@/lib/token";
import { getRequestContext, recordAudit } from "@/lib/audit";

/** 历史版本最多回传条数（与测评中心共用的常量，避免两处各写一个 10） */
const MAX_HISTORY = MAX_RESULT_VERSIONS;

/**
 * 结果查询（#223 + #282）：当前有效结果 + 历史版本 + 进行中的作答进度，供「我的档案」测评区（#224）消费。
 *
 * 自鉴权：只按会话 uid 读取本人结果，**不提供任何 userId 参数**，因此不存在越权读他人结果的路径。
 * 结果里的得分是**快照**（当时算出的六维分 + 三字码），不随题库/换算改动重算。
 * #282 后每条记录另带 `questionCount`：优先取该记录自己的抽题快照长度，
 * 旧记录（无快照）取当轮作答数——整库作答的年代就是 120，不会谎报成新的 30。
 */
async function GET_impl(request: NextRequest) {
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

    // 启用量表清单只有一个家（#291 的 `/api/shared/assessment/list`）：本接口只回**一套**量表的结果，
    // 档案页（#292）先按 list 拿 code 清单，再逐套按 `?code=` 取结果，避免同一信息两处维护。

    // 一次读取即得本轮口径 + 草稿 + 全部完成记录（current 也从这里挑，不再单独查一次）
    const context = await loadAttemptContext(assessment, user.id);
    const current = context.completed.find((row) => row.is_current === 1);
    const draftProgress = answerProgress(context.answers, context.roundIndexes);

    const questionCountOf = (row: AssessmentResultRow) => {
      const snapshot = parseItemsSnapshot(row.items_json);
      if (snapshot) return snapshot.indexes.length;
      return Object.keys(parseAnswers(row.answers_json)).length;
    };
    const toView = (row: AssessmentResultRow) => ({
      id: row.id,
      typeCode: row.type_code,
      scores: parseScores(row.scores_json),
      completedAt: formatResultTime(row.completed_at),
      isCurrent: row.is_current === 1,
      questionCount: questionCountOf(row),
    });
    const history = context.completed.slice(0, MAX_HISTORY).map(toView);

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
        /** 新一轮的题量（#282）：启用抽题时是每次抽题数，未启用时是题库总量 */
        questionCount: context.roundIndexes.length,
        poolSize: context.bankIndexes.length,
        itemsPerAttempt: assessment.items_per_attempt,
        /** 是否开放（#222 测评中心据此决定给不给「开始 / 继续作答」入口；停用后历史结果仍可读） */
        enabled: assessment.enabled === 1,
        /** 计分模式（#292 档案页在入口据此分流霍兰德卡 / 大五卡） */
        scoringMode: assessment.scoring_mode,
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
        context.draft && draftProgress.answered > 0
          ? { answered: draftProgress.answered, total: draftProgress.total, updatedAt: context.draft.updated_at }
          : null,
    });
  } catch (err) {
    console.error("Assessment results GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
