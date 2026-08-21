import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { signToken } from "@/lib/token";
import { getClassByInviteCode, getUserByCode, updateUser } from "@/lib/db";
import { validateActivation } from "@/lib/activate";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24,
};

/** 激活错误类型 → 用户文案（姓名/邀请码类错误统一提示，防探测名单信息） */
const ACTIVATION_ERROR_TEXT: Record<string, { status: number; error: string }> = {
  "not-in-roster": { status: 404, error: "该学号不在名单中，请联系教师导入" },
  "already-activated": { status: 409, error: "该账户已激活，请直接登录" },
  mismatch: { status: 400, error: "学号、姓名或班级邀请码不匹配" },
};

/**
 * 学生账户激活（Issue #93，替代原自助注册）：
 * 账户须先由教师导入名单后存在，凭学号 + 姓名 + 本班邀请码三者一致核验身份，
 * 通过后设置密码并自动登录。
 */
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

    const user = await getUserByCode(code);
    const activationError = validateActivation(user, userName, klass.id);
    if (activationError) {
      const { status, error } = ACTIVATION_ERROR_TEXT[activationError];
      return NextResponse.json({ ok: false, error }, { status });
    }

    const passwordHash = await hashPassword(pwd);
    await updateUser(user!.id, { password_hash: passwordHash });

    // 姓名以名单记录为准，不用提交值
    const token = await signToken({ role: "student", uid: user!.id, name: user!.name });
    const response = NextResponse.json({ ok: true, role: "student" });
    response.cookies.set("auth_token", token, COOKIE_OPTIONS);
    return response;
  } catch (err) {
    console.error("Activate POST error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}
