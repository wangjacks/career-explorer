import { NextRequest, NextResponse } from "next/server";
import { deleteGroupEntry, getClassGroupMembers, getClassGroups, insertGroupEntry } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, canModifyClass } from "../../classes/helpers";
import { actorOf, groupFailureWriter } from "../helpers";

const CREATE_AUDIT = {
  action: "group:create",
  method: "POST",
  path: "/api/manage/groups/entries",
  resource_type: "group",
} as const;

const DELETE_AUDIT = {
  action: "group:delete",
  method: "DELETE",
  path: "/api/manage/groups/entries",
  resource_type: "group",
} as const;

/** POST：新建一个空组（组号缺省时取「当前最大组号 + 1」） */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const fail = groupFailureWriter(request, CREATE_AUDIT);
  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = (await request.json()) as { classId?: unknown; groupNo?: unknown };
    const classId = Number(body.classId);
    if (!Number.isInteger(classId) || classId <= 0) {
      fail(session, "缺少或无效的 classId", { classId: body.classId, groupNo: body.groupNo });
      return NextResponse.json({ error: "缺少或无效的 classId" }, { status: 400 });
    }
    if (!(await canModifyClass(session, classId))) {
      fail(session, "无权调整该班级分组", { classId, groupNo: body.groupNo });
      return NextResponse.json({ error: "无权调整该班级分组" }, { status: 403 });
    }

    const nos = (await getClassGroups(classId)).map((g) => g.group_no);
    const groupNo =
      body.groupNo === undefined || body.groupNo === null
        ? (nos.length ? Math.max(...nos) : 0) + 1
        : Number(body.groupNo);
    if (!Number.isInteger(groupNo) || groupNo <= 0) {
      fail(session, "组号必须为正整数", { classId, groupNo: body.groupNo });
      return NextResponse.json({ error: "组号必须为正整数" }, { status: 400 });
    }
    if (nos.includes(groupNo)) {
      fail(session, `第 ${groupNo} 组已存在`, { classId, groupNo });
      return NextResponse.json({ error: `第 ${groupNo} 组已存在` }, { status: 409 });
    }

    await insertGroupEntry(classId, groupNo);
    void recordAudit({
      ...actorOf(session),
      ...CREATE_AUDIT,
      resource_id: String(classId),
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { classId, groupNo },
    });
    return NextResponse.json({ ok: true, groupNo });
  } catch (err) {
    console.error("Group entries POST error:", err);
    fail(session, err instanceof Error ? err.message : "新建分组失败");
    return NextResponse.json({ error: "新建分组失败" }, { status: 500 });
  }
}

/**
 * DELETE：删除一个**空组**（`?classId=&groupNo=`）。
 * 非空组一律拒绝——避免一次误操作把整组学生带走；要删先移人。
 */
export async function DELETE(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const fail = groupFailureWriter(request, DELETE_AUDIT);
  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const classId = Number(request.nextUrl.searchParams.get("classId"));
    const groupNo = Number(request.nextUrl.searchParams.get("groupNo"));
    if (!Number.isInteger(classId) || classId <= 0 || !Number.isInteger(groupNo) || groupNo <= 0) {
      fail(session, "缺少或无效的 classId / groupNo", { classId, groupNo });
      return NextResponse.json({ error: "缺少或无效的 classId / groupNo" }, { status: 400 });
    }
    if (!(await canModifyClass(session, classId))) {
      fail(session, "无权调整该班级分组", { classId, groupNo });
      return NextResponse.json({ error: "无权调整该班级分组" }, { status: 403 });
    }

    const target = (await getClassGroups(classId)).find((g) => g.group_no === groupNo);
    if (!target) {
      fail(session, `第 ${groupNo} 组不存在`, { classId, groupNo });
      return NextResponse.json({ error: `第 ${groupNo} 组不存在` }, { status: 404 });
    }
    const members = await getClassGroupMembers(classId);
    if (members.some((m) => m.group_id === target.id)) {
      fail(session, "该组还有成员，请先移到其他组", { classId, groupNo });
      return NextResponse.json({ error: "该组还有成员，请先移到其他组" }, { status: 400 });
    }

    await deleteGroupEntry(classId, groupNo);
    void recordAudit({
      ...actorOf(session),
      ...DELETE_AUDIT,
      resource_id: String(classId),
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { classId, groupNo },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Group entries DELETE error:", err);
    fail(session, err instanceof Error ? err.message : "删除分组失败");
    return NextResponse.json({ error: "删除分组失败" }, { status: 500 });
  }
}
