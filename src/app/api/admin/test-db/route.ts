import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import type { NextRequest } from "next/server";
import { SqliteAdapter } from "@/lib/db-sqlite";
import { mkdirSync, accessSync, constants } from "fs";
import path from "path";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const dbType = body.type || "mysql";

    if (dbType === "sqlite") {
      const dbPath = body.sqlite?.path || "./data/career.db";
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
    console.error("Test-db error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: `连接失败: ${err instanceof Error ? err.message : "未知错误"}`,
      },
      { status: 400 }
    );
  }
}
import { NextResponse } from "next/server";
import mysql from "mysql2/promise";
import type { NextRequest } from "next/server";

export async function POST(request: NextRequest) {
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
    console.error("Test-db error:", err);
    return NextResponse.json(
      {
        ok: false,
        error: `连接失败: ${err instanceof Error ? err.message : "未知错误"}`,
      },
      { status: 400 }
    );
  }
}
