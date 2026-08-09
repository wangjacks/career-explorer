import { NextRequest, NextResponse } from "next/server";
import { isInstalled, setConfig, type DbConfig } from "@/lib/db-config";
import { MysqlAdapter } from "@/lib/db-mysql";
import { SqliteAdapter } from "@/lib/db-sqlite";
import type { DbAdapter } from "@/lib/db";
import { hashPassword } from "@/lib/auth";

/** 新安装时创建 admin 用户（密码由安装向导提供，user_code 固定 10001） */
async function createAdminUser(adapter: DbAdapter, plainPassword: string): Promise<void> {
  const existing = await Promise.resolve(adapter.getAdminUser());
  if (existing) return;
  const hash = await hashPassword(plainPassword);
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
    const { adminPassword, ...config } = (await request.json()) as DbConfig & {
      adminPassword?: string;
    };
    if (!adminPassword || adminPassword.length < 8) {
      return NextResponse.json(
        { error: "请设置至少 8 位的管理员密码" },
        { status: 400 }
      );
    }
    const dbType = config.type || "mysql";

    if (dbType === "sqlite") {
      const dbPath = config.sqlite?.path || "./data/career.db";
      const adapter = new SqliteAdapter(dbPath);
      adapter.init();
      await createAdminUser(adapter, adminPassword);
      adapter.close();
    } else {
      const { host, user, database } = config.mysql;
      if (!host || !user || !database) {
        return NextResponse.json({ error: "MySQL 连接信息不完整" }, { status: 400 });
      }
      const adapter = new MysqlAdapter(config.mysql);
      await adapter.init();
      await createAdminUser(adapter, adminPassword);
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
