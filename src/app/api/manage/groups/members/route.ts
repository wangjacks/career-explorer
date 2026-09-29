import { NextRequest, NextResponse } from "next/server";
import { getStudentGroupRef, getUserById, moveGroupMember } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, canModifyClass } from "../../classes/helpers";

/**
 * PATCH：把一个成员移到本班的另一个组（手工调整）。
 * 允许移入已满的组（界面标注「超员」）：规模规则只约束自动分组，教师的手工决定不阻断。
 */
export async function PATCH(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as { classId?: unknown; userId?: unknown; toGroupNo?: unknown };
    const classId = Number(body.classId);
    const userId = Number(body.userId);
    const toGroupNo = Number(body.toGroupNo);
    if (!Number.isInteger(classId) || !Number.isInteger(userId) || !Number.isInteger(toGroupNo)) {
      return NextResponse.json({ error: "classId / userId / toGroupNo 必须为整数" }, { status: 400 });
    }
    if (!(await canModifyClass(session, classId))) {
      return NextResponse.json({ error: "无权调整该班级分组" }, { status: 403 });
    }

    // 归属以 users 表为准：只看组引用的话，「还没分组的学生」查不到引用就会被直接插进别班的组，
    // 传进来的教师 id / 不存在的 id 同样会被放过
    const target = await getUserById(userId);
    if (!target || target.role !== "student" || target.class_id !== classId) {
      return NextResponse.json({ error: "该学生不在本班" }, { status: 400 });
    }

    const current = await getStudentGroupRef(userId);
    // 引用指向别班 = 成员行没跟着转班清理（脏数据），此时不把这条幽灵行的组号当作来源
    const fromGroupNo = current && current.class_id === classId ? current.group_no : null;
    if (fromGroupNo === toGroupNo) {
      return NextResponse.json({ ok: true, moved: false });
    }

    try {
      await moveGroupMember(classId, userId, toGroupNo);
    } catch (err) {
      // 目标组不存在（已被删除）等可预期错误 → 400 而不是 500
      const message = err instanceof Error ? err.message : "移动失败";
      return NextResponse.json({ error: message }, { status: 400 });
    }

    void recordAudit({
      actor_id: session.uid ?? null, actor_user_code: null, actor_name: session.name ?? null, actor_role: session.role ?? null,
      action: "group:move", method: "PATCH", path: "/api/manage/groups/members",
      // resource_id 只到班级粒度：本次调整的定位信息全在 metadata
      resource_type: "group", resource_id: String(classId),
      status: "success", error_message: null, ip, user_agent,
      metadata: { classId, userId, fromGroupNo, toGroupNo },
    });

    return NextResponse.json({ ok: true, moved: true, fromGroupNo, toGroupNo });
  } catch (err) {
    console.error("Group members PATCH error:", err);
    return NextResponse.json({ error: "移动成员失败" }, { status: 500 });
  }
}
