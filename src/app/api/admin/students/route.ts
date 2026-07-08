import { NextRequest, NextResponse } from "next/server";
import { getAllStudents, insertStudent, insertStudentsBatch, deleteStudents } from "@/lib/db";

function checkAuth(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const password = process.env.ADMIN_PASSWORD || "admin123";
  return auth === `Bearer ${password}`;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const students = await getAllStudents();
  return NextResponse.json({ data: students, total: students.length });
}

export async function POST(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const body = await request.json();

    // Single student
    if (body.studentId && body.name) {
      if (!/^\d{12}$/.test(body.studentId)) {
        return NextResponse.json({ error: "学号必须为12位数字" }, { status: 400 });
      }
      await insertStudent(body.studentId, body.name);
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
      await insertStudentsBatch(valid);
      return NextResponse.json({ message: `导入 ${valid.length} 名学生` });
    }

    return NextResponse.json({ error: "参数错误" }, { status: 400 });
  } catch {
    return NextResponse.json({ error: "添加失败" }, { status: 500 });
  }
}

export async function DELETE(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const { ids } = await request.json();
    if (!Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json({ error: "请选择要删除的学生" }, { status: 400 });
    }
    const deleted = await deleteStudents(ids);
    return NextResponse.json({ deleted, message: `已删除 ${deleted} 名学生` });
  } catch {
    return NextResponse.json({ error: "删除失败" }, { status: 500 });
  }
}
