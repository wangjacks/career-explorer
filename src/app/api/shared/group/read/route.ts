import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getGroupSession } from "@/lib/group-workspace-access";
import { getStudentWorkspaceContext, markGroupWorkspaceRead } from "@/lib/db";

/**
 * POST：把本人在当前工作区的已读水位推进到当前时间（幂等）。
 * 未分组 / 未开启工作区时静默成功——没有可读的内容，不算错误。
 */
async function POST_impl(request: NextRequest) {
  try {
    const session = await getGroupSession(request);
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (session.role !== "student") {
      return NextResponse.json({ error: "仅学生可标记已读" }, { status: 403 });
    }
    const context = await getStudentWorkspaceContext(session.uid);
    if (!context) return NextResponse.json({ ok: true, unreadCount: 0 });
    await markGroupWorkspaceRead(context.workspace.id, session.uid);
    return NextResponse.json({ ok: true, unreadCount: 0 });
  } catch (err) {
    console.error("Group read POST error:", err);
    return NextResponse.json({ error: "标记已读失败" }, { status: 500 });
  }
}

export const POST = withDemoScope(POST_impl);
