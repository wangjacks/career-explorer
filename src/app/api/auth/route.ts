import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { signToken, verifyToken } from "@/lib/token";
import type { Role } from "@/lib/token";
import { getUserByCode, getUserById } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24,
};

/** 统一登录：user_code + 密码（admin/teacher/student 三角色） */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  // 登录失败时尚无会话：操作者快照仅含尝试编号（#110）
  const failedAudit = (attemptedCode: string, reason: string) =>
    recordAudit({
      actor_id: null,
      actor_user_code: attemptedCode,
      actor_name: null,
      actor_role: null,
      action: "auth:login-failed",
      method: "POST",
      path: "/api/auth",
      resource_type: "session",
      resource_id: null,
      status: "failed",
      error_message: "登录失败",
      ip,
      user_agent,
      metadata: { reason },
    });
  try {
    const { userCode, password } = await request.json();
    if (!userCode || !password) {
      void failedAudit("", "参数缺失");
      return NextResponse.json({ ok: false, error: "请输入编号和密码" }, { status: 400 });
    }

    const user = await getUserByCode(String(userCode).trim());
    if (!user || !user.password_hash) {
      // 区分「无此用户」与「未设密码」：前者与密码错误共用提示，避免泄露账号是否存在；审计区分原因便于安全分析（不对外暴露）
      if (!user) {
        void failedAudit(String(userCode).trim(), "用户不存在");
        return NextResponse.json({ ok: false, error: "编号或密码错误" }, { status: 401 });
      }
      void failedAudit(String(userCode).trim(), "账户未设密码");
      return NextResponse.json(
        { ok: false, error: "该账户尚未设置密码，请联系管理员" },
        { status: 401 }
      );
    }

    const valid = await verifyPassword(String(password), user.password_hash);
    if (!valid) {
      void failedAudit(String(userCode).trim(), "密码错误");
      return NextResponse.json({ ok: false, error: "编号或密码错误" }, { status: 401 });
    }

    const token = await signToken({
      role: user.role as Role,
      uid: user.id,
      name: user.name,
    });
    void recordAudit({
      actor_id: user.id,
      actor_user_code: user.user_code,
      actor_name: user.name,
      actor_role: user.role,
      action: "auth:login",
      method: "POST",
      path: "/api/auth",
      resource_type: "session",
      resource_id: null,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: null,
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

/** 登出：清除 auth_token（#110：先记录审计再清 cookie，否则拿不到操作者） */
export async function DELETE(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  void recordAudit({
    ...actor,
    action: "auth:logout",
    method: "DELETE",
    path: "/api/auth",
    resource_type: "session",
    resource_id: null,
    status: "success",
    error_message: null,
    ip,
    user_agent,
    metadata: null,
  });
  const response = NextResponse.json({ ok: true });
  response.cookies.set("auth_token", "", { ...COOKIE_OPTIONS, maxAge: 0 });
  return response;
}
