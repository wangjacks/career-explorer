import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getRequestContext, recordAudit } from "@/lib/audit";
import {
  countRecentGroupTasks,
  getGroupBatchDetail,
  insertGroupTask,
  listGroupTasks,
} from "@/lib/db";
import {
  getGroupSession,
  resolveStudentWorkspace,
  resolveTeacherWorkspace,
  sessionActor,
  type GroupSession,
  type ResolvedWorkspace,
} from "@/lib/group-workspace-access";
import {
  GROUP_RATE_WINDOW_MS,
  GROUP_TASK_RATE_MAX,
  errorMessage,
  formatLocalDateTime,
  validateTaskInput,
} from "@/lib/group-workspace";
import { toGroupTaskView, type GroupTaskView } from "@/lib/group-workspace-view";

const PATH = "/api/shared/group/tasks";
const RESOURCE = "group_task";

function rateWindowStart(): string {
  return formatLocalDateTime(new Date(Date.now() - GROUP_RATE_WINDOW_MS));
}

function parseOptionalPositiveInt(value: string | null): number | null | "invalid" {
  if (value === null || value === "") return null;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : "invalid";
}

function auditDenied(
  request: NextRequest,
  session: GroupSession,
  action: string,
  reason: string,
  metadata: unknown
): void {
  const { ip, user_agent } = getRequestContext(request);
  void recordAudit({
    ...sessionActor(session),
    action,
    method: request.method,
    path: PATH,
    resource_type: RESOURCE,
    resource_id: null,
    status: "failed",
    error_message: reason,
    ip,
    user_agent,
    metadata,
  });
}

function auditSuccess(
  request: NextRequest,
  session: GroupSession,
  action: string,
  resourceId: number,
  metadata: unknown
): void {
  const { ip, user_agent } = getRequestContext(request);
  void recordAudit({
    ...sessionActor(session),
    action,
    method: request.method,
    path: PATH,
    resource_type: RESOURCE,
    resource_id: String(resourceId),
    status: "success",
    error_message: null,
    ip,
    user_agent,
    metadata,
  });
}

/** GET：任务列表（学生当前/历史工作区；教师本人班级当前工作区） */
async function GET_impl(request: NextRequest) {
  try {
    const session = await getGroupSession(request);
    if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });
    const url = new URL(request.url);

    let resolved: ResolvedWorkspace | null = null;
    if (session.role === "student") {
      const workspaceId = parseOptionalPositiveInt(url.searchParams.get("workspaceId"));
      if (workspaceId === "invalid") {
        return NextResponse.json({ error: "workspaceId 不合法" }, { status: 400 });
      }
      resolved = await resolveStudentWorkspace(session.uid, workspaceId);
      if (!resolved && workspaceId !== null) {
        return NextResponse.json({ error: "无权查看该工作区" }, { status: 403 });
      }
    } else {
      const classId = parseOptionalPositiveInt(url.searchParams.get("classId"));
      const groupNo = parseOptionalPositiveInt(url.searchParams.get("groupNo"));
      if (classId === "invalid" || groupNo === "invalid" || classId === null || groupNo === null) {
        return NextResponse.json({ error: "请指定班级和组号" }, { status: 400 });
      }
      resolved = await resolveTeacherWorkspace(session.uid, classId, groupNo);
      if (!resolved) {
        return NextResponse.json({ error: "无权查看该工作区" }, { status: 403 });
      }
    }

    if (!resolved) {
      return NextResponse.json({
        tasks: [] as GroupTaskView[],
        workspace: null,
        readOnly: false,
        canManage: false,
        canClaim: false,
      });
    }

    const tasks = await listGroupTasks(resolved.context.workspace.id);
    const now = formatLocalDateTime(new Date());
    return NextResponse.json({
      tasks: tasks.map((task) => toGroupTaskView(task, now)),
      workspace: {
        id: resolved.context.workspace.id,
        title: resolved.context.workspace.title,
        createdAt: resolved.context.workspace.created_at,
      },
      readOnly: resolved.readOnly,
      canManage: !resolved.readOnly && (session.role === "teacher" || resolved.isLeader),
      // 认领只对学生开放（教师/组长也可以认领，但那是「组员身份」的另一条语义，避免混淆只对学生下发）
      canClaim: session.role === "student" && !resolved.readOnly,
    });
  } catch (err) {
    console.error("Group tasks GET error:", err);
    return NextResponse.json({ error: "任务加载失败" }, { status: 500 });
  }
}

/**
 * POST：新建任务。组长与教师可建；可指定本组成员或留待认领。
 * 频率上限与公告同一窗口口径（每工作区每作者 60s 内 5 条）。
 */
async function POST_impl(request: NextRequest) {
  const session = await getGroupSession(request);
  if (!session) return NextResponse.json({ error: "请先登录" }, { status: 401 });

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "请求格式不正确" }, { status: 400 });
  }
  const payload = (body ?? {}) as Record<string, unknown>;
  const validated = validateTaskInput(payload.title, payload.description, payload.dueAt);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }
  const rawAssignee = payload.assigneeId;
  const assigneeId =
    rawAssignee === undefined || rawAssignee === null || rawAssignee === "" ? null : Number(rawAssignee);
  if (assigneeId !== null && (!Number.isInteger(assigneeId) || assigneeId <= 0)) {
    return NextResponse.json({ error: "认领人不存在" }, { status: 400 });
  }

  try {
    let resolved: ResolvedWorkspace | null = null;
    if (session.role === "student") {
      resolved = await resolveStudentWorkspace(session.uid, null);
      if (!resolved) {
        auditDenied(request, session, "group:task:create", "尚未分组或工作区未开启", {});
        return NextResponse.json({ error: "尚未分组或工作区未开启" }, { status: 403 });
      }
      if (!resolved.isLeader) {
        auditDenied(request, session, "group:task:create", "只有组长可新建任务", {
          workspaceId: resolved.context.workspace.id,
        });
        return NextResponse.json({ error: "只有组长可新建任务" }, { status: 403 });
      }
    } else {
      const classId = Number(payload.classId ?? request.nextUrl.searchParams.get("classId"));
      const groupNo = Number(payload.groupNo ?? request.nextUrl.searchParams.get("groupNo"));
      if (!Number.isInteger(classId) || !Number.isInteger(groupNo) || classId <= 0 || groupNo <= 0) {
        return NextResponse.json({ error: "请指定班级和组号" }, { status: 400 });
      }
      resolved = await resolveTeacherWorkspace(session.uid, classId, groupNo);
      if (!resolved) {
        auditDenied(request, session, "group:task:create", "无权在该班级工作区建任务", {
          classId,
          groupNo,
        });
        return NextResponse.json({ error: "无权在该班级工作区建任务" }, { status: 403 });
      }
    }

    const workspaceId = resolved.context.workspace.id;
    let assigneeName: string | null = null;
    if (assigneeId !== null) {
      const detail = await getGroupBatchDetail(resolved.context.batch.id);
      const batchGroup = detail.groups.find((group) => group.id === resolved.context.workspace.batch_group_id);
      const member = detail.members.find(
        (row) => row.group_id === batchGroup?.id && row.user_id === assigneeId
      );
      if (!member) {
        return NextResponse.json({ error: "只能指派本组成员" }, { status: 400 });
      }
      assigneeName = member.name ?? null;
    }

    const recent = await countRecentGroupTasks(workspaceId, session.uid, rateWindowStart());
    if (recent >= GROUP_TASK_RATE_MAX) {
      auditDenied(request, session, "group:task:create", "创建过于频繁", { workspaceId });
      return NextResponse.json({ error: "创建太频繁，请稍后再试" }, { status: 429 });
    }

    const taskId = await insertGroupTask({
      workspaceId,
      title: validated.value.title,
      description: validated.value.description,
      assigneeId,
      assigneeName,
      dueAt: validated.value.dueAt,
      createdById: session.uid,
      createdByName: session.name,
      createdByRole: session.role,
    });
    auditSuccess(request, session, "group:task:create", taskId, {
      workspaceId,
      batchId: resolved.context.batch.id,
      groupNo: resolved.context.workspace.group_no,
      assigneeId,
      hasDueAt: validated.value.dueAt !== null,
    });
    return NextResponse.json({ ok: true, taskId });
  } catch (err) {
    const { ip, user_agent } = getRequestContext(request);
    void recordAudit({
      ...sessionActor(session),
      action: "group:task:create",
      method: request.method,
      path: PATH,
      resource_type: RESOURCE,
      resource_id: null,
      status: "failed",
      error_message: errorMessage(err, "任务创建失败"),
      ip,
      user_agent,
      metadata: null,
    });
    console.error("Group tasks POST error:", err);
    return NextResponse.json({ error: "任务创建失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
export const POST = withDemoScope(POST_impl);
