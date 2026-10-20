import { withDemoScope, isDemoScope, isDemoEnabled } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { verifyToken } from "@/lib/token";
import { readDemoStatus } from "@/lib/demo-lifecycle";

/**
 * 演示库状态（#253）：只读诊断，供生产 admin 查看演示是否已初始化、规模计数。
 * 门禁与 reset 同：未开启→404、演示会话→403、非 admin→403。所有计数只来自演示作用域并按演示号段过滤，绝不泄露生产。
 * 只读、非破坏性，故不记审计（与 settings GET 一致）。
 */
async function GET_impl(request: NextRequest) {
  if (!isDemoEnabled()) {
    return NextResponse.json({ ok: false, error: "演示模式未启用" }, { status: 404 });
  }
  if (isDemoScope()) {
    return NextResponse.json({ ok: false, error: "演示会话不可访问" }, { status: 403 });
  }
  const result = await verifyToken(request.cookies.get("auth_token")?.value ?? "");
  if (!result.valid || result.role !== "admin") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }
  const status = await readDemoStatus();
  return NextResponse.json(status);
}

export const GET = withDemoScope(GET_impl);
