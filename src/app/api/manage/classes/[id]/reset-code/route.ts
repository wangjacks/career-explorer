import { NextRequest, NextResponse } from "next/server";
import { getClasses, updateClass, randomInviteCode } from "@/lib/db";
import { getSession, canModifyClass } from "../../helpers";
import { getRequestContext, recordAudit } from "@/lib/audit";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const { id: idParam } = await params;
    const id = Number(idParam);
    if (!Number.isInteger(id)) {
      return NextResponse.json({ error: "无效的班级 ID" }, { status: 400 });
    }

    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    if (!(await canModifyClass(session, id))) {
      return NextResponse.json({ error: "无权重置该班级邀请码" }, { status: 403 });
    }

    const classes = await getClasses();
    if (!classes.some((c) => c.id === id)) {
      return NextResponse.json({ error: "班级不存在" }, { status: 404 });
    }

    // 生成与现有邀请码不重复的新码（碰撞重试）
    let code = randomInviteCode();
    for (let i = 0; i < 10 && classes.some((c) => c.invitation_code === code); i++) {
      code = randomInviteCode();
    }
    await updateClass(id, { invitation_code: code });
    // 新邀请码不写入审计（#110：凭据类数据不落库）
    void recordAudit({
      actor_id: session.uid ?? null, actor_user_code: null, actor_name: session.name ?? null, actor_role: session.role ?? null,
      action: "class:reset-code", method: "POST", path: `/api/manage/classes/${id}/reset-code`,
      resource_type: "class", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: true, invitation_code: code });
  } catch (err) {
    console.error("Class reset-code error:", err);
    return NextResponse.json({ error: "重置邀请码失败" }, { status: 500 });
  }
}
