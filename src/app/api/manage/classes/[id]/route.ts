import { NextRequest, NextResponse } from "next/server";
import { getClassByName, getClasses, updateClass, deleteClass } from "@/lib/db";
import { getSession, canModifyClass } from "../helpers";
import { getRequestContext, recordAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** PATCH：班级改名（#110：记 old/new） */
export async function PATCH(request: NextRequest, { params }: Ctx) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "无效的班级 ID" }, { status: 400 });
    }

    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canModifyClass(session, id))) {
      return NextResponse.json({ error: "无权修改该班级" }, { status: 403 });
    }

    const { name } = await request.json();
    const className = String(name ?? "").trim();
    if (!className) {
      return NextResponse.json({ error: "请输入班级名称" }, { status: 400 });
    }

    const existing = await getClassByName(className);
    if (existing && existing.id !== id) {
      return NextResponse.json({ error: "班级名称已存在" }, { status: 409 });
    }

    const classes = await getClasses();
    const oldName = classes.find((c) => c.id === id)?.name ?? null;
    await updateClass(id, { name: className });
    void recordAudit({
      actor_id: session.uid ?? null, actor_user_code: null, actor_name: session.name ?? null, actor_role: session.role ?? null,
      action: "class:update", method: "PATCH", path: `/api/manage/classes/${id}`,
      resource_type: "class", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: { old: { name: oldName }, new: { name: className } },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Class PATCH error:", err);
    return NextResponse.json({ error: "更新班级失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "无效的班级 ID" }, { status: 400 });
    }

    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canModifyClass(session, id))) {
      return NextResponse.json({ error: "无权删除该班级" }, { status: 403 });
    }

    const classes = await getClasses();
    const target = classes.find((c) => c.id === id);
    if (!target) {
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }

    await deleteClass(id);
    void recordAudit({
      actor_id: session.uid ?? null, actor_user_code: null, actor_name: session.name ?? null, actor_role: session.role ?? null,
      action: "class:delete", method: "DELETE", path: `/api/manage/classes/${id}`,
      resource_type: "class", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: { name: target.name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Class DELETE error:", err);
    return NextResponse.json({ error: "删除班级失败" }, { status: 500 });
  }
}
