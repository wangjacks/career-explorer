import { NextRequest, NextResponse } from "next/server";
import { getProfileSubmissions, getUserById, getTeacherClassPairs } from "@/lib/db";
import { verifyToken } from "@/lib/token";

/** 解析快照标签 JSON（容忍非法值返回空数组） */
function parseTags(raw: string | null): string[] {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.map((t) => String(t)) : [];
  } catch {
    return [];
  }
}

/** 管理端查看学生提交历史（#95）：admin 全量；teacher 仅限管辖班级（storage-sign 同款班级白名单） */
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

    const userId = Number(request.nextUrl.searchParams.get("userId"));
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "userId 参数无效" }, { status: 400 });
    }
    const student = await getUserById(userId);
    if (!student || student.role !== "student") {
      return NextResponse.json({ error: "学生不存在" }, { status: 404 });
    }
    // teacher 班级限制：目标学生必须属于管辖班级（防越权查看其他班级）
    if (result.role === "teacher") {
      const pairs = await getTeacherClassPairs();
      const allowedClassIds = new Set(
        pairs.filter((p) => p.teacher_id === result.uid).map((p) => p.class_id)
      );
      if (student.class_id == null || !allowedClassIds.has(student.class_id)) {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }
    }

    const rows = await getProfileSubmissions(userId);
    return NextResponse.json({
      student: { id: student.id, user_code: student.user_code, name: student.name },
      submissions: rows.map((r) => ({
        id: r.id,
        version: r.version,
        tags: parseTags(r.tags),
        avatar_url: r.avatar_url,
        evaluation_url: r.evaluation_url,
        storage_id: r.storage_id,
        submitted_at: r.submitted_at,
        is_current: r.is_current,
      })),
    });
  } catch (err) {
    console.error("Admin submissions GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
