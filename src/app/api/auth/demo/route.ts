import { withDemoScope, runInDemoScope, isDemoEnabled } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyPassword } from "@/lib/auth";
import { signToken } from "@/lib/token";
import type { Role } from "@/lib/token";
import { getUserByCode } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { CAPTCHA_REQUIRED_MESSAGE, verifyCaptchaTicket } from "@/lib/captcha";
import { LOGIN_ERROR, AUTH_COOKIE_OPTIONS } from "@/lib/login-contract";

/**
 * 演示登录：在演示库作用域内校验演示账号，签发带 `demo: true` 的会话 cookie。
 *
 * 与生产 `/api/auth` 的区别只在「数据源」：登录时还没有 demo token，无法靠 `withDemoScope`
 * 读 cookie 判定作用域，故这里**显式 `runInDemoScope`** 把查库、签发、审计全程锁进演示库
 * （审计也只落演示库，不污染生产审计流）。错误口径、captcha 前置与生产登录完全一致，
 * 不泄露账号存在性。`DEMO_ENABLED` 关闭时端点视为不存在（404）。
 */
async function POST_impl(request: NextRequest) {
  if (!isDemoEnabled()) {
    return NextResponse.json({ ok: false, error: "演示模式未启用" }, { status: 404 });
  }

  return runInDemoScope(async () => {
    const { ip, user_agent } = getRequestContext(request);
    const failedAudit = (attemptedCode: string, reason: string) =>
      recordAudit({
        actor_id: null, actor_user_code: attemptedCode, actor_name: null, actor_role: null,
        action: "auth:login-failed", method: "POST", path: "/api/auth/demo",
        resource_type: "session", resource_id: null,
        status: "failed", error_message: "登录失败", ip, user_agent,
        metadata: { reason, demo: true },
      });
    const captchaAudit = (
      action: "auth:captcha-failed" | "auth:captcha-degraded",
      attemptedCode: string,
      errorMessage: string,
      metadata: Record<string, unknown>
    ) =>
      recordAudit({
        actor_id: null, actor_user_code: attemptedCode || null, actor_name: null, actor_role: null,
        action, method: "POST", path: "/api/auth/demo",
        resource_type: "session", resource_id: null,
        status: "failed", error_message: errorMessage, ip, user_agent, metadata,
      });

    try {
      const body = await request.json();
      const { userCode, password } = body ?? {};

      // 人机验证前置（与生产同口径）：先于查库与密码比对，避免 bcrypt 成为枚举放大面
      const captcha = await verifyCaptchaTicket(body?.captcha);
      if (captcha.outcome === "rejected") {
        void captchaAudit("auth:captcha-failed", String(userCode ?? "").trim(), "人机验证未通过", {
          reason: captcha.reason, detail: captcha.detail,
        });
        return NextResponse.json({ ok: false, error: CAPTCHA_REQUIRED_MESSAGE }, { status: 400 });
      }
      if (captcha.outcome === "degraded") {
        void captchaAudit("auth:captcha-degraded", String(userCode ?? "").trim(), "人机验证降级放行", {
          reason: captcha.reason, detail: captcha.detail,
        });
      }

      if (!userCode || !password) {
        void failedAudit("", "参数缺失");
        return NextResponse.json({ ok: false, error: LOGIN_ERROR.missing }, { status: 400 });
      }

      const user = await getUserByCode(String(userCode).trim());
      if (!user || !user.password_hash) {
        if (!user) {
          void failedAudit(String(userCode).trim(), "用户不存在");
          return NextResponse.json({ ok: false, error: LOGIN_ERROR.badCredentials }, { status: 401 });
        }
        void failedAudit(String(userCode).trim(), "账户未设密码");
        return NextResponse.json({ ok: false, error: LOGIN_ERROR.noPassword }, { status: 401 });
      }

      const valid = await verifyPassword(String(password), user.password_hash);
      if (!valid) {
        void failedAudit(String(userCode).trim(), "密码错误");
        return NextResponse.json({ ok: false, error: LOGIN_ERROR.badCredentials }, { status: 401 });
      }

      const token = await signToken({
        role: user.role as Role, uid: user.id, name: user.name, demo: true,
      });
      void recordAudit({
        actor_id: user.id, actor_user_code: user.user_code, actor_name: user.name, actor_role: user.role,
        action: "auth:login", method: "POST", path: "/api/auth/demo",
        resource_type: "session", resource_id: null,
        status: "success", error_message: null, ip, user_agent,
        metadata: { demo: true },
      });

      const response = NextResponse.json({
        ok: true, role: user.role, name: user.name, user_code: user.user_code, demo: true,
      });
      response.cookies.set("auth_token", token, AUTH_COOKIE_OPTIONS);
      return response;
    } catch (err) {
      console.error("Demo auth POST error:", err);
      return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
    }
  });
}

export const POST = withDemoScope(POST_impl);
