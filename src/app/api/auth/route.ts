import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { signToken, verifyToken } from "@/lib/token";
import type { Role } from "@/lib/token";
import { getUserByCode, getUserById } from "@/lib/db";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24,
};

/** 统一登录：user_code + 密码（admin/teacher/student 三角色） */
export async function POST(request: NextRequest) {
  try {
    const { userCode, password } = await request.json();
    if (!userCode || !password) {
      return NextResponse.json({ ok: false, error: "请输入编号和密码" }, { status: 400 });
    }

    const user = await getUserByCode(String(userCode).trim());
    if (!user || !user.password_hash) {
      // 区分「无此用户」与「未设密码」：前者与密码错误共用提示，避免泄露账号是否存在
      if (!user) {
        return NextResponse.json({ ok: false, error: "编号或密码错误" }, { status: 401 });
      }
      return NextResponse.json(
        { ok: false, error: "该账户尚未设置密码，请联系管理员" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(String(password), user.password_hash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "编号或密码错误" }, { status: 401 });
    }

    const token = await signToken({
      role: user.role as Role,
      uid: user.id,
      name: user.name,
    });
    const response = NextResponse.json({
      ok: true,
      role: user.role,
      name: user.name,
      user_code: user.user_code,
    });
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

  // 回查数据库返回最新姓名/角色（token 载荷会过期于改名等变更）；账户已删除则会话失效
  let role = result.role;
  let name = result.name;
  const uid = result.uid ?? null;
  if (uid != null) {
    try {
      const user = await getUserById(uid);
      if (!user) {
        const response = NextResponse.json({ ok: false }, { status: 401 });
        response.cookies.set("auth_token", "", { ...COOKIE_OPTIONS, maxAge: 0 });
        return response;
      }
      role = user.role;
      name = user.name;
    } catch (err) {
      console.error("Auth GET user lookup error:", err);
      // 查询失败时降级为 token 载荷，不阻断会话检测
    }
  }

  return NextResponse.json({
    ok: true,
    role,
    uid,
    name: name ?? null,
  });
}

/** 登出：清除 auth_token */
export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("auth_token", "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
