import { NextRequest, NextResponse } from "next/server";
import { resolveActivation } from "@/lib/activate";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { CAPTCHA_REQUIRED_MESSAGE, verifyCaptchaTicket } from "@/lib/captcha";

/**
 * 激活前置核验（两步激活第一步，Issue #93）：
 * 校验学号 + 姓名 + 邀请码三要素，不设置密码。
 * 通过时返回名单姓名，供第二步问候语展示。
 */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  try {
    const body = await request.json();
    const { userCode, name, inviteCode } = body ?? {};
    const attemptedCode = String(userCode ?? "");

    // 人机验证前置（#155）：票据校验先于三要素核验，避免邀请码被脚本批量枚举
    const captcha = await verifyCaptchaTicket(body?.captcha);
    if (captcha.outcome === "rejected") {
      void recordAudit({
        actor_id: null, actor_user_code: attemptedCode || null, actor_name: String(name ?? "") || null, actor_role: "student",
        action: "auth:captcha-failed", method: "POST", path: "/api/auth/activate/verify",
        resource_type: "student", resource_id: attemptedCode || null,
        status: "failed", error_message: "人机验证未通过", ip, user_agent,
        metadata: { reason: captcha.reason, detail: captcha.detail },
      });
      return NextResponse.json({ ok: false, error: CAPTCHA_REQUIRED_MESSAGE }, { status: 400 });
    }
    if (captcha.outcome === "degraded") {
      void recordAudit({
        actor_id: null, actor_user_code: attemptedCode || null, actor_name: String(name ?? "") || null, actor_role: "student",
        action: "auth:captcha-degraded", method: "POST", path: "/api/auth/activate/verify",
        resource_type: "student", resource_id: attemptedCode || null,
        status: "failed", error_message: "人机验证降级放行", ip, user_agent,
        metadata: { reason: captcha.reason, detail: captcha.detail },
      });
    }

    const result = await resolveActivation(attemptedCode, String(name ?? ""), String(inviteCode ?? ""));
    if (!result.ok) {
      void recordAudit({
        actor_id: null, actor_user_code: attemptedCode, actor_name: String(name ?? "") || null, actor_role: "student",
        action: "auth:activate-verify", method: "POST", path: "/api/auth/activate/verify",
        resource_type: "student", resource_id: attemptedCode || null,
        status: "failed", error_message: result.error, ip, user_agent,
        metadata: { status: result.status },
      });
      return NextResponse.json({ ok: false, error: result.error }, { status: result.status });
    }
    void recordAudit({
      actor_id: null, actor_user_code: attemptedCode, actor_name: result.name, actor_role: "student",
      action: "auth:activate-verify", method: "POST", path: "/api/auth/activate/verify",
      resource_type: "student", resource_id: attemptedCode,
      status: "success", error_message: null, ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: true, name: result.name });
  } catch (err) {
    console.error("Activate verify POST error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}
