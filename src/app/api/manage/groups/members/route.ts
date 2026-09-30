import { NextRequest, NextResponse } from "next/server";
import { getStudentGroupRef, getUserById, moveGroupMember } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, canModifyClass } from "../../classes/helpers";
import { actorOf, groupFailureWriter, parseJsonBody } from "../helpers";

const AUDIT = {
  action: "group:move",
  method: "PATCH",
  path: "/api/manage/groups/members",
  resource_type: "group",
} as const;

/**
 * PATCH：把一个成员移到本班的另一个组（手工调整）。
 * 允许移入已满的组（界面标注「超员」）：规模规则只约束自动分组，教师的手工决定不阻断。
 */
export async function PATCH(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  // 被拒的调整也是审计对象（AGENTS.md：管理域写操作成败均记）
  const fail = groupFailureWriter(request, AUDIT);
  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await parseJsonBody<{
      classId?: unknown;
      userId?: unknown;
      toGroupNo?: unknown;
      userCode?: unknown;
    }>(request);
    if (!body) {
      fail(session, "请求体不是合法 JSON");
      return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
    }
    const classId = Number(body.classId);
    const userId = Number(body.userId);
    const toGroupNo = Number(body.toGroupNo);
    if (!Number.isInteger(classId) || !Number.isInteger(userId) || !Number.isInteger(toGroupNo)) {
      fail(session, "classId / userId / toGroupNo 必须为整数", { classId, userId, toGroupNo });
      return NextResponse.json({ error: "classId / userId / toGroupNo 必须为整数" }, { status: 400 });
    }
    if (!(await canModifyClass(session, classId))) {
      fail(session, "无权调整该班级分组", { classId, userId, toGroupNo });
      return NextResponse.json({ error: "无权调整该班级分组" }, { status: 403 });
    }

    // 归属以 users 表为准：只看组引用的话，「还没分组的学生」查不到引用就会被直接插进别班的组，
    // 传进来的教师 id / 不存在的 id 同样会被放过
    const target = await getUserById(userId);
    if (!target || target.role !== "student" || target.class_id !== classId) {
      fail(session, "该学生不在本班", { classId, userId, toGroupNo });
      return NextResponse.json({ error: "该学生不在本班" }, { status: 400 });
    }

    // 换人抽屉按学号提交：界面里那一份成员对象可能是打开抽屉之前的旧快照（他人已先被移走），
    // 以库里的 id 为准再认一次，避免把陈旧 id 当成本班学生写进别的组
    if (typeof body.userCode === "string" && body.userCode.trim() !== target.user_code) {
      fail(session, "学生标识与库中不一致", { classId, userId, userCode: body.userCode });
      return NextResponse.json({ error: "学生信息已变化，请刷新后重试" }, { status: 409 });
    }

    const current = await getStudentGroupRef(userId);
    // 引用指向别班 = 与名单不一致的脏数据，不把它的组号当作来源（下面的移动按 users 的班级为准）
    const fromGroupNo = current && current.class_id === classId ? current.group_no : null;
    if (fromGroupNo === toGroupNo) {
      return NextResponse.json({ ok: true, moved: false });
    }

    try {
      await moveGroupMember(classId, userId, toGroupNo);
    } catch (err) {
      // 可预期错误（目标组已被删）→ 400 而不是 500
      const raw = err instanceof Error ? err.message : "";
      // 只回显我们自己写的那句：驱动报错原文会泄露表名与索引名，且 SQLite / MySQL 文案不同
      const shown = raw === "目标组不存在" ? raw : "移动失败，请刷新后重试";
      fail(session, raw || shown, { classId, userId, fromGroupNo, toGroupNo });
      return NextResponse.json({ error: shown }, { status: 400 });
    }

    void recordAudit({
      ...actorOf(session),
      ...AUDIT,
      // resource_id 只到班级粒度：本次调整的定位信息全在 metadata
      resource_id: String(classId),
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { classId, userId, fromGroupNo, toGroupNo },
    });

    return NextResponse.json({ ok: true, moved: true, fromGroupNo, toGroupNo });
  } catch (err) {
    console.error("Group members PATCH error:", err);
    fail(session, err instanceof Error ? err.message : "移动成员失败");
    return NextResponse.json({ error: "移动成员失败" }, { status: 500 });
  }
}
