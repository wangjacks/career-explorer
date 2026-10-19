import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentByCode,
  getAssessmentDraft,
  getAssessmentQuestionsByCode,
  getUserById,
  normalizeAssessmentCode,
  upsertAssessmentDraft,
} from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import {
  answerProgress,
  filterAnswersToBank,
  firstUnansweredIndex,
  isValidAnswerValue,
  isValidQuestionIndex,
  mergeAnswer,
  parseAnswers,
} from "@/lib/assessment-flow";
import { verifyToken } from "@/lib/token";
import { getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 保存一次作答（#223）：每题作答即 upsert 草稿（`status=in_progress`），退出再进可续答。
 *
 * 服务端**合并**作答而不是整份覆盖：客户端只提交「这一题」，避免整份回写把别的题冲掉。
 * 边界：合并是「读草稿 → 合并 → 整份写」的读-改-写，**并发**请求（两个标签页同时提交）在极端重叠时
 * 仍是最后写入为准——单标签页由前端「保存中禁用」串行，跨标签页丢的一题会显示为未答、重进补答即可。
 * 不使用 localStorage —— 进度以服务端草稿为唯一真相（与 #221 的草稿唯一性约束配套）。
 */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const result = await verifyToken(token);
    if (!result.valid) return NextResponse.json({ error: "登录已过期，请重新登录" }, { status: 401 });
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "仅学生本人可作答测评" }, { status: 403 });
    }
    const user = await getUserById(result.uid);
    if (!user) return NextResponse.json({ error: "用户不存在" }, { status: 401 });

    const body = await request.json().catch(() => null);
    if (!body || typeof body !== "object") {
      return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
    }
    const code = normalizeAssessmentCode(
      typeof body.code === "string" && body.code.trim() ? body.code : RIASEC_CODE
    );
    const questionIndex = body.questionIndex;
    const value = body.value;

    const reject = async (
      message: string,
      options: { status?: number; metadata?: Record<string, unknown>; extra?: Record<string, unknown> } = {}
    ) => {
      const { status = 400, metadata = { questionIndex }, extra } = options;
      await recordAudit({
        actor_id: user.id,
        actor_user_code: user.user_code,
        actor_name: user.name,
        actor_role: user.role,
        action: "assessment:answer",
        method: "POST",
        path: "/api/shared/assessment/answer",
        resource_type: "assessment",
        resource_id: code,
        status: "failed",
        error_message: message,
        ip,
        user_agent,
        // 失败也**不记选项值**：作答内容是学生个人数据，审计只留题号 / 拒绝原因便于定位
        metadata,
      });
      return NextResponse.json({ error: message, ...extra }, { status });
    };

    if (!isValidQuestionIndex(questionIndex)) return await reject("题号不合法");
    if (!isValidAnswerValue(value)) return await reject("作答值必须是 1-5 的整数");

    const assessment = await getAssessmentByCode(code);
    // 被拒的写同样落审计（#110 口径）：404/403 不能审计留白，否则停用后还在提交 / 刷错 code 都查不到
    if (!assessment) {
      return await reject("测评不存在", { status: 404, metadata: { reason: "assessment-not-found" } });
    }
    if (assessment.enabled !== 1) {
      return await reject("该测评暂未开放", { status: 403, metadata: { reason: "assessment-disabled" } });
    }

    const questions = await getAssessmentQuestionsByCode(code);
    const bankIndexes = questions.map((q) => q.question_index);
    if (!bankIndexes.includes(questionIndex)) return await reject("题号不在题库内");

    const draft = await getAssessmentDraft(user.id, assessment.id);
    const existing = filterAnswersToBank(parseAnswers(draft?.answers_json), bankIndexes);
    const merged = mergeAnswer(existing, questionIndex, value);
    await upsertAssessmentDraft(user.id, assessment.id, JSON.stringify(merged));

    const progress = answerProgress(merged, bankIndexes);
    await recordAudit({
      actor_id: user.id,
      actor_user_code: user.user_code,
      actor_name: user.name,
      actor_role: user.role,
      action: "assessment:answer",
      method: "POST",
      path: "/api/shared/assessment/answer",
      resource_type: "assessment",
      resource_id: code,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      // 只记进度，不记学生选了哪个选项（作答内容是个人数据，不重复落到审计表）
      metadata: { questionIndex, answered: progress.answered, total: progress.total },
    });

    return NextResponse.json({
      saved: true,
      progress,
      nextIndex: firstUnansweredIndex(merged, bankIndexes),
    });
  } catch (err) {
    console.error("Assessment answer POST error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
