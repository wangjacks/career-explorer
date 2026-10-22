import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getAssessmentByCode, getUserById, normalizeAssessmentCode } from "@/lib/db";
import { getAssessmentAnchors, RIASEC_CODE } from "@/lib/assessment-data";
import { answerProgress, parseDimensions, resumeIndex } from "@/lib/assessment-flow";
import { loadAttemptContext } from "@/lib/assessment-attempt";
import { verifyToken } from "@/lib/token";

/**
 * 进入答题页（#223 + #282）：下发**本轮题目**（启用抽题时 120 题库里抽 30 题）+ 量表元信息
 * （署名 / 授权 / 免责）+ 草稿进度。
 *
 * 只读：**不在进入时建草稿行**——草稿由第一次 `POST /answer` 落库，
 * 只打开页面又离开的学生不会留下空记录（草稿唯一性见 #221 的 `draft_slot`）。
 * 分层抽题（#282）由 `userId + 量表 + 题库指纹 + 轮次` 确定性派生，所以 GET 不写库、
 * 不存会话也能算出与 answer / submit 完全一致的卷子。
 * 题面不下发 `dimension`：作答时不暴露题目归属哪一型，避免暗示答案。
 */
async function GET_impl(request: NextRequest) {
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

    const code = normalizeAssessmentCode(request.nextUrl.searchParams.get("code") ?? RIASEC_CODE);
    const assessment = await getAssessmentByCode(code);
    if (!assessment) return NextResponse.json({ error: "测评不存在" }, { status: 404 });
    if (assessment.enabled !== 1) return NextResponse.json({ error: "该测评暂未开放" }, { status: 403 });

    const context = await loadAttemptContext(assessment, user.id);
    if (context.bankIndexes.length === 0) {
      return NextResponse.json({ error: "该测评暂无题目" }, { status: 503 });
    }

    const progress = answerProgress(context.answers, context.roundIndexes);

    return NextResponse.json({
      assessment: {
        code: assessment.code,
        name: assessment.name,
        /** 本轮作答题数（#282 的口径：启用抽题时是抽题数，不是题库总量） */
        questionCount: context.roundIndexes.length,
        /** 题库总量（展示「120 题库中抽 30 题」用） */
        poolSize: context.bankIndexes.length,
        itemsPerAttempt: assessment.items_per_attempt,
        scaleVersion: assessment.scale_version,
        scoringMode: assessment.scoring_mode,
        /** 作答锚点随量表下发（#289）：兴趣=意愿、人格=同意度，页面不再写死 */
        anchors: getAssessmentAnchors(assessment.code),
        dimensions: parseDimensions(assessment.dimensions_json),
        attribution: assessment.attribution,
        licenseText: assessment.license_text,
        disclaimer: assessment.disclaimer,
      },
      questions: context.roundQuestions.map((q) => ({ index: q.question_index, prompt: q.prompt })),
      draft: context.draft ? { answers: context.answers, updatedAt: context.draft.updated_at } : null,
      progress,
      resumeIndex: resumeIndex(context.answers, context.roundIndexes),
    });
  } catch (err) {
    console.error("Assessment start GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
