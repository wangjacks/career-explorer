import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { signToken, verifyToken } from "@/lib/token";
import { getAdminUser } from "@/lib/db";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24,
};

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const admin = await getAdminUser();
    // ADMIN_PASSWORD_HASH 环境变量回退：步骤 4（安装引导配置密码）后移除
    const hash = admin?.password_hash || process.env.ADMIN_PASSWORD_HASH || null;

    if (!hash) {
      return NextResponse.json({ ok: false, error: "服务器未配置管理员密码" }, { status: 500 });
    }

    const valid = await verifyPassword(password, hash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "密码错误" }, { status: 401 });
    }

    const token = await signToken({ role: "admin", uid: admin?.id ?? null });
    const response = NextResponse.json({ ok: true });
    response.cookies.set("auth_token", token, COOKIE_OPTIONS);
    return response;
  } catch (err) {
    console.error("Auth POST error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}

/** 会话状态检测：前端挂载时调用（httpOnly cookie 不可被 JS 读取） */
export async function GET(request: NextRequest) {
  const token = request.cookies.get("auth_token")?.value;
  if (!token) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const result = await verifyToken(token);
  if (!result.valid) {
    const response = NextResponse.json({ ok: false }, { status: 401 });
    response.cookies.set("auth_token", "", { ...COOKIE_OPTIONS, maxAge: 0 });
    return response;
  }
  return NextResponse.json({ ok: true, role: result.role, uid: result.uid ?? null });
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("auth_token", "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
