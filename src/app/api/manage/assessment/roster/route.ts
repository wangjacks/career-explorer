import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentByCode,
  getAssessmentMissingRoster,
  getAssessmentRoster,
  getEnabledAssessments,
} from "@/lib/db";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { HOLLAND_TIE_BREAK_ORDER } from "@/lib/assessment-scoring";
import { rosterBands, type AssessmentRosterBand } from "@/lib/assessment-dashboard";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, writableClassIds } from "../../classes/helpers";

/** 允许的范围参数：`all` / `mine` 只为与聚合接口保持同一套前端调用口径 */
const SCOPES = ["all", "mine"] as const;
type Scope = (typeof SCOPES)[number];

/** 名册状态（#313）：`done` 已完测（默认）/ `missing` 只列还没测的人 */
const STATUSES = ["done", "missing"] as const;
type RosterStatus = (typeof STATUSES)[number];

/** 量表 code 与 classId 都是短标识：超长值是畸形请求，限长后再落审计（不让审计表被垃圾串撑大） */
const MAX_SCALE_LENGTH = 64;
const MAX_CLASS_ID_LENGTH = 18;

/** 名册返回的个人字段白名单：已完测只给下钻弹窗需要的四项 + 测评结论，多一个都不给 */
interface RosterItem {
  classId: number | null;
  className: string | null;
  name: string;
  userCode: string;
  code: string;
  assessedAt: string;
}

/** dimensional 量表（如大五）的已测行：只给档位，**不给 raw / standard** */
interface RosterBandItem {
  classId: number | null;
  className: string | null;
  name: string;
  userCode: string;
  /** 逐维档位（与 `rosterBands` 同一类型，避免手写副本慢慢漂移） */
  bands: AssessmentRosterBand[];
  assessedAt: string;
}

/** 未完成名单行（#313）：只有定位信息，没有任何测评字段 */
interface MissingRosterItem {
  classId: number | null;
  className: string | null;
  name: string;
  userCode: string;
}

/**
 * 教师端测评名册（#229）：已完测学生的 `{ 姓名, 学号, 三字码, 完成时间 }`，供班级完成度下钻。
 *
 * 这是全仓**唯一**把测评结果和姓名学号放在一起的端点，因此边界比聚合接口严：
 * - **教师恒收窄到本人归属班级**（`teacher_classes`）：显式传别的班的 `classId` 直接 403（不静默忽略、
 *   不返回空列表），`scope=mine` / `scope=all` 对教师都是本人班级——明细永不放宽（取舍见 `docs/architecture.md`）；
 * - 管理员不受班级限制（全校排查）；
 * - **每次读取都记审计**（`assessment:roster`），被拒的请求同样记 failed，便于事后追溯谁查过谁。
 *
 * #313 起支持多量表与「谁还没测」：
 * - `scale`：默认 `riasec`，显式取值必须命中**启用量表**的完整 `code`（`ipip` 这类缩写一律 400）；
 * - `status`：`done`（默认）或 `missing`——`missing` 以在册学生为基准取「没有该量表当前有效结果」的人，
 *   含**只有草稿**的学生，且不会把教师/管理员账号算进来；
 * - `lead` / `code` 只对 `scale=riasec` 且 `status=done` 有意义，组合不成立时**明确 400**，
 *   绝不静默忽略（静默忽略会让教师以为筛过了）。
 */
async function GET_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const auditBase = {
    method: "GET",
    path: "/api/manage/assessment/roster",
    resource_type: "assessment",
    ip,
    user_agent,
  };

  try {
    const [actor, session] = await Promise.all([getAuditActor(request), getSession(request)]);
    const deny = async (
      message: string,
      status: number,
      metadata?: unknown,
      resourceId: string = RIASEC_CODE
    ) => {
      await recordAudit({
        ...actor,
        ...auditBase,
        resource_id: resourceId,
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

    // 量表（#313）：白名单来自**启用量表**的完整 code，缩写不认——「ipip」与「ipip-neo-ffi」
    // 是两个不同口径，放行缩写会让调用方以为查了另一套量表
    const scaleParam = params.get("scale");
    let scale = RIASEC_CODE;
    if (scaleParam !== null && scaleParam.trim() !== "") {
      const rawScale = scaleParam.trim();
      const normalized = rawScale.toLowerCase();
      const enabled =
        rawScale.length > MAX_SCALE_LENGTH ? [] : await getEnabledAssessments();
      if (!enabled.some((row) => row.code === normalized)) {
        return await deny(
          "scale 只支持已启用的量表",
          400,
          {
            scope,
            classId: null,
            lead: null,
            code: null,
            scale: rawScale.slice(0, MAX_SCALE_LENGTH),
            status: null,
          },
          normalized.slice(0, MAX_SCALE_LENGTH)
        );
      }
      scale = normalized;
    }

    // 名册状态（#313）：只有 done / missing 两种，大小写与空白都不放宽
    const statusParam = (params.get("status") ?? "").trim();
    if (statusParam !== "" && !STATUSES.includes(statusParam as RosterStatus)) {
      return await deny(
        "status 只支持 done / missing",
        400,
        { scope, classId: null, lead: null, code: null, scale, status: statusParam },
        scale
      );
    }
    const status = (statusParam === "" ? "done" : statusParam) as RosterStatus;

    const classIdParam = params.get("classId");
    let classId: number | null = null;
    if (classIdParam !== null && classIdParam.trim() !== "") {
      const rawClassId = classIdParam.trim();
      classId = rawClassId.length > MAX_CLASS_ID_LENGTH ? NaN : Number(rawClassId);
      if (!Number.isInteger(classId) || classId <= 0) {
        return await deny(
          "classId 必须是正整数",
          400,
          {
            scope,
            classId: rawClassId.slice(0, MAX_CLASS_ID_LENGTH),
            lead: null,
            code: null,
            scale,
            status,
          },
          scale
        );
      }
    }

    const leadParam = params.get("lead");
    let lead: string | null = null;
    if (leadParam !== null && leadParam.trim() !== "") {
      const normalized = leadParam.trim().toUpperCase();
      if (!(HOLLAND_TIE_BREAK_ORDER as readonly string[]).includes(normalized)) {
        return await deny(
          "lead 只支持 R / I / A / S / E / C",
          400,
          { scope, classId, lead: leadParam, code: null, scale, status },
          scale
        );
      }
      lead = normalized;
    }

    // 三字码精确过滤（#232 大屏胶囊下钻）：1–3 位 RIASEC 字母，与 lead 是「且」关系
    const codeParam = params.get("code");
    let code: string | null = null;
    if (codeParam !== null && codeParam.trim() !== "") {
      const normalized = codeParam.trim().toUpperCase();
      if (!/^[RIASEC]{1,3}$/.test(normalized)) {
        return await deny(
          "code 只支持 1–3 位 RIASEC 字母",
          400,
          { scope, classId, lead, code: codeParam, scale, status },
          scale
        );
      }
      code = normalized;
    }

    // 组合校验（#313）：类型过滤只对「霍兰德 + 已完测」成立。另外两种口径下这些参数没有意义，
    // 静默忽略会让教师以为名单已按类型筛过，所以明确拒绝
    if ((lead !== null || code !== null) && (scale !== RIASEC_CODE || status === "missing")) {
      return await deny(
        "lead / code 只支持 scale=riasec 且 status=done 的名册",
        400,
        { scope, classId, lead, code, scale, status },
        scale
      );
    }

    // 教师只能取本人归属班级；集合为空说明该教师还没带班，直接按空范围查询（不会越权到全校）
    let classIds: number[] | null = null;
    if (session.role === "teacher") {
      classIds = [...((await writableClassIds(session)) ?? [])];
      if (classId !== null && !classIds.includes(classId)) {
        return await deny(
          "无权查看该班级的测评名册",
          403,
          { scope, classId, lead, code, scale, status },
          scale
        );
      }
    }

    const assessment = await getAssessmentByCode(scale);
    if (!assessment) {
      return await deny(
        "测评量表未配置",
        404,
        { scope, classId, lead, code, scale, status },
        scale
      );
    }

    // 全量表以「档位」呈现（#313）：dimensional 量表没有三字码，教师要看的是五维高低档
    const isDimensional = assessment.scoring_mode === "dimensional";

    let data: RosterItem[] | RosterBandItem[] | MissingRosterItem[];
    if (status === "missing") {
      const rows = await getAssessmentMissingRoster(assessment.id, classIds, { classId });
      data = rows.map((row) => ({
        classId: row.class_id,
        className: row.class_name,
        name: row.name,
        userCode: row.user_code,
      }));
    } else {
      const rows = await getAssessmentRoster(assessment.id, classIds, {
        classId,
        lead,
        code,
        includeScores: isDimensional,
      });
      data = isDimensional
        ? rows.map((row) => ({
            classId: row.class_id,
            className: row.class_name,
            name: row.name,
            userCode: row.user_code,
            bands: rosterBands(row.scores_json),
            assessedAt: row.assessed_at,
          }))
        : rows.map((row) => ({
            classId: row.class_id,
            className: row.class_name,
            name: row.name,
            userCode: row.user_code,
            // 已完测的 typological 结果必然有三字码；脏数据缺码时给空串，前端按「无型」显示
            code: row.code ?? "",
            assessedAt: row.assessed_at,
          }));
    }

    await recordAudit({
      ...actor,
      ...auditBase,
      resource_id: scale,
      action: "assessment:roster",
      status: "success",
      error_message: null,
      metadata: {
        scope,
        classId,
        lead,
        code,
        scale,
        status,
        rowCount: data.length,
        // 教师只看得到归属班级，记下范围便于审计核对；管理员为 null（未收窄）
        classScope: classIds,
      },
    });

    return NextResponse.json({
      scope,
      filters: { classId, lead, code, scale, status },
      total: data.length,
      data,
    });
  } catch (err) {
    console.error("Assessment roster GET error:", err);
    return NextResponse.json({ error: "获取测评名册失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
