import { NextRequest, NextResponse } from "next/server";
import { getMaxProfileSubmissions, getStudentsExceedingSubmissionLimit, getTeacherClassPairs } from "@/lib/db";
import { verifyToken } from "@/lib/token";

/** 超限学生列表（#95）：admin 全量；teacher 仅限管辖班级 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid || result.uid == null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (result.role !== "admin" && result.role !== "teacher") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const maxVersions = await getMaxProfileSubmissions();
    const rows = await getStudentsExceedingSubmissionLimit(maxVersions);

    // teacher 班级限制：仅返回管辖班级内的超限学生
    let students = rows;
    if (result.role === "teacher") {
      const pairs = await getTeacherClassPairs();
      const allowedClassIds = new Set(
        pairs.filter((p) => p.teacher_id === result.uid).map((p) => p.class_id)
      );
      students = rows.filter((r) => r.class_id != null && allowedClassIds.has(r.class_id));
    }

    return NextResponse.json({ maxVersions, students });
  } catch (err) {
    console.error("Exceeding GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
