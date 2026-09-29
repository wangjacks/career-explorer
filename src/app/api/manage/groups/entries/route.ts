import { NextRequest, NextResponse } from "next/server";
import { deleteGroupEntry, getClassGroupMembers, getClassGroups, insertGroupEntry } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, canModifyClass } from "../../classes/helpers";

/** POST：新建一个空组（组号缺省时取「当前最大组号 + 1」） */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as { classId?: unknown; groupNo?: unknown };
    const classId = Number(body.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }
    if (!(await canModifyClass(session, classId))) {
      return NextResponse.json({ error: "无权调整该班级分组" }, { status: 403 });
    }

    const nos = (await getClassGroups(classId)).map((g) => g.group_no);
    const groupNo =
      body.groupNo === undefined || body.groupNo === null
        ? (nos.length ? Math.max(...nos) : 0) + 1
        : Number(body.groupNo);
    if (!Number.isInteger(groupNo) || groupNo <= 0) {
      return NextResponse.json({ error: "组号必须为正整数" }, { status: 400 });
    }
    if (nos.includes(groupNo)) {
      return NextResponse.json({ error: `第 ${groupNo} 组已存在` }, { status: 409 });
    }

    await insertGroupEntry(classId, groupNo);
    void recordAudit({
      actor_id: session.uid ?? null, actor_user_code: null, actor_name: session.name ?? null, actor_role: session.role ?? null,
      action: "group:create", method: "POST", path: "/api/manage/groups/entries",
      resource_type: "group", resource_id: String(classId),
      status: "success", error_message: null, ip, user_agent,
      metadata: { classId, groupNo },
    });
    return NextResponse.json({ ok: true, groupNo });
  } catch (err) {
    console.error("Group entries POST error:", err);
    return NextResponse.json({ error: "新建分组失败" }, { status: 500 });
  }
}

/**
 * DELETE：删除一个**空组**（`?classId=&groupNo=`）。
 * 非空组一律拒绝——避免一次误操作把整组学生带走；要删先移人。
 */
export async function DELETE(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const classId = Number(request.nextUrl.searchParams.get("classId"));
    const groupNo = Number(request.nextUrl.searchParams.get("groupNo"));
    if (!Number.isInteger(classId) || classId <= 0 || !Number.isInteger(groupNo) || groupNo <= 0) {
      return NextResponse.json({ error: "缺少或无效的 classId / groupNo" }, { status: 400 });
    }
    if (!(await canModifyClass(session, classId))) {
      return NextResponse.json({ error: "无权调整该班级分组" }, { status: 403 });
    }

    const target = (await getClassGroups(classId)).find((g) => g.group_no === groupNo);
    if (!target) {
      return NextResponse.json({ error: `第 ${groupNo} 组不存在` }, { status: 404 });
    }
    const members = await getClassGroupMembers(classId);
    if (members.some((m) => m.group_id === target.id)) {
      return NextResponse.json({ error: "该组还有成员，请先移到其他组" }, { status: 400 });
    }

    await deleteGroupEntry(classId, groupNo);
    void recordAudit({
      actor_id: session.uid ?? null, actor_user_code: null, actor_name: session.name ?? null, actor_role: session.role ?? null,
      action: "group:delete", method: "DELETE", path: "/api/manage/groups/entries",
      resource_type: "group", resource_id: String(classId),
      status: "success", error_message: null, ip, user_agent,
      metadata: { classId, groupNo },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Group entries DELETE error:", err);
    return NextResponse.json({ error: "删除分组失败" }, { status: 500 });
  }
}
