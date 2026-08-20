import { NextRequest, NextResponse } from "next/server";
import { getClassByName, getClasses, updateClass, deleteClass } from "@/lib/db";
import { getSession, canModifyClass } from "../helpers";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(request: NextRequest, { params }: Ctx) {
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

    await updateClass(id, { name: className });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Class PATCH error:", err);
    return NextResponse.json({ error: "更新班级失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest, { params }: Ctx) {
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
    if (!classes.some((c) => c.id === id)) {
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }

    await deleteClass(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Class DELETE error:", err);
    return NextResponse.json({ error: "删除班级失败" }, { status: 500 });
  }
}
