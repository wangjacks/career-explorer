import { NextRequest, NextResponse } from "next/server";
import { getStudentByCode, getTags } from "@/lib/db";
import { tagIdsToNames } from "@/lib/tag-utils";

export async function POST(request: NextRequest) {
  try {
    const { studentId } = await request.json();

    if (!studentId || !/^\d{12}$/.test(studentId)) {
      return NextResponse.json({ ok: false, error: "学号必须为12位数字" }, { status: 400 });
    }

    const student = await getStudentByCode(studentId);

    if (student) {
      const hasProfile = !!student.submitted_at;
      let profile: { tags: string[]; avatarUrl: string; evaluationUrl: string } | null = null;
      if (hasProfile && student.tags) {
        const allTags = await getTags();
        let ids: number[] = [];
        try {
          ids = JSON.parse(student.tags) as number[];
        } catch {}
        profile = {
          tags: tagIdsToNames(ids, allTags),
          avatarUrl: student.avatar_url || "",
          evaluationUrl: student.evaluation_url || "",
        };
      }
      return NextResponse.json({
        ok: true,
        name: student.name,
        studentId: student.user_code,
        hasProfile,
        profile,
      });
    }

    return NextResponse.json({ ok: false, error: "学号不存在" }, { status: 404 });
  } catch (err) {
    console.error("Validate-student error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}
