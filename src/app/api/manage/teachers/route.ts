import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { getTeachers, getUserByCode, insertUser } from "@/lib/db";

export async function GET() {
  try {
    const teachers = await getTeachers();
    return NextResponse.json({ data: teachers });
  } catch (err) {
    console.error("Teachers GET error:", err);
    return NextResponse.json({ error: "获取教师列表失败" }, { status: 500 });
  }
}

/** 创建教师账户：手填 8 位实际编号 + 姓名 + 初始密码 */
export async function POST(request: NextRequest) {
  try {
    const { userCode, name, password } = await request.json();

    const code = String(userCode ?? "").trim();
    const teacherName = String(name ?? "").trim();
    const pwd = String(password ?? "");

    if (!/^\d{8}$/.test(code)) {
      return NextResponse.json({ error: "教师编号须为 8 位数字" }, { status: 400 });
    }
    if (!teacherName) {
      return NextResponse.json({ error: "请输入姓名" }, { status: 400 });
    }
    if (pwd.length < 8) {
      return NextResponse.json({ error: "密码须至少 8 位" }, { status: 400 });
    }

    const existing = await getUserByCode(code);
    if (existing) {
      return NextResponse.json({ error: "该编号已被使用" }, { status: 409 });
    }

    const passwordHash = await hashPassword(pwd);
    const id = await insertUser({
      user_code: code,
      password_hash: passwordHash,
      role: "teacher",
      name: teacherName,
    });
    return NextResponse.json({ ok: true, id });
  } catch (err) {
    console.error("Teachers POST error:", err);
    return NextResponse.json({ error: "创建教师失败" }, { status: 500 });
  }
}
