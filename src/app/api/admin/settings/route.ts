import { NextRequest, NextResponse } from "next/server";
import { getConfig, setConfig, type DbConfig } from "@/lib/db-config";
import { getAllProfilesRaw, insertProfile, closeDb } from "@/lib/db";
import { MysqlAdapter } from "@/lib/db-mysql";
import { SqliteAdapter } from "@/lib/db-sqlite";

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

    if (!["sqlite", "mysql"].includes(newConfig.type)) {
      return NextResponse.json({ error: "无效的数据源类型" }, { status: 400 });
    }

    if (newConfig.type === "mysql") {
      const { host, port, user, password, database } = newConfig.mysql;
      if (!host || !user || !database) {
        return NextResponse.json({ error: "MySQL 连接信息不完整" }, { status: 400 });
      }
    }

    const oldConfig = getConfig();

    if (oldConfig.type !== newConfig.type) {
      // Migrating data between different database types
      try {
        // Read all data from old database
        const oldAdapter =
          oldConfig.type === "mysql"
            ? new MysqlAdapter(oldConfig.mysql)
            : new SqliteAdapter();
        if (oldConfig.type === "mysql") {
          await (oldAdapter as MysqlAdapter).init();
        }
        const oldData = await Promise.resolve(oldAdapter.getAllProfilesRaw());
        await Promise.resolve(oldAdapter.close());

        // Write new config
        setConfig(newConfig);

        // Create new adapter and init
        if (newConfig.type === "mysql") {
          const newAdapter = new MysqlAdapter(newConfig.mysql);
          await newAdapter.init();
          // Insert data
          for (const row of oldData) {
            const tags: string[] = JSON.parse(row.tags);
            await newAdapter.insertProfile(tags, row.avatar_url || "");
          }
          await newAdapter.close();
        } else {
          // Switching to SQLite - just write config, SQLite will init on next access
          if (oldConfig.type === "mysql" && oldData.length > 0) {
            const newAdapter = new SqliteAdapter();
            for (const row of oldData) {
              const tags: string[] = JSON.parse(row.tags);
              newAdapter.insertProfile(tags, row.avatar_url || "");
            }
            newAdapter.close();
          }
        }

        closeDb();

        return NextResponse.json({
          message: `已切换到 ${newConfig.type}，迁移了 ${oldData.length} 条记录`,
          migrated: oldData.length,
        });
      } catch (err) {
        return NextResponse.json(
          { error: `迁移失败: ${err instanceof Error ? err.message : "未知错误"}` },
          { status: 500 }
        );
      }
    }

    // Same type, just update config (e.g. MySQL connection details changed)
    setConfig(newConfig);
    closeDb();

    return NextResponse.json({ message: "配置已更新" });
  } catch {
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
