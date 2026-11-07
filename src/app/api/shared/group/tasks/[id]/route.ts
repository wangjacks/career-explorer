import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getRequestContext, recordAudit } from "@/lib/audit";
import {
  claimGroupTask,
  getGroupTask,
  updateGroupTask,
} from "@/lib/db";
import {
  getGroupSession,
  resolveStudentWorkspace,
  resolveTeacherWorkspace,
  sessionActor,
  type GroupSession,
  type ResolvedWorkspace,
} from "@/lib/group-workspace-access";
import { formatLocalDateTime } from "@/lib/group-workspace";
import { toGroupTaskView } from "@/lib/group-workspace-view";

const PATH = "/api/shared/group/tasks/[id]";
const RESOURCE = "group_task";

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

/**
 * PATCH：认领 / 标记完成。
 * - 认领：组员（含组长）可认领「待认领」任务；服务端原子更新，抢输的一方拿 409；
 * - 完成：认领人、组长或教师可标记完成；重复完成幂等返回成功。
 */
async function PATCH_impl(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getGroupSession(request);
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const action = (body as { action?: unknown } | null)?.action;
  if (action !== "claim" && action !== "complete") {
    return NextResponse.json({ error: "不支持的操作" }, { status: 400 });
  }

  try {
    const located = await resolveWritableWorkspace(request, session);
    if (located.error) return located.error;
    const { resolved } = located;
    if (!resolved) return NextResponse.json({ error: "无权操作该工作区" }, { status: 403 });
    const workspaceId = resolved.context.workspace.id;
    const task = await getGroupTask(taskId, workspaceId);
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });

    if (action === "claim") {
      if (session.role !== "student") {
        return NextResponse.json({ error: "只有组员可以认领任务" }, { status: 403 });
      }
      if (task.status !== "open" || task.assignee_id !== null) {
        audit(request, session, "group:task:claim", taskId, "failed", "任务已被认领", { workspaceId });
        return NextResponse.json({ error: "任务已被认领" }, { status: 409 });
      }
      const claimed = await claimGroupTask(taskId, workspaceId, session.uid, session.name);
      if (!claimed) {
        // 并发窗口内被别的组员抢先：不覆盖别人的认领
        audit(request, session, "group:task:claim", taskId, "failed", "任务已被其他同学认领", {
          workspaceId,
        });
        return NextResponse.json({ error: "任务已被其他同学认领" }, { status: 409 });
      }
      const updated = await getGroupTask(taskId, workspaceId);
      audit(request, session, "group:task:claim", taskId, "success", null, { workspaceId });
      return NextResponse.json({
        ok: true,
        task: updated ? toGroupTaskView(updated, formatLocalDateTime(new Date())) : null,
      });
    }

    // complete：认领人 / 组长 / 教师
    if (task.status === "done") {
      return NextResponse.json({ ok: true, task: toGroupTaskView(task, formatLocalDateTime(new Date())) });
    }
    const canComplete =
      session.role === "teacher" || resolved.isLeader || task.assignee_id === session.uid;
    if (!canComplete) {
      audit(request, session, "group:task:complete", taskId, "failed", "只有认领人、组长或教师可标记完成", {
        workspaceId,
      });
      return NextResponse.json({ error: "只有认领人、组长或教师可标记完成" }, { status: 403 });
    }
    if (task.status === "open") {
      return NextResponse.json({ error: "请先认领任务" }, { status: 400 });
    }
    const completedAt = formatLocalDateTime(new Date());
    await updateGroupTask(taskId, workspaceId, { status: "done", completed_at: completedAt });
    const updated = await getGroupTask(taskId, workspaceId);
    audit(request, session, "group:task:complete", taskId, "success", null, { workspaceId });
    return NextResponse.json({
      ok: true,
      task: updated ? toGroupTaskView(updated, completedAt) : null,
    });
  } catch (err) {
    console.error("Group task PATCH error:", err);
    audit(request, session, "group:task:update", taskId, "failed", "任务操作失败", null);
    return NextResponse.json({ error: "任务操作失败" }, { status: 500 });
  }
}

/** DELETE：软删除（组长或教师；保留审计链） */
async function DELETE_impl(request: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const session = await getGroupSession(request);
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
  const { id } = await ctx.params;
  const taskId = Number(id);
  if (!Number.isInteger(taskId) || taskId <= 0) {
    return NextResponse.json({ error: "任务不存在" }, { status: 404 });
  }
  try {
    const located = await resolveWritableWorkspace(request, session);
    if (located.error) return located.error;
    const { resolved } = located;
    if (!resolved) return NextResponse.json({ error: "无权操作该工作区" }, { status: 403 });
    if (!(session.role === "teacher" || resolved.isLeader)) {
      audit(request, session, "group:task:delete", taskId, "failed", "只有组长或教师可删除任务", {
        workspaceId: resolved.context.workspace.id,
      });
      return NextResponse.json({ error: "只有组长或教师可删除任务" }, { status: 403 });
    }
    const task = await getGroupTask(taskId, resolved.context.workspace.id);
    if (!task) return NextResponse.json({ error: "任务不存在" }, { status: 404 });
    await updateGroupTask(taskId, resolved.context.workspace.id, {
      deleted_at: formatLocalDateTime(new Date()),
    });
    audit(request, session, "group:task:delete", taskId, "success", null, {
      workspaceId: resolved.context.workspace.id,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Group task DELETE error:", err);
    audit(request, session, "group:task:delete", taskId, "failed", "任务删除失败", null);
    return NextResponse.json({ error: "任务删除失败" }, { status: 500 });
  }
}

export const PATCH = withDemoScope(PATCH_impl);
export const DELETE = withDemoScope(DELETE_impl);
