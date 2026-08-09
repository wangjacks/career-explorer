import { NextRequest, NextResponse } from "next/server";
import { getStudents, insertUser, getUserByCode, updateUser, deleteStudents, getClassByName } from "@/lib/db";

export async function GET() {
  const students = await getStudents();
  return NextResponse.json({ data: students, total: students.length });
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Single student
    if (body.studentId && body.name) {
      if (!/^\d{12}$/.test(body.studentId)) {
        return NextResponse.json({ error: "学号必须为12位数字" }, { status: 400 });
      }
      const existing = await getUserByCode(body.studentId);
      if (existing) {
        await updateUser(existing.id, { name: body.name });
      } else {
        await insertUser({ user_code: body.studentId, role: "student", name: body.name });
      }
      return NextResponse.json({ message: "添加成功" });
    }

    // Batch import
    if (Array.isArray(body.students)) {
      const valid = body.students.filter(
        (s: { studentId: string; name: string }) =>
          s.studentId && /^\d{12}$/.test(s.studentId) && s.name
      );
      if (valid.length === 0) {
        return NextResponse.json({ error: "没有有效的学生数据" }, { status: 400 });
      }
      for (const s of valid) {
        const existing = await getUserByCode(s.studentId);
        if (existing) {
          await updateUser(existing.id, { name: s.name });
        } else {
          await insertUser({ user_code: s.studentId, role: "student", name: s.name });
        }
      }
      return NextResponse.json({ message: `导入 ${valid.length} 名学生` });
    }

    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  } catch (err) {
    console.error("Students POST error:", err);
    return NextResponse.json({ error: "添加失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的学生" }, { status: 400 });
    }
    const deleted = await deleteStudents(ids);
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 名学生` });
  } catch (err) {
    console.error("Students DELETE error:", err);
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}

export async function PUT(request: NextRequest) {
  try {
    const body = await request.json();
    const { studentId, name, className } = body;
    if (!studentId || (name === undefined && className === undefined)) {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    const existing = await getUserByCode(studentId);
    if (!existing) {
      return NextResponse.json({ error: "学号不存在" }, { status: 404 });
    }
    const fields: { name?: string; class_id?: number | null } = {};
    if (name !== undefined) fields.name = name;
    if (className !== undefined) {
      if (!className) {
        fields.class_id = null;
      } else {
        const cls = await getClassByName(className);
        if (cls) fields.class_id = cls.id;
        // 班级不存在时保持不变（班级管理在步骤 8 实现）
      }
    }
    await updateUser(existing.id, fields);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Students PUT error:", err);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}
