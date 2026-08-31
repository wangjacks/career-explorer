import { NextRequest, NextResponse } from "next/server";
import { getProfileSubmissions } from "@/lib/db";
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

/** 学生历史提交列表（#95）：仅本人可见，按版本倒序返回完整快照元数据 */
export async function GET(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "请先登录" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid) {
      return NextResponse.json({ error: "登录已过期，请重新登录" }, { status: 401 });
    }
    if (result.role !== "student" || result.uid == null) {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const rows = await getProfileSubmissions(result.uid);
    return NextResponse.json({
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
    console.error("Submissions GET error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
