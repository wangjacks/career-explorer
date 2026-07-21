import { NextRequest, NextResponse } from "next/server";
import { getAllStudents, insertStudent, insertStudentsBatch, deleteStudents, updateStudentClass } from "@/lib/db";

export async function GET() {
  const students = await getAllStudents();
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
      await insertStudent(body.studentId, body.name, body.className || "");
      return NextResponse.json({ message: "添加成功" });
    }

    // Batch import
    if (Array.isArray(body.students)) {
      const valid = body.students.filter(
        (s: { studentId: string; name: string; className?: string }) =>
          s.studentId && /^\d{12}$/.test(s.studentId) && s.name
      );
      if (valid.length === 0) {
        return NextResponse.json({ error: "没有有效的学生数据" }, { status: 400 });
      }
      await insertStudentsBatch(valid);
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
    const { studentId, className } = await request.json();
    if (!studentId || typeof className !== "string") {
      return NextResponse.json({ error: "参数错误" }, { status: 400 });
    }
    await updateStudentClass(studentId, className);
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Students PUT error:", err);
    return NextResponse.json({ error: "更新失败" }, { status: 500 });
  }
}
