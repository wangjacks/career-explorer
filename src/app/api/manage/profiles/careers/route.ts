import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentByCode,
  getCurrentAssessmentResultsByUserCodes,
  getOnetOccupations,
  getUserById,
} from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { RIASEC_CODE } from "@/lib/assessment-data";
import {
  hollandWeights,
  normalizeHollandCode,
  profileFromDimensionScores,
  rankCareers,
  type RiasecVector,
} from "@/lib/assessment-match";
import { ONET_ATTRIBUTION, toCareerCandidates } from "@/lib/onet";
import { canWriteStudent, getSession, writableClassIds } from "../../classes/helpers";

/** 教师端只读推荐职业固定 Top3（#332）；不开放 limit 参数，避免把端点变成通用职业检索 */
const TEACHER_CAREER_TOP_N = 3;

/**
 * GET `/api/manage/profiles/careers?studentId=`：教师端档案详情弹窗的「推荐职业 Top3」（#332）。
 *
 * 安全边界（与 #229 名册端点同一口径，**比列表读更严**）：
 * - 仅教师 / 管理员；教师**恒收窄到本人关联班级**的学生（未分班/他班一律 403）；
 * - **每次读取（含被拒）都记审计** `assessment:careers`；
 * - 只返回 Top3 职业（中文名 / 英文名 / 职业群 / 学历）与 O*NET CC BY 4.0 署名，
 *   **不含姓名、学号、六维分等个人信息**——弹窗需要的身份信息已在列表行里；
 * - 匹配复用 `assessment-match.ts` 的纯函数（不重写算法），画像优先结果快照六维标准分、
 *   其次三字码权重，两者都没有时显式 409。
 */
async function GET_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const auditBase = {
    action: "assessment:careers",
    method: "GET",
    path: "/api/manage/profiles/careers",
    resource_type: "assessment",
    ip,
    user_agent,
  } as const;

  try {
    const [actor, session] = await Promise.all([getAuditActor(request), getSession(request)]);
    const deny = async (message: string, status: number, metadata?: unknown) => {
      await recordAudit({
        ...actor,
        ...auditBase,
        resource_id: RIASEC_CODE,
        status: "failed",
        error_message: message,
        metadata,
      });
      return NextResponse.json({ error: message }, { status });
    };

    if (!session || (session.role !== "admin" && session.role !== "teacher")) {
      return await deny("仅教师与管理员可查看学生推荐职业", 403);
    }

    const rawStudentId = request.nextUrl.searchParams.get("studentId");
    const studentId = Number(rawStudentId);
    if (!Number.isInteger(studentId) || studentId <= 0) {
      return await deny("缺少或无效的 studentId", 400, { studentId: rawStudentId });
    }

    const student = await getUserById(studentId);
    if (!student || student.role !== "student") {
      return await deny("学生不存在", 404, { studentId });
    }
    // 归属校验：教师只能看本人关联班级的学生（未分班学生不属于任何教师）
    const scope = await writableClassIds(session);
    if (!canWriteStudent(scope, student)) {
      return await deny("该学生不在你管理的班级", 403, { studentId, classId: student.class_id });
    }

    const assessment = await getAssessmentByCode(RIASEC_CODE);
    if (!assessment) {
      return await deny("测评量表未配置", 503);
    }
    const results = await getCurrentAssessmentResultsByUserCodes(assessment.id, [student.user_code]);
    const result = results[0];
    if (!result) {
      return await deny("该生还没有完成霍兰德测评", 404, { studentId });
    }

    // 画像来源与共享端点同口径：六维标准分优先，只有三字码时按 3/2/1 权重兜底
    let profile: RiasecVector | null = null;
    if (result.scores_json) {
      try {
        profile = profileFromDimensionScores(
          JSON.parse(result.scores_json) as { key: string; standard: number }[]
        );
      } catch (err) {
        console.error("Teacher careers: 解析得分快照失败", err);
      }
    }
    const profileSource = profile ? "scores" : "typeCode";
    if (!profile) profile = hollandWeights(normalizeHollandCode(result.type_code));
    if (!profile) {
      return await deny("测评结果缺少可用于匹配的分数", 409, { studentId });
    }

    const rows = await getOnetOccupations();
    if (rows.length === 0) {
      return await deny("职业库为空，请先导入 O*NET 数据", 503);
    }

    const careers = rankCareers(profile, toCareerCandidates(rows), { topN: TEACHER_CAREER_TOP_N });
    // 只回职业卡片需要的字段；不把匹配画像 / 学生标识带出服务端
    const out = careers.map((career) => ({
      code: career.code,
      name: career.name,
      nameZh: career.nameZh ?? null,
      cluster: career.cluster ?? null,
      educationLevel: career.educationLevel ?? null,
    }));

    await recordAudit({
      ...actor,
      ...auditBase,
      resource_id: `${RIASEC_CODE}:${studentId}`,
      status: "success",
      error_message: null,
      metadata: {
        studentId,
        classId: student.class_id,
        count: out.length,
        profileSource,
        // 六维画像只用于服务端匹配，审计里也不落具体分值
        topCode: out[0]?.code ?? null,
      },
    });

    return NextResponse.json({
      careers: out,
      attribution: ONET_ATTRIBUTION,
    });
  } catch (err) {
    console.error("Teacher profile careers GET error:", err);
    await recordAudit({
      action: auditBase.action,
      method: auditBase.method,
      path: auditBase.path,
      resource_type: auditBase.resource_type,
      actor_id: null,
      actor_user_code: null,
      actor_name: null,
      actor_role: null,
      resource_id: RIASEC_CODE,
      status: "failed",
      error_message: "获取学生推荐职业失败",
      ip,
      user_agent,
      metadata: null,
    });
    return NextResponse.json({ error: "获取学生推荐职业失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);