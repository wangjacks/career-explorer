import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getClassById, getClassRoster } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { isSubmitted } from "@/lib/student-status";
import {
  isUnassignedClassKey,
  UNASSIGNED_CLASS_KEY,
  UNASSIGNED_CLASS_LABEL,
} from "@/lib/class-identity";
import { normalizeClassName } from "@/lib/class-utils";

/** 正整数 id 的上限长度（同 roster 接口）：超长即畸形请求，限长后再落审计 */
const MAX_CLASS_ID_LENGTH = 18;

/** 统计分组键只接受规范十进制 id 串；前导零、指数、小数一律视为非法 */
function parseClassId(raw: string): number | null {
  if (raw.length > MAX_CLASS_ID_LENGTH) return null;
  if (!/^[1-9]\d*$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

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
 * 班级名册（#217/#260/#374）：`?class=` 是统计分组键——真实班级的 `String(class_id)` 或
 * 未分班哨兵 `__unassigned__`。班名不再作为身份，旧班名入参一律 400。
 * `?classId=`（#313，正整数，**优先于** `class`）保留为稳定主键别名；两者同时给出时以它为准。
 * 非法键 → 400；键指向的班级不存在 → 404（与「参数非法」区分）。学号返回完整值、由前端脱敏展示。
 */
async function GET_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const params = request.nextUrl.searchParams;

  const classIdParam = params.get("classId");
  let requestedClassId: number | null = null;
  if (classIdParam !== null && classIdParam.trim() !== "") {
    const rawClassId = classIdParam.trim();
    requestedClassId = parseClassId(rawClassId);
    if (requestedClassId === null) {
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
  let classKey: string;
  if (requestedClassId !== null) {
    classKey = String(requestedClassId);
  } else if (!classKeyParam) {
    void recordAudit({
      ...actor,
      action: "class:roster",
      method: "GET",
      path: "/api/manage/stats/class-roster",
      resource_type: "class",
      resource_id: null,
      status: "failed",
      error_message: "请指定要查看的班级",
      ip,
      user_agent,
      metadata: null,
    });
    return NextResponse.json({ error: "请指定要查看的班级" }, { status: 400 });
  } else if (isUnassignedClassKey(classKeyParam)) {
    classKey = UNASSIGNED_CLASS_KEY;
  } else {
    const parsed = parseClassId(classKeyParam);
    if (parsed === null) {
      const clipped = classKeyParam.slice(0, MAX_CLASS_ID_LENGTH);
      void recordAudit({
        ...actor,
        action: "class:roster",
        method: "GET",
        path: "/api/manage/stats/class-roster",
        resource_type: "class",
        resource_id: clipped,
        status: "failed",
        error_message: "class 必须是班级 id 或 __unassigned__",
        ip,
        user_agent,
        metadata: { classKey: clipped },
      });
      return NextResponse.json(
        { error: "class 必须是班级 id 或 __unassigned__" },
        { status: 400 }
      );
    }
    requestedClassId = parsed;
    classKey = String(parsed);
  }

  try {
    let classId: number | null = null;
    let className = UNASSIGNED_CLASS_LABEL;

    if (requestedClassId !== null) {
      const klass = await getClassById(requestedClassId);
      if (!klass) {
        void recordAudit({
          ...actor,
          action: "class:roster",
          method: "GET",
          path: "/api/manage/stats/class-roster",
          resource_type: "class",
          resource_id: classKey,
          status: "failed",
          error_message: "班级不存在",
          ip,
          user_agent,
          metadata: { classId: requestedClassId, classKey },
        });
        return NextResponse.json({ error: "班级不存在" }, { status: 404 });
      }
      classId = klass.id;
      className = klass.name;
      classKey = String(klass.id);
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
      resource_id: classKey,
      status: "failed",
      error_message: err instanceof Error ? err.message : "获取班级名册失败",
      ip,
      user_agent,
      metadata: { classKey, classId: requestedClassId },
    });
    return NextResponse.json({ error: "获取班级名册失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
