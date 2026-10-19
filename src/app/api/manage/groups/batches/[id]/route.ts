import { NextRequest, NextResponse } from "next/server";
import { getGroupBatchDetail } from "@/lib/db";

type Ctx = { params: Promise<{ id: string }> };

/** GET：读某个历史批次的明细（组 + 成员快照）。只读，读不限班级 */
export async function GET(_request: NextRequest, { params }: Ctx) {
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id) || id <= 0) {
      return NextResponse.json({ error: "无效的批次 ID" }, { status: 400 });
    }
    const detail = await getGroupBatchDetail(id);
    if (!detail.batch) {
      return NextResponse.json({ error: "批次不存在" }, { status: 404 });
    }

    // 成员用当时的姓名/学号快照（账号删除后仍可读）
    const groupNoById = new Map(detail.groups.map((g) => [g.id, g.group_no]));
    const memberRows = new Map<number, { userId: number; userCode: string | null; name: string | null }[]>();
    for (const g of detail.groups) memberRows.set(g.group_no, []);
    for (const m of detail.members) {
      const no = groupNoById.get(m.group_id);
      if (no === undefined) continue;
      memberRows.get(no)?.push({ userId: m.user_id, userCode: m.user_code, name: m.name });
    }

    return NextResponse.json({
      batch: {
        id: detail.batch.id,
        classId: detail.batch.class_id,
        strategy: detail.batch.strategy,
        featureSources: detail.batch.feature_sources,
        groupSize: detail.batch.group_size,
        studentCount: detail.batch.student_count,
        taggedCount: detail.batch.tagged_count,
        metrics: detail.batch.metrics,
        createdAt: detail.batch.created_at,
        createdByName: detail.batch.created_by_name,
        createdByRole: detail.batch.created_by_role,
      },
      groups: detail.groups.map((g) => ({
        groupNo: g.group_no,
        cohesion: g.cohesion,
        memberCount: g.member_count,
        members: memberRows.get(g.group_no) ?? [],
      })),
    });
  } catch (err) {
    console.error("Group batch detail GET error:", err);
    return NextResponse.json({ error: "获取批次明细失败" }, { status: 500 });
  }
}
