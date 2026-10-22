import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getGroupSession } from "@/lib/group-workspace-access";
import { getGroupUnreadCount, getStudentWorkspaceContext } from "@/lib/db";

/**
 * GET：侧边栏「我的小组」红点用的轻量未读数。
 * 只读本组当前工作区；未分组时恒为 0（不查库，也不把别组内容算进来）。
 */
async function GET_impl(request: NextRequest) {
  try {
    const session = await getGroupSession(request);
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (session.role !== "student") {
      return NextResponse.json({ unreadCount: 0 });
    }
    const context = await getStudentWorkspaceContext(session.uid);
    if (!context) return NextResponse.json({ unreadCount: 0 });
    const unreadCount = await getGroupUnreadCount(context.workspace.id, session.uid);
    return NextResponse.json({ unreadCount });
  } catch (err) {
    console.error("Group unread GET error:", err);
    return NextResponse.json({ error: "未读数加载失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
