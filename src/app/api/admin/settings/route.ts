import { NextResponse } from "next/server";
import { getConfig, setConfig, type DbConfig } from "@/lib/db-config";
import { closeDb } from "@/lib/db";
import type { NextRequest } from "next/server";

export async function GET() {
  return NextResponse.json(getConfig());
}

export async function PUT(request: NextRequest) {
  try {
    const newConfig = (await request.json()) as DbConfig;

    const { host, user, database } = newConfig.mysql;
    if (!host || !user || !database) {
      return NextResponse.json({ error: "MySQL 连接信息不完整" }, { status: 400 });
    }

    setConfig({ ...newConfig, installed: true });
    closeDb();

    return NextResponse.json({ message: "配置已更新" });
  } catch {
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
