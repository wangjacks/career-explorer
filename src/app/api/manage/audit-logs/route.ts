import { NextRequest, NextResponse } from "next/server";
import { queryAuditLogs } from "@/lib/db";
import type { AuditLogFilters } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 审计日志查询（#110）：只读端点，不提供任何修改/删除接口。
 * - admin 查看全部记录
 * - teacher 强制 actor_id = 本人（忽略前端传来的操作者筛选，防越权）
 * - 查询本身记 `audit:query`（审计功能不得成为绕过权限的入口）
 */
export async function GET(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);

  // 路由内再验签拿操作者身份（端点在 proxy matcher 内已过鉴权，此处为分流依据）
  const token = request.cookies.get("auth_token")?.value;
  const result = token ? await verifyToken(token) : { valid: false };
  if (!result.valid || !result.role || result.uid == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.role !== "admin" && result.role !== "teacher") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const sp = request.nextUrl.searchParams;
  const page = Number(sp.get("page") ?? 1);
  const pageSize = Number(sp.get("pageSize") ?? 20);
  if (!Number.isInteger(page) || page < 1 || !Number.isInteger(pageSize) || pageSize < 1 || pageSize > 100) {
    return NextResponse.json({ error: "分页参数无效" }, { status: 400 });
  }

  const filters: AuditLogFilters = {
    page,
    pageSize,
    from: sp.get("from") || undefined,
    to: sp.get("to") || undefined,
    actorRole: sp.get("role") || undefined,
    actorQuery: sp.get("actor") || undefined,
    action: sp.get("action") || undefined,
    resourceType: sp.get("resourceType") || undefined,
    status: sp.get("status") || undefined,
  };
  // teacher 强制只看本人记录：前端伪造任何筛选都无法越权
  if (result.role === "teacher") {
    filters.actorId = result.uid;
  }

  try {
    const { rows, total } = await queryAuditLogs(filters);

    // 审计查询自身被审计（#110 验收项）
    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor,
      action: "audit:query",
      method: "GET",
      path: "/api/manage/audit-logs",
      resource_type: "audit-log",
      resource_id: null,
      status: "success",
      error_message: null,
      ip,
      user_agent,
      metadata: {
        page,
        pageSize,
        action: filters.action ?? null,
        resourceType: filters.resourceType ?? null,
        status: filters.status ?? null,
      },
    });

    return NextResponse.json({ data: rows, total, page, pageSize });
  } catch (err) {
    console.error("Audit logs GET error:", err);
    return NextResponse.json({ error: "查询失败" }, { status: 500 });
  }
}
