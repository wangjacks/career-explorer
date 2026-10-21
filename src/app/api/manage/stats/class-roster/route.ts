import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getClassById, getClassRoster, getClassRosterById } from "@/lib/db";
import type { ClassRosterRow } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import { isSubmitted } from "@/lib/student-status";

const MAX_CLASS_NAME_LENGTH = 80;

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
 * 班级名册（#217）：按班名返回学生提交明细，供教师大屏「具体查看」弹窗使用。
 * 只读；班名口径与 /api/manage/stats/compare 一致（未分班 = '未分班'）。
 * 学号返回完整值、由前端展示时脱敏，这样教师仍可按完整学号搜索。
 *
 * #313 起支持 `classId`（正整数）：**优先于**按班名匹配。班名匹配在班级改名后要么命中不到、
 * 要么命中同名班；`classId` 是稳定主键，改名不影响。两者同时给出时以 `classId` 为准，
 * `class` 参数保留兼容。非法 `classId` → 400；库里没有这个班 → 404（与「参数非法」区分）。
 */
async function GET_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const params = request.nextUrl.searchParams;

  const classIdParam = params.get("classId");
  let classId: number | null = null;
  if (classIdParam !== null && classIdParam.trim() !== "") {
    classId = Number(classIdParam);
    if (!Number.isInteger(classId) || classId <= 0) {
      void recordAudit({
        ...actor,
        action: "class:roster",
        method: "GET",
        path: "/api/manage/stats/class-roster",
        resource_type: "class",
        resource_id: classIdParam,
        status: "failed",
        error_message: "classId 必须是正整数",
        ip,
        user_agent,
        metadata: { classId: classIdParam },
      });
      return NextResponse.json({ error: "classId 必须是正整数" }, { status: 400 });
    }
  }

  const classNameParam = String(params.get("class") ?? "").trim();

  if (classId === null && (!classNameParam || classNameParam.length > MAX_CLASS_NAME_LENGTH)) {
    void recordAudit({
      ...actor,
      action: "class:roster",
      method: "GET",
      path: "/api/manage/stats/class-roster",
      resource_type: "class",
      resource_id: classNameParam || null,
      status: "failed",
      error_message: "班级参数缺失或过长",
      ip,
      user_agent,
      metadata: null,
    });
    return NextResponse.json({ error: "请指定要查看的班级" }, { status: 400 });
  }

  try {
    // classId 优先：按 id 定位不受改名影响；两者同时给出时忽略 class，但响应仍回显真实班名
    const className = classNameParam;
    let resolvedName: string;
    let rows: ClassRosterRow[];

    if (classId !== null) {
      const cls = await getClassById(classId);
      if (!cls) {
        void recordAudit({
          ...actor,
          action: "class:roster",
          method: "GET",
          path: "/api/manage/stats/class-roster",
          resource_type: "class",
          resource_id: className || null,
          status: "failed",
          error_message: "班级不存在",
          ip,
          user_agent,
          metadata: { classId, className: className || null },
        });
        return NextResponse.json({ error: "班级不存在" }, { status: 404 });
      }
      resolvedName = cls.name;
      rows = await getClassRosterById(classId);
    } else {
      resolvedName = className;
      rows = await getClassRoster(resolvedName);
    }

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
      resource_id: resolvedName,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      // 只记聚合，不把学生姓名/学号写进审计
      metadata: { className: resolvedName, total: students.length, submitted, classId },
    });

    return NextResponse.json({
      className: resolvedName,
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
      resource_id: classNameParam || null,
      status: "failed",
      error_message: err instanceof Error ? err.message : "获取班级名册失败",
      ip,
      user_agent,
      metadata: { className: classNameParam || null, classId },
    });
    return NextResponse.json({ error: "获取班级名册失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
