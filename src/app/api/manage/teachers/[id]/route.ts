import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { getTeachers, updateUser, deleteTeacher } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

/** PUT：重置密码 / 改名（#110：改名记 old/new；密码绝不入 metadata） */
export async function PUT(request: NextRequest, { params }: Ctx) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "无效的教师 ID" }, { status: 400 });
    }

    const teachers = await getTeachers();
    const target = teachers.find((t) => t.id === id);
    if (!target) {
      void recordAudit({
        ...actor, action: "teacher:update", method: "PUT", path: `/api/manage/teachers/${id}`,
        resource_type: "teacher", resource_id: String(id),
        status: "failed", error_message: "教师不存在", ip, user_agent, metadata: null,
      });
      return NextResponse.json({ error: "教师不存在" }, { status: 404 });
    }

    const { name, password } = await request.json();
    const fields: { name?: string; password_hash?: string } = {};

    if (name !== undefined) {
      const teacherName = String(name).trim();
      if (!teacherName) {
        return NextResponse.json({ error: "姓名不能为空" }, { status: 400 });
      }
      fields.name = teacherName;
    }
    if (password !== undefined) {
      const pwd = String(password);
      if (pwd.length < 8) {
        return NextResponse.json({ error: "密码须至少 8 位" }, { status: 400 });
      }
      fields.password_hash = await hashPassword(pwd);
    }
    if (Object.keys(fields).length === 0) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }

    await updateUser(id, fields);
    void recordAudit({
      ...actor, action: "teacher:update", method: "PUT", path: `/api/manage/teachers/${id}`,
      resource_type: "teacher", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: {
        nameChanged: name !== undefined,
        passwordReset: password !== undefined,
        ...(name !== undefined ? { old: { name: target.name }, new: { name: fields.name } } : {}),
      },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Teacher PUT error:", err);
    return NextResponse.json({ error: "更新教师失败" }, { status: 500 });
  }
}

/** DELETE：删除教师（数据层事务内连带清理 teacher_classes） */
export async function DELETE(request: NextRequest, { params }: Ctx) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "无效的教师 ID" }, { status: 400 });
    }

    const teachers = await getTeachers();
    const target = teachers.find((t) => t.id === id);
    if (!target) {
      return NextResponse.json({ error: "教师不存在" }, { status: 404 });
    }

    await deleteTeacher(id);
    void recordAudit({
      ...actor, action: "teacher:delete", method: "DELETE", path: `/api/manage/teachers/${id}`,
      resource_type: "teacher", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: { user_code: target.user_code, name: target.name },
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Teacher DELETE error:", err);
    return NextResponse.json({ error: "删除教师失败" }, { status: 500 });
  }
}
