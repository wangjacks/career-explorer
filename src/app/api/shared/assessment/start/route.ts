import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentByCode,
  getAssessmentDraft,
  getAssessmentQuestionsByCode,
  getUserById,
  normalizeAssessmentCode,
} from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import {
  answerProgress,
  filterAnswersToBank,
  parseAnswers,
  parseDimensions,
  resumeIndex,
} from "@/lib/assessment-flow";
import { verifyToken } from "@/lib/token";

/**
 * 进入答题页（#223）：一次性下发题面 + 量表元信息（署名 / 授权 / 免责）+ 草稿进度。
 *
 * 只读：**不在进入时建草稿行**——草稿由第一次 `POST /answer` 落库，
 * 只打开页面又离开的学生不会留下空记录（草稿唯一性见 #221 的 `draft_slot`）。
 * 题面不下发 `dimension`：作答时不暴露题目归属哪一型，避免暗示答案。
 */
export async function GET(request: NextRequest) {
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

    const [questions, draft] = await Promise.all([
      getAssessmentQuestionsByCode(code),
      getAssessmentDraft(result.uid, assessment.id),
    ]);
    if (questions.length === 0) {
      return NextResponse.json({ error: "该测评暂无题目" }, { status: 503 });
    }

    const bankIndexes = questions.map((q) => q.question_index);
    // 题库换版后旧草稿里可能有超出当前题库的题号：按当前题库过滤后再算进度
    const answers = filterAnswersToBank(parseAnswers(draft?.answers_json), bankIndexes);
    const progress = answerProgress(answers, bankIndexes);

    return NextResponse.json({
      assessment: {
        code: assessment.code,
        name: assessment.name,
        questionCount: bankIndexes.length,
        scaleVersion: assessment.scale_version,
        scoringMode: assessment.scoring_mode,
        dimensions: parseDimensions(assessment.dimensions_json),
        attribution: assessment.attribution,
        licenseText: assessment.license_text,
        disclaimer: assessment.disclaimer,
      },
      questions: questions.map((q) => ({ index: q.question_index, prompt: q.prompt })),
      draft: draft ? { answers, updatedAt: draft.updated_at } : null,
      progress,
      resumeIndex: resumeIndex(answers, bankIndexes),
    });
  } catch (err) {
    console.error("Assessment start GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
