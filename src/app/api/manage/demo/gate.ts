import { NextRequest, NextResponse } from "next/server";
import { isDemoEnabled, isDemoScope } from "@/lib/demo-scope";
import { verifyToken } from "@/lib/token";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

export interface DemoGateOptions {
  /** 拒绝事件使用的审计 action（成功审计由各路由按具体动作自行记录） */
  action: string;
  method: string;
  path: string;
}

export type DemoGateResult =
  | {
      ok: true;
      actor: Awaited<ReturnType<typeof getAuditActor>>;
      ip: string;
      userAgent: string;
    }
  | { ok: false; response: NextResponse };

/**
 * 演示管理端点统一门禁（#278）：仅生产 admin。
 * 顺序与 #253 的 reset/status 一致：未开启→404；演示会话→403 且拒绝落**演示**审计
 * （请求处演示作用域，写生产会违反 #250 隔离）；非 admin→403 且拒绝落**生产**审计。
 * 注意：通过门禁后，路由仍须用 `demoDbExists()` 决定是否需要进入演示作用域（避免 GET 建库副作用）。
 */
export async function guardDemoAdmin(
  request: NextRequest,
  opts: DemoGateOptions
): Promise<DemoGateResult> {
  if (!isDemoEnabled()) {
    return { ok: false, response: NextResponse.json({ ok: false, error: "演示模式未启用" }, { status: 404 }) };
  }

  const { ip, user_agent: userAgent } = getRequestContext(request);
  const actor = await getAuditActor(request);

  if (isDemoScope()) {
    void recordAudit({
      ...actor,
      action: opts.action,
      method: opts.method,
      path: opts.path,
      resource_type: "demo-account",
      resource_id: null,
      status: "failed",
      error_message: "演示会话越权访问",
      ip,
      user_agent: userAgent,
      metadata: null,
    });
    return { ok: false, response: NextResponse.json({ ok: false, error: "演示会话不可访问" }, { status: 403 }) };
  }

  const result = await verifyToken(request.cookies.get("auth_token")?.value ?? "");
  if (!result.valid || result.role !== "admin") {
    void recordAudit({
      ...actor,
      action: opts.action,
      method: opts.method,
      path: opts.path,
      resource_type: "demo-account",
      resource_id: null,
      status: "failed",
      error_message: "越权访问",
      ip,
      user_agent: userAgent,
      metadata: null,
    });
    return { ok: false, response: NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 }) };
  }

  return { ok: true, actor, ip, userAgent };
}
