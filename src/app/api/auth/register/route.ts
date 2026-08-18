import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { signToken } from "@/lib/token";
import { getClassByInviteCode, getUserByCode, insertUser } from "@/lib/db";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24,
};

/** 学生自助注册：自填 12 位编号 + 邀请码绑定班级，成功即自动登录 */
export async function POST(request: NextRequest) {
  try {
    const { userCode, name, password, inviteCode } = await request.json();

    const code = String(userCode ?? "").trim();
    const userName = String(name ?? "").trim();
    const pwd = String(password ?? "");
    const invite = String(inviteCode ?? "").trim();

    if (!/^\d{12}$/.test(code)) {
      return NextResponse.json({ ok: false, error: "编号须为 12 位数字学号" }, { status: 400 });
    }
    if (!userName) {
      return NextResponse.json({ ok: false, error: "请输入姓名" }, { status: 400 });
    }
    if (pwd.length < 8) {
      return NextResponse.json({ ok: false, error: "密码须至少 8 位" }, { status: 400 });
    }
    if (!invite) {
      return NextResponse.json({ ok: false, error: "请输入邀请码" }, { status: 400 });
    }

    const klass = await getClassByInviteCode(invite);
    if (!klass) {
      return NextResponse.json({ ok: false, error: "邀请码无效" }, { status: 400 });
    }

    const existing = await getUserByCode(code);
    if (existing) {
      return NextResponse.json({ ok: false, error: "该编号已注册" }, { status: 409 });
    }

    const passwordHash = await hashPassword(pwd);
    const uid = await insertUser({
      user_code: code,
      password_hash: passwordHash,
      role: "student",
      name: userName,
      class_id: klass.id,
    });

    const token = await signToken({ role: "student", uid, name: userName });
    const response = NextResponse.json({ ok: true, role: "student" });
    response.cookies.set("auth_token", token, COOKIE_OPTIONS);
    return response;
  } catch (err) {
    console.error("Register POST error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}
