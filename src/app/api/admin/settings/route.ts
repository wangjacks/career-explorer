import { NextRequest, NextResponse } from "next/server";
import { getConfig, setConfig, type DbConfig } from "@/lib/db-config";
import { closeDb } from "@/lib/db";
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
      try {
        // Read all data from old database
        const oldAdapter =
          oldConfig.type === "mysql"
            ? new MysqlAdapter(oldConfig.mysql)
            : new SqliteAdapter();
        if (oldConfig.type === "mysql") {
          await (oldAdapter as MysqlAdapter).init();
        }
        const oldStudents = await Promise.resolve(oldAdapter.getAllStudents());
        const oldProfiles = await Promise.resolve(oldAdapter.getAllProfilesRaw());
        await Promise.resolve(oldAdapter.close());

        // Write new config
        setConfig(newConfig);

        // Create new adapter and init
        if (newConfig.type === "mysql") {
          const newAdapter = new MysqlAdapter(newConfig.mysql);
          await newAdapter.init();
          // Insert students
          if (oldStudents.length > 0) {
            await newAdapter.insertStudentsBatch(
              oldStudents.map((s) => ({ studentId: s.student_id, name: s.name }))
            );
          }
          // Insert profiles
          for (const row of oldProfiles) {
            const tags: string[] = JSON.parse(row.tags);
            await newAdapter.insertProfile(row.student_id, tags, row.avatar_url || "", row.evaluation_url || "");
          }
          await newAdapter.close();
        } else {
          if (oldConfig.type === "mysql") {
            const newAdapter = new SqliteAdapter();
            for (const s of oldStudents) {
              newAdapter.insertStudent(s.student_id, s.name);
            }
            for (const row of oldProfiles) {
              const tags: string[] = JSON.parse(row.tags);
              newAdapter.insertProfile(row.student_id, tags, row.avatar_url || "", row.evaluation_url || "");
            }
            newAdapter.close();
          }
        }

        closeDb();

        return NextResponse.json({
          message: `已切换到 ${newConfig.type}，迁移了 ${oldStudents.length} 名学生和 ${oldProfiles.length} 条档案`,
          migratedStudents: oldStudents.length,
          migratedProfiles: oldProfiles.length,
        });
      } catch (err) {
        return NextResponse.json(
          { error: `迁移失败: ${err instanceof Error ? err.message : "未知错误"}` },
          { status: 500 }
        );
      }
    }

    // Same type, just update config
    setConfig(newConfig);
    closeDb();

    return NextResponse.json({ message: "配置已更新" });
  } catch {
    return NextResponse.json({ error: "保存失败" }, { status: 500 });
  }
}
