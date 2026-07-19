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
    return NextResponse.json(
      {
        ok: false,
        error: `连接失败: ${err instanceof Error ? err.message : "未知错误"}`,
      },
      { status: 400 }
    );
  }
}
