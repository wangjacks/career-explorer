import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { getRequestContext, recordAudit } from "@/lib/audit";
import {
  countRecentGroupPosts,
  getGroupUnreadCount,
  insertGroupPost,
  listGroupPosts,
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
  GROUP_POST_RATE_MAX,
  GROUP_RATE_WINDOW_MS,
  errorMessage,
  formatLocalDateTime,
  validatePostInput,
} from "@/lib/group-workspace";
import { toGroupPostView, type GroupPostView } from "@/lib/group-workspace-view";

const PATH = "/api/shared/group/posts";
const RESOURCE = "group_post";

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

/**
 * GET：读一个工作区的公告。
 * - 学生：不传 workspaceId = 当前工作区；传了必须是本人历史批次（只读回看）。
 * - 教师：必须带 classId + groupNo，限本人带的班。
 * 返回 canManage 只用于界面显隐；写接口仍逐次校验。
 */
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
        posts: [] as GroupPostView[],
        workspace: null,
        unreadCount: 0,
        readOnly: false,
        canManage: false,
      });
    }

    const [posts, unreadCount] = await Promise.all([
      listGroupPosts(resolved.context.workspace.id),
      getGroupUnreadCount(resolved.context.workspace.id, session.uid),
    ]);
    return NextResponse.json({
      posts: posts.map(toGroupPostView),
      workspace: {
        id: resolved.context.workspace.id,
        title: resolved.context.workspace.title,
        createdAt: resolved.context.workspace.created_at,
      },
      unreadCount,
      readOnly: resolved.readOnly,
      canManage: !resolved.readOnly && (session.role === "teacher" || resolved.isLeader),
    });
  } catch (err) {
    console.error("Group posts GET error:", err);
    return NextResponse.json({ error: "公告加载失败" }, { status: 500 });
  }
}

/**
 * POST：发布公告。组长与教师可发（服务端校验，不靠界面隐藏）；
 * 长度与频率（同作者 60s 内 5 条）在服务端拦，被拒写记审计。
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
  const validated = validatePostInput(payload.title, payload.content);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  try {
    let resolved: ResolvedWorkspace | null = null;
    if (session.role === "student") {
      resolved = await resolveStudentWorkspace(session.uid, null);
      if (!resolved) {
        auditDenied(request, session, "group:post:create", "尚未分组或工作区未开启", {});
        return NextResponse.json({ error: "尚未分组或工作区未开启" }, { status: 403 });
      }
      if (!resolved.isLeader) {
        auditDenied(request, session, "group:post:create", "只有组长可发布公告", {
          workspaceId: resolved.context.workspace.id,
        });
        return NextResponse.json({ error: "只有组长可发布公告" }, { status: 403 });
      }
    } else {
      const classId = Number(payload.classId ?? request.nextUrl.searchParams.get("classId"));
      const groupNo = Number(payload.groupNo ?? request.nextUrl.searchParams.get("groupNo"));
      if (!Number.isInteger(classId) || !Number.isInteger(groupNo) || classId <= 0 || groupNo <= 0) {
        return NextResponse.json({ error: "请指定班级和组号" }, { status: 400 });
      }
      resolved = await resolveTeacherWorkspace(session.uid, classId, groupNo);
      if (!resolved) {
        auditDenied(request, session, "group:post:create", "无权向该班级工作区发布公告", {
          classId,
          groupNo,
        });
        return NextResponse.json({ error: "无权向该班级工作区发布公告" }, { status: 403 });
      }
    }

    const workspaceId = resolved.context.workspace.id;
    const recent = await countRecentGroupPosts(workspaceId, session.uid, rateWindowStart());
    if (recent >= GROUP_POST_RATE_MAX) {
      auditDenied(request, session, "group:post:create", "发布过于频繁", { workspaceId });
      return NextResponse.json({ error: "发布太频繁，请稍后再试" }, { status: 429 });
    }

    const postId = await insertGroupPost({
      workspaceId,
      authorId: session.uid,
      authorName: session.name,
      authorRole: session.role,
      title: validated.value.title,
      content: validated.value.content,
    });
    auditSuccess(request, session, "group:post:create", postId, {
      workspaceId,
      batchId: resolved.context.batch.id,
      groupNo: resolved.context.workspace.group_no,
      pinned: false,
    });
    return NextResponse.json({ ok: true, postId });
  } catch (err) {
    const { ip, user_agent } = getRequestContext(request);
    void recordAudit({
      ...sessionActor(session),
      action: "group:post:create",
      method: request.method,
      path: PATH,
      resource_type: RESOURCE,
      resource_id: null,
      status: "failed",
      error_message: errorMessage(err, "公告发布失败"),
      ip,
      user_agent,
      metadata: null,
    });
    console.error("Group posts POST error:", err);
    return NextResponse.json({ error: "公告发布失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
export const POST = withDemoScope(POST_impl);
