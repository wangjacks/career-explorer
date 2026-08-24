import { NextRequest, NextResponse } from "next/server";
import { hashPassword } from "@/lib/auth";
import { signToken } from "@/lib/token";
import { updateUser } from "@/lib/db";
import { resolveActivation } from "@/lib/activate";
import { getRequestContext, recordAudit } from "@/lib/audit";

const COOKIE_OPTIONS = {
  httpOnly: true,
  secure: true,
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24,
};

/**
 * 学生账户激活（Issue #93，替代原自助注册）：
 * 账户须先由教师导入名单后存在，凭学号 + 姓名 + 本班邀请码三者一致核验身份，
 * 通过后设置密码并自动登录。
 */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const { userCode, name, password, inviteCode } = await request.json();
    const attemptedCode = String(userCode ?? "");

    const pwd = String(password ?? "");
    if (pwd.length < 8) {
      void recordAudit({
        actor_id: null, actor_user_code: attemptedCode, actor_name: String(name ?? "") || null, actor_role: "student",
        action: "auth:activate", method: "POST", path: "/api/auth/activate",
        resource_type: "student", resource_id: attemptedCode || null,
        status: "failed", error_message: "密码须至少 8 位", ip, user_agent, metadata: null,
      });
      return NextResponse.json({ ok: false, error: "密码须至少 8 位" }, { status: 400 });
    }

    // 完整重校验（不信任客户端的分步状态，防跳过 verify 直接调用）
    const result = await resolveActivation(attemptedCode, String(name ?? ""), String(inviteCode ?? ""));
    if (!result.ok) {
      void recordAudit({
        actor_id: null, actor_user_code: attemptedCode, actor_name: String(name ?? "") || null, actor_role: "student",
        action: "auth:activate", method: "POST", path: "/api/auth/activate",
        resource_type: "student", resource_id: attemptedCode || null,
        status: "failed", error_message: result.error, ip, user_agent,
        metadata: { status: result.status },
      });
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }

    const passwordHash = await hashPassword(pwd);
    await updateUser(result.userId, { password_hash: passwordHash });

    void recordAudit({
      actor_id: result.userId, actor_user_code: attemptedCode, actor_name: result.name, actor_role: "student",
      action: "auth:activate", method: "POST", path: "/api/auth/activate",
      resource_type: "student", resource_id: attemptedCode,
      status: "success", error_message: null, ip, user_agent, metadata: null,
    });

    // 姓名以名单记录为准，不用提交值
    const token = await signToken({ role: "student", uid: result.userId, name: result.name });
    const response = NextResponse.json({ ok: true, role: "student" });
    response.cookies.set("auth_token", token, COOKIE_OPTIONS);
    return response;
  } catch (err) {
    console.error("Activate POST error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}
