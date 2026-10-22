import { withDemoScope, isDemoScope } from "@/lib/demo-scope";
import { NextResponse } from "next/server";
import { getConfig, setConfig, type DbConfig } from "@/lib/db-config";
import { closeDb } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";
import type { NextRequest } from "next/server";

// settings 读写的是进程级全局文件 db-config.json（不是 DB），withDemoScope 的库改道对它
// 零覆盖：GET 会把生产数据源参数（含 MySQL 口令）泄露给演示会话，PUT 会改写生产指向。
// 此处对演示会话就地拒绝作为纵深；系统性的角色门（proxy 权限表）由 #252 负责。
async function GET_impl() {
  if (isDemoScope()) {
    return NextResponse.json({ error: "演示会话不可访问系统设置" }, { status: 403 });
  }
  return NextResponse.json(getConfig());
}

async function PUT_impl(request: NextRequest) {
  if (isDemoScope()) {
    return NextResponse.json({ error: "演示会话不可修改系统设置" }, { status: 403 });
  }
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

export const GET = withDemoScope(GET_impl);
export const PUT = withDemoScope(PUT_impl);
