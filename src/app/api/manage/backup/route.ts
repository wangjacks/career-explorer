import { NextRequest, NextResponse } from "next/server";
import { backup, restore, type BackupData } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

export async function GET(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const data = await backup();
    void recordAudit({
      ...actor, action: "backup:create", method: "GET", path: "/api/manage/backup",
      resource_type: "backup", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { users: data.users.length, sourceType: data.sourceType },
    });
    return NextResponse.json(data);
  } catch (err) {
    console.error("Backup error:", err);
    return NextResponse.json(
      { error: `备份失败: ${err instanceof Error ? err.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const data = (await request.json()) as BackupData;

    if (!data.version || !Array.isArray(data.users) || !Array.isArray(data.tags)) {
      void recordAudit({
        ...actor, action: "backup:restore", method: "POST", path: "/api/manage/backup",
        resource_type: "backup", resource_id: null,
        status: "failed", error_message: "备份文件格式无效", ip, user_agent, metadata: null,
      });
      return NextResponse.json({ error: "备份文件格式无效" }, { status: 400 });
    }

    await restore(data);
    // 恢复的审计记录必须在 restore() 完成后写入（先写会被恢复动作清空，#110）
    void recordAudit({
      ...actor, action: "backup:restore", method: "POST", path: "/api/manage/backup",
      resource_type: "backup", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { users: data.users.length, sourceType: data.sourceType ?? null },
    });
    return NextResponse.json({ ok: true, message: "恢复成功" });
  } catch (err) {
    console.error("Restore error:", err);
    void recordAudit({
      ...actor, action: "backup:restore", method: "POST", path: "/api/manage/backup",
      resource_type: "backup", resource_id: null,
      status: "failed", error_message: err instanceof Error ? err.message : "恢复失败", ip, user_agent,
      metadata: null,
    });
    return NextResponse.json(
      { error: `恢复失败: ${err instanceof Error ? err.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
