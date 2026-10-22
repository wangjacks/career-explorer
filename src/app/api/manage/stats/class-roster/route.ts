import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getClassById, getClassByName, getClassRoster } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { isSubmitted } from "@/lib/student-status";
import { isUnassignedClassKey, UNASSIGNED_CLASS_LABEL } from "@/lib/class-identity";
import { normalizeClassName } from "@/lib/class-utils";

const MAX_CLASS_KEY_LENGTH = 80;
/** 正整数 id 的上限长度（同 roster 接口）：超长即畸形请求，限长后再落审计 */
const MAX_CLASS_ID_LENGTH = 18;

/** tags 存的是名称数组 JSON；脏数据/空值一律按 0 计，不阻断名册返回 */
function countTags(tags: string | null): number {
  if (!tags) return 0;
  try {
    const parsed: unknown = JSON.parse(tags);
    return Array.isArray(parsed) ? parsed.length : 0;
  } catch {
    return 0;
  }
}

/**
 * 班级名册（#217/#260）：`?class=` 是统计分组键（班名或 `__unassigned__`）。
 * 班名先经 getClassByName 解析成 class_id，再按 class_id 取名册——不写 `WHERE name = ?`，
 * 真实班名「未分班」与未分班学生因此不会合并。学号返回完整值、由前端脱敏展示。
 *
 * #313 起另支持 `?classId=`（正整数，**优先于** `class`）：班级改名后按班名的分组键会失效
 * （改名即换 key），而 `classId` 是稳定主键、永远指向同一个班。非法 `classId` → 400；
 * 库里没有这个班 → 404（与「参数非法」区分）。两者同时给出时以 `classId` 为准。
 */
async function GET_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const params = request.nextUrl.searchParams;

  const classIdParam = params.get("classId");
  let requestedClassId: number | null = null;
  if (classIdParam !== null && classIdParam.trim() !== "") {
    const rawClassId = classIdParam.trim();
    // 正整数 id 远短于这个上限；超长值直接判非法，避免畸形串被原样写进审计
    requestedClassId = rawClassId.length > MAX_CLASS_ID_LENGTH ? NaN : Number(rawClassId);
    if (!Number.isInteger(requestedClassId) || requestedClassId <= 0) {
      const clipped = rawClassId.slice(0, MAX_CLASS_ID_LENGTH);
      void recordAudit({
        ...actor,
        action: "class:roster",
        method: "GET",
        path: "/api/manage/stats/class-roster",
        resource_type: "class",
        resource_id: clipped,
        status: "failed",
        error_message: "classId 必须是正整数",
        ip,
        user_agent,
        metadata: { classId: clipped },
      });
      return NextResponse.json({ error: "classId 必须是正整数" }, { status: 400 });
    }
  }

  const classKeyParam = normalizeClassName(params.get("class") ?? "");

  if (requestedClassId === null && (!classKeyParam || classKeyParam.length > MAX_CLASS_KEY_LENGTH)) {
    void recordAudit({
      ...actor,
      action: "class:roster",
      method: "GET",
      path: "/api/manage/stats/class-roster",
      resource_type: "class",
      resource_id: classKeyParam || null,
      status: "failed",
      error_message: "班级参数缺失或过长",
      ip,
      user_agent,
      metadata: null,
    });
    return NextResponse.json({ error: "请指定要查看的班级" }, { status: 400 });
  }

  try {
    let classId: number | null = null;
    let className = UNASSIGNED_CLASS_LABEL;
    // 响应与审计里的分组键：真实班级用它当前的班名，未分班用内部哨兵键
    let classKey = classKeyParam;

    if (requestedClassId !== null) {
      const klass = await getClassById(requestedClassId);
      if (!klass) {
        void recordAudit({
          ...actor,
          action: "class:roster",
          method: "GET",
          path: "/api/manage/stats/class-roster",
          resource_type: "class",
          resource_id: classKeyParam || String(requestedClassId),
          status: "failed",
          error_message: "班级不存在",
          ip,
          user_agent,
          metadata: { classId: requestedClassId, classKey: classKeyParam || null },
        });
        return NextResponse.json({ error: "班级不存在" }, { status: 404 });
      }
      classId = klass.id;
      className = klass.name;
      classKey = klass.name;
    } else if (!isUnassignedClassKey(classKeyParam)) {
      const klass = await getClassByName(classKeyParam);
      if (!klass) {
        void recordAudit({
          ...actor,
          action: "class:roster",
          method: "GET",
          path: "/api/manage/stats/class-roster",
          resource_type: "class",
          resource_id: classKeyParam,
          status: "failed",
          error_message: "班级不存在或已改名",
          ip,
          user_agent,
          metadata: { classKey: classKeyParam },
        });
        return NextResponse.json({ error: "班级不存在或已改名" }, { status: 404 });
      }
      classId = klass.id;
      className = klass.name;
    }

    const rows = await getClassRoster(classId);
    const students = rows.map((row) => {
      const submitted = isSubmitted(row.submitted_at);
      return {
        name: row.name,
        userCode: row.user_code,
        submitted,
        submittedAt: submitted ? row.submitted_at : null,
        tagCount: countTags(row.tags),
      };
    });
    const submitted = students.filter((student) => student.submitted).length;

    void recordAudit({
      ...actor,
      action: "class:roster",
      method: "GET",
      path: "/api/manage/stats/class-roster",
      resource_type: "class",
      resource_id: classKey,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      // 只记聚合，不把学生姓名/学号写进审计
      metadata: { classKey, className, classId, total: students.length, submitted },
    });

    return NextResponse.json({
      classKey,
      className,
      total: students.length,
      submitted,
      students,
    });
  } catch (err) {
    console.error("Class roster GET error:", err);
    void recordAudit({
      ...actor,
      action: "class:roster",
      method: "GET",
      path: "/api/manage/stats/class-roster",
      resource_type: "class",
      resource_id: classKeyParam || null,
      status: "failed",
      error_message: err instanceof Error ? err.message : "获取班级名册失败",
      ip,
      user_agent,
      metadata: { classKey: classKeyParam || null, classId: requestedClassId },
    });
    return NextResponse.json({ error: "获取班级名册失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
