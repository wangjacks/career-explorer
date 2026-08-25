import { NextRequest, NextResponse } from "next/server";
import {
  deleteOldestProfileSubmissions,
  getMaxProfileSubmissions,
  getProfileSubmissions,
  getUserById,
} from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/** 手动清理超限版本（#95）：仅 admin；删除最旧版本至上限（仅删 DB 记录，文件保留） */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    const result = await verifyToken(token);
    if (!result.valid || result.uid == null) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
    if (result.role !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = (await request.json()) as { userId?: unknown };
    const userId = Number(body.userId);
    if (!Number.isInteger(userId) || userId <= 0) {
      return NextResponse.json({ error: "userId 参数无效" }, { status: 400 });
    }
    const student = await getUserById(userId);
    if (!student || student.role !== "student") {
      return NextResponse.json({ error: "学生不存在" }, { status: 404 });
    }

    const maxVersions = await getMaxProfileSubmissions();
    const rows = await getProfileSubmissions(userId);
    const excess = rows.length - maxVersions;
    const deleted = excess > 0 ? await deleteOldestProfileSubmissions(userId, excess) : 0;

    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor, action: "profile-submission:cleanup", method: "POST", path: "/api/manage/profiles/submissions/cleanup",
      resource_type: "profile-submission", resource_id: String(userId),
      status: "success", error_message: null, ip, user_agent,
      metadata: { userCode: student.user_code, maxVersions, totalBefore: rows.length, deleted },
    });
    return NextResponse.json({ deleted, remaining: rows.length - deleted, maxVersions });
  } catch (err) {
    console.error("Cleanup POST error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
