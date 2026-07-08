import { NextRequest, NextResponse } from "next/server";
import { getStudent } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { studentId } = await request.json();

    if (!studentId || !/^\d{12}$/.test(studentId)) {
      return NextResponse.json({ ok: false, error: "学号必须为12位数字" }, { status: 400 });
    }

    const student = await getStudent(studentId);

    if (student) {
      return NextResponse.json({ ok: true, name: student.name, studentId: student.student_id });
    }

    return NextResponse.json({ ok: false, error: "学号不存在" }, { status: 404 });
  } catch {
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}
