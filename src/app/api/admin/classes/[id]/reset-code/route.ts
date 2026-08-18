import { NextRequest, NextResponse } from "next/server";
import { getClasses, updateClass, randomInviteCode } from "@/lib/db";
import { getSession, canModifyClass } from "../../helpers";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: NextRequest, { params }: Ctx) {
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
    return NextResponse.json({ ok: true, invitation_code: code });
  } catch (err) {
    console.error("Class reset-code error:", err);
    return NextResponse.json({ error: "重置邀请码失败" }, { status: 500 });
  }
}
