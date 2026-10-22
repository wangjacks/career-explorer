import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getGroupPost, updateGroupPost } from "@/lib/db";
import {
  getGroupSession,
  resolveStudentWorkspace,
  resolveTeacherWorkspace,
  sessionActor,
  type GroupSession,
  type ResolvedWorkspace,
} from "@/lib/group-workspace-access";
import { formatLocalDateTime } from "@/lib/group-workspace";

const PATH = "/api/shared/group/posts/[id]";
const RESOURCE = "group_post";

function audit(
  request: NextRequest,
  session: GroupSession,
  action: string,
  resourceId: number | null,
  status: "success" | "failed",
  error: string | null,
  metadata: unknown
): void {
  const { ip, user_agent } = getRequestContext(request);
  void recordAudit({
    ...sessionActor(session),
    action,
    method: request.method,
    path: PATH,
    resource_type: RESOURCE,
    resource_id: resourceId === null ? null : String(resourceId),
    status,
    error_message: error,
    ip,
    user_agent,
    metadata,
  });
}

/** 同一套定位逻辑：学生当前工作区 / 教师本人班级；历史批次只读，写操作一律拒绝 */
async function resolveWritableWorkspace(
  request: NextRequest,
  session: GroupSession
): Promise<{ resolved?: ResolvedWorkspace; error?: NextResponse }> {
  if (session.role === "student") {
    const resolved = await resolveStudentWorkspace(session.uid, null);
    if (!resolved) {
      return { error: NextResponse.json({ error: "尚未分组或工作区未开启" }, { status: 403 }) };
    }
    if (resolved.readOnly) {
      return { error: NextResponse.json({ error: "历史批次工作区只能查看" }, { status: 403 }) };
    }
    return { resolved };
  }
  const classId = Number(request.nextUrl.searchParams.get("classId"));
  const groupNo = Number(request.nextUrl.searchParams.get("groupNo"));
  if (!Number.isInteger(classId) || !Number.isInteger(groupNo) || classId <= 0 || groupNo <= 0) {
    return { error: NextResponse.json({ error: "请指定班级和组号" }, { status: 400 }) };
  }
  const resolved = await resolveTeacherWorkspace(session.uid, classId, groupNo);
  if (!resolved) {
    return { error: NextResponse.json({ error: "无权操作该工作区" }, { status: 403 }) };
  }
  return { resolved };
}

/** PATCH：置顶 / 取消置顶（组长或教师，界面二次确认；接口幂等） */
async function PATCH_impl(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getGroupSession(request);
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await ctx.params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return NextResponse.json({ error: "公告不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const pinned =
    typeof (body as { pinned?: unknown } | null)?.pinned === "boolean"
      ? (body as { pinned: boolean }).pinned
      : null;
  if (pinned === null) {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }

  try {
    const located = await resolveWritableWorkspace(request, session);
    if (located.error) return located.error;
    const { resolved } = located;
    if (!resolved) return NextResponse.json({ error: "无权操作该工作区" }, { status: 403 });
    if (!(session.role === "teacher" || resolved.isLeader)) {
      audit(request, session, "group:post:pin", postId, "failed", "只有组长或教师可置顶公告", {
        workspaceId: resolved.context.workspace.id,
      });
      return NextResponse.json({ error: "只有组长或教师可置顶公告" }, { status: 403 });
    }
    const post = await getGroupPost(postId, resolved.context.workspace.id);
    if (!post) return NextResponse.json({ error: "公告不存在" }, { status: 404 });
    await updateGroupPost(postId, resolved.context.workspace.id, { pinned: pinned ? 1 : 0 });
    audit(request, session, "group:post:pin", postId, "success", null, {
      workspaceId: resolved.context.workspace.id,
      pinned,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Group post PATCH error:", err);
    audit(request, session, "group:post:pin", postId, "failed", "公告操作失败", null);
    return NextResponse.json({ error: "公告操作失败" }, { status: 500 });
  }
}

/** DELETE：软删除（保留审计链；只有组长或教师可删） */
async function DELETE_impl(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getGroupSession(request);
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await ctx.params;
  const postId = Number(id);
  if (!Number.isInteger(postId) || postId <= 0) {
    return NextResponse.json({ error: "公告不存在" }, { status: 404 });
  }
  try {
    const located = await resolveWritableWorkspace(request, session);
    if (located.error) return located.error;
    const { resolved } = located;
    if (!resolved) return NextResponse.json({ error: "无权操作该工作区" }, { status: 403 });
    if (!(session.role === "teacher" || resolved.isLeader)) {
      audit(request, session, "group:post:delete", postId, "failed", "只有组长或教师可删除公告", {
        workspaceId: resolved.context.workspace.id,
      });
      return NextResponse.json({ error: "只有组长或教师可删除公告" }, { status: 403 });
    }
    const post = await getGroupPost(postId, resolved.context.workspace.id);
    if (!post) return NextResponse.json({ error: "公告不存在" }, { status: 404 });
    await updateGroupPost(postId, resolved.context.workspace.id, {
      deleted_at: formatLocalDateTime(new Date()),
    });
    audit(request, session, "group:post:delete", postId, "success", null, {
      workspaceId: resolved.context.workspace.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Group post DELETE error:", err);
    audit(request, session, "group:post:delete", postId, "failed", "公告删除失败", null);
    return NextResponse.json({ error: "公告删除失败" }, { status: 500 });
  }
}

export const PATCH = withDemoScope(PATCH_impl);
export const DELETE = withDemoScope(DELETE_impl);
