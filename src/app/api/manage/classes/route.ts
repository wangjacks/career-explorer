import { NextRequest, NextResponse } from "next/server";
import {
  getClasses,
  getClassByName,
  getTeacherClassPairs,
  insertClass,
  insertTeacherClass,
  randomInviteCode,
} from "@/lib/db";
import { getSession } from "./helpers";

/** 生成不重复的邀请码（碰撞重试） */
async function uniqueInviteCode(): Promise<string> {
  for (let i = 0; i < 10; i++) {
    const code = randomInviteCode();
    const exists = await getClasses().then((list) => list.some((c) => c.invitation_code === code));
    if (!exists) return code;
  }
  throw new Error("邀请码生成失败");
}

export async function GET() {
  try {
    const [classes, pairs] = await Promise.all([getClasses(), getTeacherClassPairs()]);
    return NextResponse.json({ data: classes, teacher_classes: pairs });
  } catch (err) {
    console.error("Classes GET error:", err);
    return NextResponse.json({ error: "获取班级列表失败" }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const session = await getSession(request);
    if (!session) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

    const { name } = await request.json();
    const className = String(name ?? "").trim();
    if (!className) {
      return NextResponse.json({ error: "请输入班级名称" }, { status: 400 });
    }

    const existing = await getClassByName(className);
    if (existing) {
      return NextResponse.json({ error: "班级名称已存在" }, { status: 409 });
    }

    const code = await uniqueInviteCode();
    const id = await insertClass(className, code);
    if (session.role === "teacher" && session.uid != null) {
      await insertTeacherClass(session.uid, id);
    }
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("Classes POST error:", err);
    return NextResponse.json({ error: "创建班级失败" }, { status: 500 });
  }
}
