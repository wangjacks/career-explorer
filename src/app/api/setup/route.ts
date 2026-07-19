import { NextRequest, NextResponse } from "next/server";
import { isInstalled, setConfig, type DbConfig } from "@/lib/db-config";
import { MysqlAdapter } from "@/lib/db-mysql";

export async function POST(request: NextRequest) {
  if (isInstalled()) {
    return NextResponse.json({ error: "系统已安装，无法重复安装" }, { status: 403 });
  }

  try {
    const config = (await request.json()) as DbConfig;

    const { host, user, database } = config.mysql;
    if (!host || !user || !database) {
      return NextResponse.json({ error: "MySQL 连接信息不完整" }, { status: 400 });
    }

    const adapter = new MysqlAdapter(config.mysql);
    await adapter.init();
    await adapter.close();

    setConfig({ ...config, installed: true });

    return NextResponse.json({ ok: true, message: "安装成功" });
  } catch (err) {
    console.error("Setup error:", err);
    return NextResponse.json(
      { error: `安装失败: ${err instanceof Error ? err.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
