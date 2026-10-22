import { withDemoScope, runInDemoScope, isDemoEnabled } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { signToken, verifyToken, type Role } from "@/lib/token";
import { AUTH_COOKIE_OPTIONS } from "@/lib/login-contract";
import { parseDemoSeq, visitorSeqOf, demoAccountCodes } from "@/lib/demo-accounts";
import { getUserById, getUserByCode } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 演示角色切换（#255）：仅演示会话可用。访客账户 = 同一 seq 派生的 admin/teacher/student 三身份，
 * 本端点按当前身份反解 seq，取同账户目标角色身份，重签 `{role, uid, name, demo}` 并刷新 cookie。
 * 不改变密码与账户状态；目标身份被禁用（password_hash 为空）时拒绝。
 * 成功审计落请求所处作用域（演示会话 → 演示审计流）；非演示会话拒绝落生产审计。
 */
const PATH = "/api/auth/demo-switch";
const ROLES: readonly Role[] = ["admin", "teacher", "student"];

async function POST_impl(request: NextRequest) {
  if (!isDemoEnabled()) {
    return NextResponse.json({ ok: false, error: "演示模式未启用" }, { status: 404 });
  }

  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  const result = await verifyToken(request.cookies.get("auth_token")?.value ?? "");

  const auditFailed = (errorMessage: string, metadata: unknown = null) => {
    void recordAudit({
      ...actor,
      action: "auth:demo-switch",
      method: "POST",
      path: PATH,
      resource_type: "session",
      resource_id: null,
      status: "failed",
      error_message: errorMessage,
      ip,
      user_agent,
      metadata,
    });
  };

  if (!result.valid || result.demo !== true) {
    auditFailed("仅演示会话可切换角色");
    return NextResponse.json({ ok: false, error: "仅演示会话可切换角色" }, { status: 403 });
  }

  const body = (await request.json().catch(() => ({}))) as { role?: unknown };
  const role = body?.role;
  if (typeof role !== "string" || !ROLES.includes(role as Role)) {
    return NextResponse.json({ ok: false, error: "目标角色无效" }, { status: 400 });
  }
  const targetRole = role as Role;

  return runInDemoScope(async () => {
    const current = result.uid != null ? await getUserById(result.uid) : undefined;
    if (!current) {
      auditFailed("会话用户不存在");
      return NextResponse.json({ ok: false, error: "会话用户不存在" }, { status: 403 });
    }

    const parsed = parseDemoSeq(current.user_code);
    if (!parsed || visitorSeqOf(current.user_code) == null) {
      auditFailed("当前会话不属于访客账户");
      return NextResponse.json(
        { ok: false, error: "当前会话不属于访客账户，无法切换角色" },
        { status: 403 }
      );
    }

    const codes = demoAccountCodes(parsed.seq);
    const target = await getUserByCode(codes[targetRole]);
    if (!target || target.role !== targetRole) {
      auditFailed("目标演示身份不存在", { seq: parsed.seq, to: targetRole });
      return NextResponse.json({ ok: false, error: "目标演示身份不存在" }, { status: 404 });
    }
    if (!target.password_hash) {
      auditFailed("演示账户已禁用", { seq: parsed.seq, to: targetRole });
      return NextResponse.json({ ok: false, error: "演示账户已禁用，请联系管理员" }, { status: 403 });
    }

    const token = await signToken({ role: targetRole, uid: target.id, name: target.name, demo: true });
    void recordAudit({
      ...actor,
      action: "auth:demo-switch",
      method: "POST",
      path: PATH,
      resource_type: "session",
      resource_id: null,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: { seq: parsed.seq, from: parsed.role, to: targetRole },
    });

    const response = NextResponse.json({
      ok: true,
      role: targetRole,
      uid: target.id,
      name: target.name,
      user_code: target.user_code,
      demo: true,
    });
    response.cookies.set("auth_token", token, AUTH_COOKIE_OPTIONS);
    return response;
  });
}

export const POST = withDemoScope(POST_impl);
