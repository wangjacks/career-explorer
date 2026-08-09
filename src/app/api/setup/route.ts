import { NextRequest, NextResponse } from "next/server";
import { readFileSync } from "fs";
import { join } from "path";
import { isInstalled, setConfig, type DbConfig } from "@/lib/db-config";
import { MysqlAdapter } from "@/lib/db-mysql";
import { SqliteAdapter } from "@/lib/db-sqlite";
import type { DbAdapter } from "@/lib/db";

/** 新安装时创建 admin 用户（从 admin-hash.txt 读密码，文件不存在则跳过） */
async function ensureAdminUser(adapter: DbAdapter): Promise<void> {
  const existing = await Promise.resolve(adapter.getAdminUser());
  if (existing) return;
  let hash = "";
  try {
    hash = readFileSync(join(process.cwd(), "admin-hash.txt"), "utf-8").trim();
  } catch {
    return;
  }
  if (!hash) return;
  await Promise.resolve(
    adapter.insertUser({
      user_code: "10001",
      password_hash: hash,
      role: "admin",
      name: "管理员",
    })
  );
}

export async function POST(request: NextRequest) {
  if (isInstalled()) {
    return NextResponse.json({ error: "系统已安装，无法重复安装" }, { status: 403 });
  }

  try {
    const config = (await request.json()) as DbConfig;
    const dbType = config.type || "mysql";

    if (dbType === "sqlite") {
      const dbPath = config.sqlite?.path || "./data/career.db";
      const adapter = new SqliteAdapter(dbPath);
      adapter.init();
      await ensureAdminUser(adapter);
      adapter.close();
    } else {
      const { host, user, database } = config.mysql;
      if (!host || !user || !database) {
        return NextResponse.json({ error: "MySQL 连接信息不完整" }, { status: 400 });
      }
      const adapter = new MysqlAdapter(config.mysql);
      await adapter.init();
      await ensureAdminUser(adapter);
      await adapter.close();
    }

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
