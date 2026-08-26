import { NextRequest, NextResponse } from "next/server";
import { MEDIA_ORPHAN_RETENTION_KEY, setProfileConfig } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { scanMedia } from "@/lib/media-scan";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/** 仅 admin 校验（媒体治理不开放 teacher）；403 越权记审计（#110 模式） */
async function requireAdmin(request: NextRequest, action: string): Promise<{ ok: boolean; response: NextResponse | null }> {
  const token = request.cookies.get("auth_token")?.value;
  if (!token) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  const result = await verifyToken(token);
  if (!result.valid || result.uid == null) {
    return { ok: false, response: NextResponse.json({ error: "Unauthorized" }, { status: 401 }) };
  }
  if (result.role !== "admin") {
    const { ip, user_agent } = getRequestContext(request);
    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor, action, method: request.method, path: request.nextUrl.pathname,
      resource_type: "media", resource_id: null,
      status: "failed", error_message: "越权访问", ip, user_agent, metadata: null,
    });
    return { ok: false, response: NextResponse.json({ error: "Forbidden" }, { status: 403 }) };
  }
  return { ok: true, response: null };
}

/** 媒体总览统计（#117）：扫描全部后端文件与引用，返回统计与保留期配置 */
export async function GET(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const auth = await requireAdmin(request, "media:query");
  if (!auth.ok) return auth.response!;
  try {
    const { status } = await scanMedia();
    return NextResponse.json({ ok: true, ...status });
  } catch (err) {
    console.error("Media status error:", err);
    // 服务器异常留痕（CR P2-1）：扫描/存储故障 500 记 failed
    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor, action: "media:query", method: "GET", path: "/api/manage/media/status",
      resource_type: "media", resource_id: null,
      status: "failed", error_message: err instanceof Error ? err.message : "服务器错误", ip, user_agent, metadata: null,
    });
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}

/** 保存孤儿保留期（#117）：整数 1–365，审计 media:config-update */
export async function PUT(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const auth = await requireAdmin(request, "media:config-update");
  if (!auth.ok) return auth.response!;
  try {
    const body = (await request.json()) as { retentionDays?: unknown };
    const retentionDays = body.retentionDays;
    // 严格类型校验（CR P3-6）：Number(true) 等宽松转换会绕过校验，必须显式 number 类型
    if (typeof retentionDays !== "number" || !Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > 365) {
      // 参数非法也记 failed 审计（CR P3-8 与 cleanup 400 一致）
      const actor = await getAuditActor(request);
      void recordAudit({
        ...actor, action: "media:config-update", method: "PUT", path: "/api/manage/media/status",
        resource_type: "media", resource_id: null,
        status: "failed", error_message: "保留期参数非法", ip, user_agent, metadata: null,
      });
      return NextResponse.json({ error: "保留期须为 1-365 的整数（天）" }, { status: 400 });
    }
    await setProfileConfig(MEDIA_ORPHAN_RETENTION_KEY, String(retentionDays));

    const actor = await getAuditActor(request);
    void recordAudit({
      ...actor, action: "media:config-update", method: "PUT", path: "/api/manage/media/status",
      resource_type: "media", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { retentionDays },
    });
    return NextResponse.json({ ok: true, retentionDays });
  } catch (err) {
    console.error("Media config update error:", err);
    return NextResponse.json({ error: "服务器错误" }, { status: 500 });
  }
}
