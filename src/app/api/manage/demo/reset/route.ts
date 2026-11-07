import { withDemoScope, isDemoScope, isDemoEnabled } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { resetDemo } from "@/lib/demo-lifecycle";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 演示库重置（#253）：**生产 admin 专属的破坏性操作**。
 * 门禁顺序：未开启→404（端点视为不存在）→演示会话→403（demo-admin 也无权重置）→非 admin→403。
 * 校验与审计在生产作用域完成（记录的是「哪个生产管理员重置了演示库」）；实际数据工作交给
 * `resetDemo`，它在内部 `runInDemoScope` 落演示库——与 #252 演示登录同款「真 token、显式进演示作用域」。
 */
async function POST_impl(request: NextRequest) {
  if (!isDemoEnabled()) {
    return NextResponse.json({ ok: false, error: "演示模式未启用" }, { status: 404 });
  }

  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);

  // 演示会话（含 demo-admin）无权重置演示库：拒绝前先取现场并落审计（#253 验收「被拒且落审计」）。
  // 请求处于演示作用域，recordAudit 自然写入演示库审计流——把演示行为写进生产库会违反 #250 物理隔离不变量。
  if (isDemoScope()) {
    void recordAudit({
      ...actor, action: "demo:reset", method: "POST", path: "/api/manage/demo/reset",
      resource_type: "demo", resource_id: null, status: "failed", error_message: "演示会话越权重置",
      ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: false, error: "演示会话不可执行演示库重置" }, { status: 403 });
  }

  const result = await verifyToken(request.cookies.get("auth_token")?.value ?? "");
  if (!result.valid || result.role !== "admin") {
    void recordAudit({
      ...actor, action: "demo:reset", method: "POST", path: "/api/manage/demo/reset",
      resource_type: "demo", resource_id: null, status: "failed", error_message: "越权访问",
      ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // 仅支持全量重置；细粒度作用域（仅数据 / 仅账户）另开 follow-up（账户管理见 #278）
  let scope = "all";
  try {
    const body = (await request.json()) as { scope?: unknown };
    if (typeof body?.scope === "string") scope = body.scope;
  } catch {
    // 无 body 或非 JSON：按默认全量重置
  }
  if (scope !== "all") {
    return NextResponse.json({ ok: false, error: "当前仅支持 scope=all" }, { status: 400 });
  }

  try {
    const report = await resetDemo({
      id: actor.actor_id ?? null,
      name: actor.actor_name ?? null,
      role: actor.actor_role ?? null,
    });
    void recordAudit({
      ...actor, action: "demo:reset", method: "POST", path: "/api/manage/demo/reset",
      resource_type: "demo", resource_id: null, status: "success", error_message: null,
      ip, user_agent, metadata: { report },
    });
    return NextResponse.json({ ok: true, report });
  } catch (err) {
    console.error("Demo reset error:", err);
    void recordAudit({
      ...actor, action: "demo:reset", method: "POST", path: "/api/manage/demo/reset",
      resource_type: "demo", resource_id: null, status: "failed", error_message: "重置失败",
      ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: false, error: "重置失败" }, { status: 500 });
  }
}

export const POST = withDemoScope(POST_impl);
