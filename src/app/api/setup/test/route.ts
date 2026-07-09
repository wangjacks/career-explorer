import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { isInstalled } from "@/lib/db-config";

export async function POST(request: NextRequest) {
  if (isInstalled()) {
    return NextResponse.json({ error: "系统已安装，无法重复测试" }, { status: 403 });
  }

  try {
    const { host, port, user, password, database } = await request.json();

    const conn = await mysql.createConnection({
      host,
      port: port || 3306,
      user,
      password,
      database,
      connectTimeout: 5000,
    });

    await conn.ping();
    await conn.end();

    return NextResponse.json({ ok: true, message: "连接成功" });
  } catch (err) {
    return NextResponse.json(
      {
        ok: false,
        error: `连接失败: ${err instanceof Error ? err.message : "未知错误"}`,
      },
      { status: 400 }
    );
  }
}
