import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getGroupSession } from "@/lib/group-workspace-access";
import { getStudentWorkspaceContext, listStudentWorkspaces } from "@/lib/db";

/**
 * GET：学生本人可回看的工作区（当前批次 + 历史批次，新→旧）。
 * 历史批次只读：这里只给定位信息，内容由 posts/tasks 的 `?workspaceId=` 读取。
 */
async function GET_impl(request: NextRequest) {
  try {
    const session = await getGroupSession(request);
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    if (session.role !== "student") {
      return NextResponse.json({ error: "仅学生可回看小组工作区" }, { status: 403 });
    }
    const [current, rows] = await Promise.all([
      getStudentWorkspaceContext(session.uid),
      listStudentWorkspaces(session.uid),
    ]);
    const currentWorkspaceId = current?.workspace.id ?? null;
    return NextResponse.json({
      currentWorkspaceId,
      workspaces: rows.map((row) => ({
        workspaceId: row.workspaceId,
        batchId: row.batchId,
        batchCreatedAt: row.batchCreatedAt,
        groupNo: row.groupNo,
        title: row.title,
        isCurrent: row.workspaceId === currentWorkspaceId,
      })),
    });
  } catch (err) {
    console.error("Group history GET error:", err);
    return NextResponse.json({ error: "批次记录加载失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
