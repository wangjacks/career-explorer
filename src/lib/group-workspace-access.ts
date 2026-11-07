import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/token";
import {
  getClassGroups,
  getClassGroupWorkspace,
  getGroupBatchDetail,
  getGroupWorkspaceById,
  getStudentGroupRef,
  getStudentWorkspaceContext,
  getTeacherClassPairs,
  listStudentWorkspaces,
} from "@/lib/db";
import type { GroupWorkspaceContext } from "@/lib/db";

/** 小组工作区只服务学生与教师；admin 不在此域内（其管理入口走 /api/manage） */
export type GroupRole = "student" | "teacher";

export interface GroupSession {
  uid: number;
  role: GroupRole;
  name: string | null;
}

/** 审计操作者快照（token 载荷不含 user_code，与分组路由同口径） */
export function sessionActor(session: GroupSession): {
  actor_id: number;
  actor_user_code: null;
  actor_name: string | null;
  actor_role: GroupRole;
} {
  return {
    actor_id: session.uid,
    actor_user_code: null,
    actor_name: session.name,
    actor_role: session.role,
  };
}

/**
 * 会话解析：与 `/api/shared/group` 同口径（路由自鉴权，不走 proxy）。
 * token 无效、uid 缺失、角色不是学生/教师都返回 null，由路由映射 401/403。
 */
export async function getGroupSession(request: NextRequest): Promise<GroupSession | null> {
  const token = request.cookies.get("auth_token")?.value;
  if (!token) return null;
  const result = await verifyToken(token);
  if (!result.valid || result.uid == null) return null;
  if (result.role !== "student" && result.role !== "teacher") return null;
  return { uid: result.uid, role: result.role, name: result.name ?? null };
}

/** 当前分组里本人是否是组长（读 class_groups 当前态，不读批次快照——换组长要立即生效） */
export async function isLeaderOfCurrentGroup(userId: number): Promise<boolean> {
  const ref = await getStudentGroupRef(userId);
  if (!ref) return false;
  const groups = await getClassGroups(ref.class_id);
  const group = groups.find((row) => row.group_no === ref.group_no);
  return group?.leader_user_id === userId;
}

/** 教师是否带该班（教师只能读写自己带的班级工作区） */
export async function teacherOwnsClass(teacherId: number, classId: number): Promise<boolean> {
  const pairs = await getTeacherClassPairs();
  return pairs.some((pair) => pair.teacher_id === teacherId && pair.class_id === classId);
}

export interface ResolvedWorkspace {
  context: GroupWorkspaceContext;
  /** 历史批次工作区只读：公告 / 任务可以看，不能写 */
  readOnly: boolean;
  isLeader: boolean;
}

/**
 * 学生视角定位工作区：
 * - 不传 workspaceId = 本人当前组的最新批次工作区（可写，组长才可管理）；
 * - 传 workspaceId = 必须是本人在该批次成员快照里出现过的组（历史回看，恒只读）。
 */
export async function resolveStudentWorkspace(
  userId: number,
  workspaceId?: number | null
): Promise<ResolvedWorkspace | null> {
  const current = await getStudentWorkspaceContext(userId);
  if (workspaceId == null) {
    if (!current) return null;
    return { context: current, readOnly: false, isLeader: await isLeaderOfCurrentGroup(userId) };
  }
  if (current?.workspace.id === workspaceId) {
    return { context: current, readOnly: false, isLeader: await isLeaderOfCurrentGroup(userId) };
  }
  const list = await listStudentWorkspaces(userId);
  if (!list.some((row) => row.workspaceId === workspaceId)) return null;
  const workspace = await getGroupWorkspaceById(workspaceId);
  if (!workspace) return null;
  const detail = await getGroupBatchDetail(workspace.batch_id);
  if (!detail.batch) return null;
  const batchGroup = detail.groups.find((group) => group.id === workspace.batch_group_id);
  if (!batchGroup) return null;
  return {
    context: { workspace, batch: detail.batch, batchGroup },
    readOnly: true,
    isLeader: false,
  };
}

/** 教师视角定位工作区：限本人带的班；读写均以该班最新批次为准 */
export async function resolveTeacherWorkspace(
  teacherId: number,
  classId: number,
  groupNo: number
): Promise<ResolvedWorkspace | null> {
  if (!(await teacherOwnsClass(teacherId, classId))) return null;
  const context = await getClassGroupWorkspace(classId, groupNo);
  if (!context) return null;
  return { context, readOnly: false, isLeader: false };
}
