import { NextRequest, NextResponse } from "next/server";
import { getStorageBackend } from "@/lib/db";
import { verifyToken } from "@/lib/token";
import { createStorage } from "@/lib/storage";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/**
 * 存储后端连通性测试（#111，仅管理员）：
 * - S3：上传临时对象 → 探测存在 → 删除，全链路验证凭据/端点/桶/权限
 * - 本地：uploads 目录读写探测
 */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);

  const token = request.cookies.get("auth_token")?.value;
  const result = token ? await verifyToken(token) : { valid: false };
  if (!result.valid || !result.role || result.uid == null) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (result.role !== "admin") {
    return NextResponse.json({ error: "仅管理员可测试存储后端" }, { status: 403 });
  }

  try {
    const body = (await request.json()) as Record<string, unknown>;
    const id = Number(body.id);
    if (!Number.isInteger(id) || id < 1) {
      return NextResponse.json({ error: "缺少后端 id" }, { status: 400 });
    }
    const backend = await getStorageBackend(id);
    if (!backend) {
      return NextResponse.json({ error: "存储后端不存在" }, { status: 404 });
    }

    const storage = createStorage(backend);
    const probeKey = `_probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.txt`;
    const probe = Buffer.from("career-explorer connectivity probe");
    try {
      await storage.upload(probeKey, probe, "text/plain");
      const exists = await storage.exists(probeKey);
      if (!exists) throw new Error("上传后探测对象不存在");
      const content = await storage.read(probeKey);
      if (content.toString() !== probe.toString()) throw new Error("读回内容不一致");
      await storage.delete(probeKey);
    } catch (err) {
      // 尽力清理探测对象（失败不掩盖真实错误）
      try {
        await storage.delete(probeKey);
      } catch {}
      const message = err instanceof Error ? err.message : "连通性测试失败";
      void recordAudit({
        ...actor, action: "storage:test", method: "POST", path: "/api/manage/storage/test",
        resource_type: "storage-backend", resource_id: String(id),
        status: "failed", error_message: message, ip, user_agent,
        metadata: { name: backend.name },
      });
      return NextResponse.json({ ok: false, error: message }, { status: 200 });
    }

    void recordAudit({
      ...actor, action: "storage:test", method: "POST", path: "/api/manage/storage/test",
      resource_type: "storage-backend", resource_id: String(id),
      status: "success", error_message: null, ip, user_agent,
      metadata: { name: backend.name },
    });
    return NextResponse.json({ ok: true, message: "连通正常" });
  } catch (err) {
    // 凭据缺失等构造期错误也以可读文案返回（不视为服务端故障）
    const message = err instanceof Error ? err.message : "连通性测试失败";
    return NextResponse.json({ ok: false, error: message }, { status: 200 });
  }
}
