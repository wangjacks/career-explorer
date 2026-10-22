import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getClassGroupMembers,
  getClassGroups,
  getUserById,
  updateClassGroupLeader,
} from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { getSession, canModifyClass } from "../../classes/helpers";
import { actorOf, buildGroupingView, groupFailureWriter, parseJsonBody } from "../helpers";

const AUDIT = {
  action: "group:leader",
  method: "PATCH",
  path: "/api/manage/groups/leader",
  resource_type: "group",
} as const;

/**
 * PATCH：设置 / 取消某组组长（#345）。
 *
 * 权限：读不限、**写限本人班级**（`canModifyClass`，与自动分组 / 移动成员同一口径），
 * 越权与被拒同样记审计。组长必须是该组当前成员——否则「组长」会指向别组的人，
 * 学生端（#346）按本组成员判定时会自相矛盾。
 */
async function PATCH_impl(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const fail = groupFailureWriter(request, AUDIT);
  let session: Awaited<ReturnType<typeof getSession>> = null;
  try {
    session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const body = await parseJsonBody<{
      classId?: unknown;
      groupNo?: unknown;
      leaderUserId?: unknown;
    }>(request);
    if (!body) {
      fail(session, "请求体不是合法 JSON");
      return NextResponse.json({ error: "请求体格式错误" }, { status: 400 });
    }
    const classId = Number(body.classId);
    const groupNo = Number(body.groupNo);
    if (!Number.isInteger(classId) || classId <= 0 || !Number.isInteger(groupNo) || groupNo <= 0) {
      fail(session, "classId / groupNo 必须为正整数", { classId, groupNo });
      return NextResponse.json({ error: "classId / groupNo 必须为正整数" }, { status: 400 });
    }
    if (!(await canModifyClass(session, classId))) {
      fail(session, "无权设置该班级组长", { classId, groupNo });
      return NextResponse.json({ error: "无权设置该班级组长" }, { status: 403 });
    }

    const leaderRaw = body.leaderUserId;
    const leaderUserId = leaderRaw === undefined || leaderRaw === null ? null : Number(leaderRaw);
    if (leaderUserId !== null && (!Number.isInteger(leaderUserId) || leaderUserId <= 0)) {
      fail(session, "leaderUserId 无效", { classId, groupNo, leaderUserId: leaderRaw });
      return NextResponse.json({ error: "leaderUserId 无效" }, { status: 400 });
    }

    // 组必须存在；组长必须是该组当前成员（两库都按 classId + groupNo 定位，抗组号跨班）
    const groups = await getClassGroups(classId);
    const target = groups.find((group) => group.group_no === groupNo);
    if (!target) {
      fail(session, "该组不存在", { classId, groupNo });
      return NextResponse.json({ error: "该组不存在" }, { status: 404 });
    }
    if (leaderUserId !== null) {
      const links = await getClassGroupMembers(classId);
      const memberIds = new Set(links.filter((link) => link.group_id === target.id).map((link) => link.user_id));
      if (!memberIds.has(leaderUserId)) {
        fail(session, "组长必须是本组成员", { classId, groupNo, leaderUserId });
        return NextResponse.json({ error: "组长必须是本组成员" }, { status: 400 });
      }
      const user = await getUserById(leaderUserId);
      if (!user || user.role !== "student" || user.class_id !== classId) {
        fail(session, "该学生不在本班", { classId, groupNo, leaderUserId });
        return NextResponse.json({ error: "该学生不在本班" }, { status: 400 });
      }
    }

    await updateClassGroupLeader(classId, groupNo, leaderUserId);

    void recordAudit({
      ...actorOf(session),
      ...AUDIT,
      resource_id: String(classId),
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { classId, groupNo, leaderUserId },
    });

    return NextResponse.json({ ok: true, view: await buildGroupingView(classId) });
  } catch (err) {
    console.error("Group leader PATCH error:", err);
    fail(session, err instanceof Error ? err.message : "设置组长失败");
    return NextResponse.json({ error: "设置组长失败" }, { status: 500 });
  }
}

export const PATCH = withDemoScope(PATCH_impl);
