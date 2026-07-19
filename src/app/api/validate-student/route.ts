import { NextRequest, NextResponse } from "next/server";
import { getStudent, getProfile } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    const { studentId } = await request.json();

    if (!studentId || !/^\d{12}$/.test(studentId)) {
      return NextResponse.json({ ok: false, error: "学号必须为12位数字" }, { status: 400 });
    }

    const student = await getStudent(studentId);

    if (student) {
      const profile = await getProfile(studentId);
      return NextResponse.json({
        ok: true,
        name: student.name,
        studentId: student.student_id,
        hasProfile: !!profile,
        profile: profile
          ? { tags: JSON.parse(profile.tags), avatarUrl: profile.avatar_url, evaluationUrl: profile.evaluation_url }
          : null,
      });
    }

    return NextResponse.json({ ok: false, error: "学号不存在" }, { status: 404 });
  } catch (err) {
    console.error("Validate-student error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}
