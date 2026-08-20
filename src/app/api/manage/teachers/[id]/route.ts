import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { getTeachers, updateUser, deleteTeacher } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** PUT：重置密码 / 改名 */
export async function PUT(request: NextRequest, { params }: Ctx) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "无效的教师 ID" }, { status: 400 });
    }

    const teachers = await getTeachers();
    if (!teachers.some((t) => t.id === id)) {
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
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Teacher PUT error:", err);
    return NextResponse.json({ error: "更新教师失败" }, { status: 500 });
  }
}

/** DELETE：删除教师（数据层事务内连带清理 teacher_classes） */
export async function DELETE(_request: NextRequest, { params }: Ctx) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "无效的教师 ID" }, { status: 400 });
    }

    const teachers = await getTeachers();
    if (!teachers.some((t) => t.id === id)) {
      return NextResponse.json({ error: "教师不存在" }, { status: 404 });
    }

    await deleteTeacher(id);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Teacher DELETE error:", err);
    return NextResponse.json({ error: "删除教师失败" }, { status: 500 });
  }
}
