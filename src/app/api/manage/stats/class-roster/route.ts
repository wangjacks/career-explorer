import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getClassRoster } from "@/lib/db";
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
 */
async function GET_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const className = String(request.nextUrl.searchParams.get("class") ?? "").trim();

  if (!className || className.length > MAX_CLASS_NAME_LENGTH) {
    void recordAudit({
      ...actor,
      action: "class:roster",
      method: "GET",
      path: "/api/manage/stats/class-roster",
      resource_type: "class",
      resource_id: className || null,
      status: "failed",
      error_message: "班级参数缺失或过长",
      ip,
      user_agent,
      metadata: null,
    });
    return NextResponse.json({ error: "请指定要查看的班级" }, { status: 400 });
  }

  try {
    const rows = await getClassRoster(className);
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
      resource_id: className,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      // 只记聚合，不把学生姓名/学号写进审计
      metadata: { className, total: students.length, submitted },
    });

    return NextResponse.json({
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
      resource_id: className,
      status: "failed",
      error_message: err instanceof Error ? err.message : "获取班级名册失败",
      ip,
      user_agent,
      metadata: { className },
    });
    return NextResponse.json({ error: "获取班级名册失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
