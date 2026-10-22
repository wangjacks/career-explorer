import { withDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import {
  getAssessmentByCode,
  getClassGroupMembers,
  getClassGroups,
  getCurrentAssessmentResultsByUserCodes,
  getGroupUnreadCount,
  getStudentGroupRef,
  getStudentWorkspaceContext,
  getStudents,
} from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { RIASEC_CODE } from "@/lib/assessment-data";
import { groupingStrategyLabel } from "@/lib/grouping-utils";
import {
  commonInterests,
  interestCoverage,
  parseMemberTags,
  type InterestCoverage,
} from "@/lib/group-workspace";

/** 未分组时的返回：字段必须与已分组一致，界面不需要为这一分支单独兜底 */
const NO_GROUP = {
  grouped: false,
  groupNo: null,
  memberCount: 0,
  batch: null,
  workspace: null,
  unreadCount: 0,
  canManage: false,
  commonInterests: [] as string[],
  interestCoverage: null as InterestCoverage | null,
  members: [],
};

/**
 * GET：学生端读「本人所在小组」的概览 + 成员 + 工作区摘要（#101 / #346）。
 * 只返回本组；成员只下发**标签**——测评分数 / 三字码 / 人格维度一律不出现在这里（硬约束）。
 * 兴趣覆盖只以「X/6 型 · 已测 N 人」的聚合形式出现，不指向个人。
 */
async function GET_impl(request: NextRequest) {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    const result = await verifyToken(token);
    if (!result.valid || result.uid == null) {
      return NextResponse.json({ error: "Token expired" }, { status: 401 });
    }
    if (result.role !== "student") {
      return NextResponse.json({ error: "仅学生可查看本组名单" }, { status: 403 });
    }

    const ref = await getStudentGroupRef(result.uid);
    if (!ref) {
      return NextResponse.json(NO_GROUP);
    }

    const [students, groups, links] = await Promise.all([
      getStudents(),
      getClassGroups(ref.class_id),
      getClassGroupMembers(ref.class_id),
    ]);
    const target = groups.find((g) => g.group_no === ref.group_no);
    if (!target) {
      return NextResponse.json(NO_GROUP);
    }

    const memberIds = new Set(links.filter((l) => l.group_id === target.id).map((l) => l.user_id));
    // 归属自证：上面的组号引用是先前读到的，期间若发生原子重分组，组号可能已被复用给另一批人；
    // 请求者不在这一组成员里就按「未分组」返回，绝不把别人的小组名单给他
    if (!memberIds.has(result.uid)) {
      return NextResponse.json(NO_GROUP);
    }
    const memberRows = students
      .filter((s) => memberIds.has(s.id))
      .sort((a, b) => (a.user_code < b.user_code ? -1 : a.user_code > b.user_code ? 1 : a.id - b.id));

    // 工作区摘要（#346）：按批次隔离；只有当前批次可写，历史批次在 history 接口里回看
    const context = await getStudentWorkspaceContext(result.uid);
    const unreadCount = context ? await getGroupUnreadCount(context.workspace.id, result.uid) : 0;

    // 兴趣覆盖（聚合，不指向个人）：取当前有效兴趣结果的三字码首位去重。
    // 读取失败只降级这一块，不让整页 500——分组信息仍可看。
    let coverage: InterestCoverage | null = null;
    try {
      const scale = await getAssessmentByCode(RIASEC_CODE);
      if (scale) {
        const summaries = await getCurrentAssessmentResultsByUserCodes(
          scale.id,
          memberRows.map((m) => m.user_code)
        );
        const typeByCode = new Map(summaries.map((row) => [row.user_code, row.type_code]));
        coverage = interestCoverage(memberRows.map((m) => typeByCode.get(m.user_code) ?? null));
      }
    } catch (err) {
      console.error("Group interest coverage degraded:", err);
    }

    return NextResponse.json({
      grouped: true,
      groupNo: ref.group_no,
      memberCount: memberRows.length,
      batch: context
        ? {
            id: context.batch.id,
            strategy: context.batch.strategy,
            strategyLabel: groupingStrategyLabel(context.batch.strategy),
            createdAt: context.batch.created_at,
          }
        : null,
      workspace: context
        ? { id: context.workspace.id, title: context.workspace.title, createdAt: context.workspace.created_at }
        : null,
      unreadCount,
      // 组长才显示「发布公告 / 新建任务」入口；接口仍会逐次在服务端校验，不靠隐藏做权限
      canManage: target.leader_user_id === result.uid,
      commonInterests: commonInterests(memberRows.map((m) => parseMemberTags(m.tags))),
      interestCoverage: coverage,
      members: memberRows.map((s) => ({
        userId: s.id,
        userCode: s.user_code,
        name: s.name,
        avatarUrl: s.avatar_url,
        storageId: s.storage_id,
        isMe: s.id === result.uid,
        isLeader: target.leader_user_id === s.id,
        tags: parseMemberTags(s.tags),
      })),
    });
  } catch (err) {
    console.error("Shared group GET error:", err);
    return NextResponse.json({ error: "获取本组名单失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
