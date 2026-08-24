import { NextResponse } from "next/server";
import { getConfig, setConfig, type DbConfig } from "@/lib/db-config";
import { closeDb } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import type { NextRequest } from "next/server";

export async function GET() {
  return NextResponse.json(getConfig());
}

export async function PUT(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    const newConfig = (await request.json()) as DbConfig;
    const dbType = newConfig.type || "mysql";

    if (dbType === "sqlite") {
      if (!newConfig.sqlite?.path) {
        return NextResponse.json({ error: "SQLite 路径不能为空" }, { status: 400 });
      }
    } else {
      const { host, user, database } = newConfig.mysql;
      if (!host || !user || !database) {
        return NextResponse.json({ error: "MySQL 连接信息不完整" }, { status: 400 });
      }
    }

    const oldConfig = getConfig();
    const switched = (oldConfig.type || "mysql") !== dbType;

    setConfig({ ...newConfig, installed: true });
    // 审计在 closeDb 前写入；仅记数据源类型变更，不记连接明细（敏感，#110）
    void recordAudit({
      ...actor, action: "settings:update", method: "PUT", path: "/api/manage/settings",
      resource_type: "db-config", resource_id: null,
      status: "success", error_message: null, ip, user_agent,
      metadata: { old: { type: oldConfig.type || "mysql" }, new: { type: dbType }, switched },
    });
    closeDb();

    return NextResponse.json({
      message: "配置已更新",
      emptyBucket: switched,
    });
  } catch (err) {
    console.error("Settings PUT error:", err);
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
