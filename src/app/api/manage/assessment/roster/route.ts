import { NextRequest, NextResponse } from "next/server";
import { getAssessmentByCode, getAssessmentRoster } from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { HOLLAND_TIE_BREAK_ORDER } from "@/lib/assessment-scoring";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, writableClassIds } from "../../classes/helpers";

/** 允许的范围参数：`all` / `mine` 只为与聚合接口保持同一套前端调用口径 */
const SCOPES = ["all", "mine"] as const;
type Scope = (typeof SCOPES)[number];

/** 名册返回的个人字段白名单：只给下钻弹窗需要的四项，多一个都不给 */
interface RosterItem {
  classId: number | null;
  className: string | null;
  name: string;
  userCode: string;
  code: string;
  assessedAt: string;
}

/**
 * 教师端测评名册（#229）：已完测学生的 `{ 姓名, 学号, 三字码, 完成时间 }`，供班级完成度下钻。
 *
 * 这是全仓**唯一**把测评结果和姓名学号放在一起的端点，因此边界比聚合接口严：
 * - **教师恒收窄到本人归属班级**（`teacher_classes`）：显式传别的班的 `classId` 直接 403（不静默忽略、
 *   不返回空列表），`scope=mine` / `scope=all` 对教师都是本人班级——明细永不放宽（取舍见 `docs/architecture.md`）；
 * - 管理员不受班级限制（全校排查）；
 * - **每次读取都记审计**（`assessment:roster`），被拒的请求同样记 failed，便于事后追溯谁查过谁。
 */
export async function GET(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const auditBase = {
    method: "GET",
    path: "/api/manage/assessment/roster",
    resource_type: "assessment",
    resource_id: RIASEC_CODE,
    ip,
    user_agent,
  };

  try {
    const [actor, session] = await Promise.all([getAuditActor(request), getSession(request)]);
    const deny = async (message: string, status: number, metadata?: unknown) => {
      await recordAudit({
        ...actor,
        ...auditBase,
        action: "assessment:roster",
        status: "failed",
        error_message: message,
        metadata,
      });
      return NextResponse.json({ error: message }, { status });
    };

    if (!session || (session.role !== "admin" && session.role !== "teacher")) {
      return await deny("仅教师与管理员可查看测评名册", 403);
    }

    const params = request.nextUrl.searchParams;
    const scopeParam = params.get("scope") ?? "all";
    if (!SCOPES.includes(scopeParam as Scope)) {
      return await deny("scope 只支持 all / mine", 400);
    }
    const scope = scopeParam as Scope;

    const classIdParam = params.get("classId");
    let classId: number | null = null;
    if (classIdParam !== null && classIdParam.trim() !== "") {
      classId = Number(classIdParam);
      if (!Number.isInteger(classId) || classId <= 0) {
        return await deny("classId 必须是正整数", 400);
      }
    }

    const leadParam = params.get("lead");
    let lead: string | null = null;
    if (leadParam !== null && leadParam.trim() !== "") {
      const normalized = leadParam.trim().toUpperCase();
      if (!(HOLLAND_TIE_BREAK_ORDER as readonly string[]).includes(normalized)) {
        return await deny("lead 只支持 R / I / A / S / E / C", 400);
      }
      lead = normalized;
    }

    // 教师只能取本人归属班级；集合为空说明该教师还没带班，直接按空范围查询（不会越权到全校）
    let classIds: number[] | null = null;
    if (session.role === "teacher") {
      classIds = [...((await writableClassIds(session)) ?? [])];
      if (classId !== null && !classIds.includes(classId)) {
        return await deny("无权查看该班级的测评名册", 403, { classId, scope });
      }
    }

    const assessment = await getAssessmentByCode(RIASEC_CODE);
    if (!assessment) {
      return await deny("测评量表未配置", 404, { classId, lead, scope });
    }

    const rows = await getAssessmentRoster(assessment.id, classIds, { classId, lead });
    const data: RosterItem[] = rows.map((row) => ({
      classId: row.class_id,
      className: row.class_name,
      name: row.name,
      userCode: row.user_code,
      code: row.code,
      assessedAt: row.assessed_at,
    }));

    await recordAudit({
      ...actor,
      ...auditBase,
      action: "assessment:roster",
      status: "success",
      error_message: null,
      metadata: {
        scope,
        classId,
        lead,
        rowCount: data.length,
        // 教师只看得到归属班级，记下范围便于审计核对；管理员为 null（未收窄）
        classScope: classIds,
      },
    });

    return NextResponse.json({
      scope,
      filters: { classId, lead },
      total: data.length,
      data,
    });
  } catch (err) {
    console.error("Assessment roster GET error:", err);
    return NextResponse.json({ error: "获取测评名册失败" }, { status: 500 });
  }
}
