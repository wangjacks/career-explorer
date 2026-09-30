import { NextRequest, NextResponse } from "next/server";
import { getClassGroups, getClassGroupMembers, getStudentGroupRef, getStudents } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { FEATURE_SOURCES, buildFeatureVectors, featureLabels } from "@/lib/grouping-features";

/**
 * GET：学生端读「本人所在小组」的全部成员（#101）。
 * 只返回本组，**不提供遍历班级的接口**——把同组同学的信息暴露面压到最小；
 * 头像到客户端后仍受 storage-sign 的「同组成员 + 仅头像」约束。
 */
export async function GET(request: NextRequest) {
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
      return NextResponse.json({ grouped: false, groupNo: null, memberCount: 0, members: [] });
    }

    const [students, groups, links] = await Promise.all([
      getStudents(),
      getClassGroups(ref.class_id),
      getClassGroupMembers(ref.class_id),
    ]);
    const target = groups.find((g) => g.group_no === ref.group_no);
    if (!target) {
      return NextResponse.json({ grouped: false, groupNo: null, memberCount: 0, members: [] });
    }

    const memberIds = new Set(links.filter((l) => l.group_id === target.id).map((l) => l.user_id));
    // 归属自证：上面的组号引用是先前读到的，期间若发生原子重分组，组号可能已被复用给另一批人；
    // 请求者不在这一组成员里就按「未分组」返回，绝不把别人的小组名单给他
    if (!memberIds.has(result.uid)) {
      return NextResponse.json({ grouped: false, groupNo: null, memberCount: 0, members: [] });
    }
    const memberRows = students
      .filter((s) => memberIds.has(s.id))
      .sort((a, b) => (a.user_code < b.user_code ? -1 : a.user_code > b.user_code ? 1 : a.id - b.id));
    const vectors = buildFeatureVectors(memberRows, FEATURE_SOURCES);

    return NextResponse.json({
      grouped: true,
      groupNo: ref.group_no,
      memberCount: memberRows.length,
      // 源的展示元信息：界面据此说明「按什么分组」，新增数据源无需改界面结构
      sources: FEATURE_SOURCES.map((s) => ({ key: s.key, label: s.label, kind: s.kind })),
      members: memberRows.map((s, i) => ({
        userId: s.id,
        userCode: s.user_code,
        name: s.name,
        avatarUrl: s.avatar_url,
        storageId: s.storage_id,
        isMe: s.id === result.uid,
        featureLabels: featureLabels(vectors[i], FEATURE_SOURCES),
      })),
    });
  } catch (err) {
    console.error("Shared group GET error:", err);
    return NextResponse.json({ error: "获取本组名单失败" }, { status: 500 });
  }
}
