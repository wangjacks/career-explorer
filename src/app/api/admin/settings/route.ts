import { NextRequest, NextResponse } from "next/server";
import { getConfig, setConfig, type DbConfig } from "@/lib/db-config";
import { closeDb } from "@/lib/db";

function checkAuth(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const password = process.env.ADMIN_PASSWORD || "admin123";
  return auth === `Bearer ${password}`;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }
  return NextResponse.json(getConfig());
}

export async function PUT(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  try {
    const newConfig = (await request.json()) as DbConfig;

    const { host, port, user, password, database } = newConfig.mysql;
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
