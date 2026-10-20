import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  completeAssessmentResult,
  getAssessmentByCode,
  getCurrentAssessmentResult,
  getUserById,
  normalizeAssessmentCode,
} from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { scoreAssessment } from "@/lib/assessment-scoring";
import { answerProgress, parseDimensions } from "@/lib/assessment-flow";
import { loadAttemptContext } from "@/lib/assessment-attempt";
import { verifyToken } from "@/lib/token";
import { getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 提交作答（#223 + #282）：把**本轮卷子**的草稿算成结果快照并落库。
 *
 * - 只认**会话本人**的草稿，不接受任何 userId / answers 入参（作答内容以服务端草稿为准，
 *   客户端改分无从下手）；
 * - 未答完一律 400 并回带缺失题号，不做「缺答也折算」（草稿允许缺答，但完成结果必须是完整一份）；
 *   #282 后「答完」的分母是本轮 30 题，不是 120 题库；
 * - 计分复用 #220 的引擎，题目集合只传本轮抽中的题（每维 5 题），标准分口径与整库作答一致；
 * - 得分 JSON、三字码与**抽题快照** `items_json` 一起写入 `assessment_results`
 *   （之后改题面或重算都不影响历史结果，回看时也能还原当轮题量）；重复提交生成新版本，旧版本
 *   `is_current` 置 0 但保留。
 */
async function POST_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const result = await verifyToken(token);
    if (!result.valid) return NextResponse.json({ error: "登录已过期，请重新登录" }, { status: 401 });
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "仅学生本人可提交测评" }, { status: 403 });
    }
    const user = await getUserById(result.uid);
    if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 401 });

    const body = await request.json().catch(() => null);
    const code = normalizeAssessmentCode(
      body && typeof body.code === "string" && body.code.trim() ? body.code : RIASEC_CODE
    );

    const reject = async (
      message: string,
      options: { status?: number; metadata?: Record<string, unknown> | null; extra?: Record<string, unknown> } = {}
    ) => {
      const { status = 400, metadata = null, extra } = options;
      await recordAudit({
        actor_id: user.id,
        actor_user_code: user.user_code,
        actor_name: user.name,
        actor_role: user.role,
        action: "assessment:submit",
        method: "POST",
        path: "/api/shared/assessment/submit",
        resource_type: "assessment",
        resource_id: code,
        status: "failed",
        error_message: message,
        ip,
        user_agent,
        metadata,
      });
      return NextResponse.json({ error: message, ...extra }, { status });
    };

    const assessment = await getAssessmentByCode(code);
    // 被拒的写同样落审计（#110 口径）：404/403 不能审计留白
    if (!assessment) {
      return await reject("测评不存在", { status: 404, metadata: { reason: "assessment-not-found" } });
    }
    if (assessment.enabled !== 1) {
      return await reject("该测评暂未开放", { status: 403, metadata: { reason: "assessment-disabled" } });
    }

    const context = await loadAttemptContext(assessment, user.id);
    if (!context.draft) return await reject("还没有作答记录，请先答题");

    const answers = context.answers;
    const progress = answerProgress(answers, context.roundIndexes);
    const missingIndexes = context.roundIndexes.filter((index) => answers[index] === undefined);
    if (missingIndexes.length > 0) {
      const extra = { missingIndexes, answered: progress.answered, total: progress.total };
      return await reject(`还有 ${missingIndexes.length} 题未作答`, { metadata: extra, extra });
    }

    const dimensions = parseDimensions(assessment.dimensions_json);
    const scoring = scoreAssessment(
      dimensions,
      context.roundQuestions.map((q) => ({
        index: q.question_index,
        dimension: q.dimension,
        reverseScored: q.reverse_scored === 1,
      })),
      answers,
      { mode: assessment.scoring_mode }
    );
    // 上面已挡缺答，这里只是双保险：引擎判定不完整就不落「完成」结果
    if (!scoring.complete) {
      const extra = { missingIndexes: scoring.missingIndexes };
      return await reject("作答不完整，无法提交", { metadata: extra, extra });
    }

    const resultId = await completeAssessmentResult({
      userId: user.id,
      assessmentId: assessment.id,
      answersJson: JSON.stringify(answers),
      itemsJson: context.itemsJson,
      scoresJson: JSON.stringify(scoring.scores),
      typeCode: scoring.code ?? null,
    });
    const current = await getCurrentAssessmentResult(user.id, assessment.id);

    await recordAudit({
      actor_id: user.id,
      actor_user_code: user.user_code,
      actor_name: user.name,
      actor_role: user.role,
      action: "assessment:submit",
      method: "POST",
      path: "/api/shared/assessment/submit",
      resource_type: "assessment",
      resource_id: code,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: {
        typeCode: scoring.code ?? null,
        answered: progress.answered,
        resultId,
        // 本轮口径进审计（哪个题池的第几轮），但**不落作答内容与题号清单**（个人数据）
        attemptNo: context.attemptNo,
        pool: context.plan.poolFingerprint,
      },
    });

    return NextResponse.json({
      result: {
        id: resultId,
        typeCode: scoring.code ?? null,
        scores: scoring.scores,
        completedAt: current?.completed_at ?? null,
        /** 本轮题量（#282）：启用抽题时是 30，不是题库总量 */
        questionCount: context.roundIndexes.length,
        poolSize: context.bankIndexes.length,
        attemptNo: context.attemptNo,
        scaleVersion: assessment.scale_version,
        disclaimer: assessment.disclaimer,
      },
    });
  } catch (err) {
    console.error("Assessment submit POST error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export const POST = withDemoScope(POST_impl);
