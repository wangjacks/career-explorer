import { NextRequest, NextResponse } from "next/server";
import mysql from "mysql2/promise";
import { isInstalled } from "@/lib/db-config";
import { SqliteAdapter, sanitizeSqlitePath } from "@/lib/db-sqlite";
import { mkdirSync, accessSync, constants } from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  if (isInstalled()) {
    return NextResponse.json({ error: "系统已安装，无法重复测试" }, { status: 403 });
  }

  try {
    const body = await request.json();
    const dbType = body.type || "mysql";

    if (dbType === "sqlite") {
      const dbPath = sanitizeSqlitePath(body.sqlite?.path || "./data/career.db");
      const dir = path.dirname(dbPath);
      mkdirSync(dir, { recursive: true });
      accessSync(dir, constants.W_OK);
      const adapter = new SqliteAdapter(dbPath);
      adapter.init();
      adapter.close();
      return NextResponse.json({ ok: true, message: "SQLite 数据库可用" });
    }

    const { host, port, user, password, database } = body.mysql || body;
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
