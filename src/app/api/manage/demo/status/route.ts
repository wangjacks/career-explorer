import { withDemoScope, isDemoScope, isDemoEnabled } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { readDemoStatus } from "@/lib/demo-lifecycle";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 演示库状态（#253）：只读诊断，供生产 admin 查看演示是否已初始化、规模计数。
 * 门禁与 reset 同：未开启→404、演示会话→403、非 admin→403。所有计数只来自演示作用域并按演示号段过滤，绝不泄露生产。
 * 成功读取不审计（只读诊断，同 settings GET）；但**越权拒绝会落审计**——演示会话拒绝写演示库审计流
 * （请求处演示作用域，写生产库会违反 #250 隔离不变量），生产非 admin 拒绝写生产审计流。
 */
async function GET_impl(request: NextRequest) {
  if (!isDemoEnabled()) {
    return NextResponse.json({ ok: false, error: "演示模式未启用" }, { status: 404 });
  }

  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);

  if (isDemoScope()) {
    void recordAudit({
      ...actor, action: "demo:status", method: "GET", path: "/api/manage/demo/status",
      resource_type: "demo", resource_id: null, status: "failed", error_message: "演示会话越权查看",
      ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: false, error: "演示会话不可访问" }, { status: 403 });
  }

  const result = await verifyToken(request.cookies.get("auth_token")?.value ?? "");
  if (!result.valid || result.role !== "admin") {
    void recordAudit({
      ...actor, action: "demo:status", method: "GET", path: "/api/manage/demo/status",
      resource_type: "demo", resource_id: null, status: "failed", error_message: "越权访问",
      ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const status = await readDemoStatus();
  return NextResponse.json(status);
}

export const GET = withDemoScope(GET_impl);
