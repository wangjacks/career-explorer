import mysql from "mysql2/promise";
import { readFileSync, existsSync } from "fs";
import path from "path";
import { tagCategories } from "./tagData";
import type {
  UserRow,
  TagRow,
  ClassRow,
  Stats,
  DbAdapter,
  BackupData,
  NewUser,
  UserUpdateFields,
} from "./db";

function getNow(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function getToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

const ADMIN_HASH_PATH = path.join(process.cwd(), "admin-hash.txt");

interface MySqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

interface LegacyStudent {
  student_id: string;
  name: string;
  class_name?: string;
  created_at: string;
}

interface LegacyProfile {
  student_id: string;
  tags: string;
  avatar_url: string | null;
  evaluation_url: string | null;
  created_at: string;
}

export class MysqlAdapter implements DbAdapter {
  private pool: mysql.Pool;
  private database: string;

  constructor(config: MySqlConfig) {
    this.database = config.database;
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      timezone: "+08:00",
      waitForConnections: true,
      connectionLimit: 5,
      dateStrings: true,
    });
  }

  async init(): Promise<void> {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS classes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        invitation_code VARCHAR(16) NOT NULL UNIQUE,
        created_at TEXT
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_code VARCHAR(20) NOT NULL UNIQUE,
        password_hash VARCHAR(100),
        role VARCHAR(10) NOT NULL,
        name VARCHAR(50) NOT NULL,
        class_id INT,
        tags TEXT,
        avatar_url VARCHAR(500),
        evaluation_url VARCHAR(500),
        submitted_at TEXT,
        created_at TEXT,
        INDEX idx_users_role (role)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS teacher_classes (
        id INT AUTO_INCREMENT PRIMARY KEY,
        teacher_id INT NOT NULL,
        class_id INT NOT NULL,
        created_at TEXT,
        UNIQUE KEY uq_teacher_class (teacher_id, class_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS tags (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        category VARCHAR(50) NOT NULL,
        class_id INT,
        category_order INT DEFAULT 0,
        sort_order INT DEFAULT 0,
        UNIQUE KEY uq_tag_class (name, class_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.migrateLegacy();
    await this.seedTags();
  }

  private async tableExists(name: string): Promise<boolean> {
    const [rows] = await this.pool.execute(
      "SELECT 1 FROM information_schema.tables WHERE table_schema = ? AND table_name = ?",
      [this.database, name]
    );
    return (rows as unknown[]).length > 0;
  }

  private async columnExists(table: string, column: string): Promise<boolean> {
    const [rows] = await this.pool.execute(
      "SELECT 1 FROM information_schema.columns WHERE table_schema = ? AND table_name = ? AND column_name = ?",
      [this.database, table, column]
    );
    return (rows as unknown[]).length > 0;
  }

  /** 预填充标签（重复执行安全；class_id=0 表示全局标签，避免 NULL 破坏 UNIQUE 约束） */
  private async seedTags(): Promise<void> {
    for (let ci = 0; ci < tagCategories.length; ci++) {
      const cat = tagCategories[ci];
      for (let ti = 0; ti < cat.tags.length; ti++) {
        await this.pool.execute(
          `INSERT IGNORE INTO tags (name, category, class_id, category_order, sort_order)
           VALUES (?, ?, 0, ?, ?)`,
          [cat.tags[ti], cat.name, ci, ti]
        );
      }
    }
  }

  /** 检测旧 students 表并迁移到 users 表 */
  private async migrateLegacy(): Promise<void> {
    if (!(await this.tableExists("students"))) return;

    const hasClassName = await this.columnExists("students", "class_name");
    const [studentRows] = await this.pool.execute(
      hasClassName
        ? "SELECT student_id, name, class_name, created_at FROM students"
        : "SELECT student_id, name, '' as class_name, created_at FROM students"
    );
    const students = studentRows as LegacyStudent[];

    const hasProfiles = await this.tableExists("profiles");
    let profiles: LegacyProfile[] = [];
    if (hasProfiles) {
      const [profileRows] = await this.pool.execute("SELECT * FROM profiles");
      profiles = profileRows as LegacyProfile[];
    }
    const profileMap = new Map(profiles.map((p) => [p.student_id, p]));

    // 迁移前必须先填充标签，才能做名称→ID 转换
    await this.seedTags();
    const [tagRows] = await this.pool.execute(
      "SELECT id, name FROM tags WHERE class_id = 0"
    );
    const nameToId = new Map(
      (tagRows as { id: number; name: string }[]).map((t) => [t.name, t.id])
    );

    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      for (const s of students) {
        const p = profileMap.get(s.student_id);
        let tagsJson: string | null = null;
        if (p) {
          try {
            const names = JSON.parse(p.tags) as string[];
            const ids = names
              .map((n) => nameToId.get(n))
              .filter((id): id is number => id !== undefined);
            tagsJson = JSON.stringify(ids);
          } catch {
            tagsJson = null;
          }
        }
        await conn.execute(
          `INSERT IGNORE INTO users (user_code, role, name, tags, avatar_url, evaluation_url, submitted_at, created_at)
           VALUES (?, 'student', ?, ?, ?, ?, ?, ?)`,
          [
            s.student_id,
            s.name,
            tagsJson,
            p?.avatar_url ?? null,
            p?.evaluation_url ?? null,
            p ? (p.created_at ?? getNow()) : null,
            s.created_at,
          ]
        );
      }
      await this.ensureAdminUser(conn);
      if (hasProfiles) await conn.execute("DROP TABLE profiles");
      await conn.execute("DROP TABLE students");
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  /** 从 admin-hash.txt 迁移管理员密码到 users 表（文件不存在则跳过） */
  private async ensureAdminUser(conn?: mysql.PoolConnection): Promise<void> {
    const executor = conn ?? this.pool;
    const [existing] = await executor.execute(
      "SELECT id FROM users WHERE role = 'admin' LIMIT 1"
    );
    if ((existing as unknown[]).length > 0) return;
    if (!existsSync(ADMIN_HASH_PATH)) return;
    const hash = readFileSync(ADMIN_HASH_PATH, "utf-8").trim();
    if (!hash) return;
    await executor.execute(
      `INSERT IGNORE INTO users (user_code, password_hash, role, name, created_at)
       VALUES ('10001', ?, 'admin', '管理员', ?)`,
      [hash, getNow()]
    );
  }

  // users
  async insertUser(user: NewUser): Promise<number> {
    const [result] = await this.pool.execute(
      `INSERT INTO users (user_code, password_hash, role, name, class_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`,
      [
        user.user_code,
        user.password_hash ?? null,
        user.role,
        user.name,
        user.class_id ?? null,
        getNow(),
      ]
    );
    return (result as mysql.ResultSetHeader).insertId;
  }

  async getUserByCode(userCode: string): Promise<UserRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE user_code = ?", [userCode]);
    return (rows as UserRow[])[0];
  }

  async getAdminUser(): Promise<UserRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE role = 'admin' LIMIT 1");
    return (rows as UserRow[])[0];
  }

  async updateUser(id: number, fields: UserUpdateFields): Promise<void> {
    const sets: string[] = [];
    const values: (string | number | null)[] = [];
    if (fields.name !== undefined) {
      sets.push("name = ?");
      values.push(fields.name);
    }
    if (fields.class_id !== undefined) {
      sets.push("class_id = ?");
      values.push(fields.class_id);
    }
    if (fields.password_hash !== undefined) {
      sets.push("password_hash = ?");
      values.push(fields.password_hash);
    }
    if (sets.length === 0) return;
    values.push(id);
    await this.pool.execute(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`, values);
  }

  async deleteStudents(userCodes: string[]): Promise<number> {
    if (userCodes.length === 0) return 0;
    const placeholders = userCodes.map(() => "?").join(",");
    const [result] = await this.pool.execute(
      `DELETE FROM users WHERE role = 'student' AND user_code IN (${placeholders})`,
      userCodes
    );
    return (result as mysql.ResultSetHeader).affectedRows;
  }

  async getStudents(): Promise<UserRow[]> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM users WHERE role = 'student' ORDER BY id"
    );
    return rows as UserRow[];
  }

  async getStudentByCode(userCode: string): Promise<UserRow | undefined> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM users WHERE role = 'student' AND user_code = ?",
      [userCode]
    );
    return (rows as UserRow[])[0];
  }

  // submissions
  async upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string): Promise<void> {
    await this.pool.execute(
      `UPDATE users SET tags = ?, avatar_url = ?, evaluation_url = ?, submitted_at = ?
       WHERE role = 'student' AND user_code = ?`,
      [tagsJson, avatarUrl, evaluationUrl, getNow(), userCode]
    );
  }

  async getSubmittedProfiles(
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ rows: UserRow[]; total: number }> {
    const [countResult] = await this.pool.execute(
      "SELECT COUNT(*) as c FROM users WHERE role = 'student' AND submitted_at IS NOT NULL"
    );
    const total = Number((countResult as { c: number }[])[0].c);
    const offset = (page - 1) * pageSize;
    const [rows] = await this.pool.query(
      `SELECT * FROM users WHERE role = 'student' AND submitted_at IS NOT NULL
       ORDER BY submitted_at DESC LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    return { rows: rows as UserRow[], total };
  }

  async getAllSubmitted(): Promise<UserRow[]> {
    const [rows] = await this.pool.execute(
      `SELECT * FROM users WHERE role = 'student' AND submitted_at IS NOT NULL
       ORDER BY user_code`
    );
    return rows as UserRow[];
  }

  async clearSubmissions(userCodes: string[]): Promise<number> {
    if (userCodes.length === 0) return 0;
    const placeholders = userCodes.map(() => "?").join(",");
    const [result] = await this.pool.execute(
      `UPDATE users SET tags = NULL, avatar_url = NULL, evaluation_url = NULL, submitted_at = NULL
       WHERE role = 'student' AND user_code IN (${placeholders})`,
      userCodes
    );
    return (result as mysql.ResultSetHeader).affectedRows;
  }

  // stats
  async getStats(): Promise<Stats> {
    const [countResult] = await this.pool.execute(
      "SELECT COUNT(*) as c FROM users WHERE role = 'student' AND submitted_at IS NOT NULL"
    );
    const total = Number((countResult as { c: number }[])[0].c);
    const today = getToday();
    const tomorrow = new Date(new Date(today).getTime() + 86400000).toISOString().slice(0, 10);
    const [todayResult] = await this.pool.execute(
      `SELECT COUNT(*) as c FROM users
       WHERE role = 'student' AND submitted_at >= ? AND submitted_at < ?`,
      [today, tomorrow]
    );
    const todayCount = Number((todayResult as { c: number }[])[0].c);
    const [tagRows] = await this.pool.execute("SELECT id, name FROM tags");
    const idToName = new Map(
      (tagRows as { id: number; name: string }[]).map((t) => [t.id, t.name])
    );
    const [allRows] = await this.pool.execute(
      "SELECT tags FROM users WHERE role = 'student' AND submitted_at IS NOT NULL AND tags IS NOT NULL"
    );
    const tagCount: Record<string, number> = {};
    for (const row of allRows as { tags: string }[]) {
      try {
        for (const id of JSON.parse(row.tags) as number[]) {
          const name = idToName.get(id);
          if (name) tagCount[name] = (tagCount[name] || 0) + 1;
        }
      } catch {}
    }
    const uniqueTags = Object.keys(tagCount).length;
    const topTags = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    return { total, today: todayCount, uniqueTags, topTags };
  }

  async getTrends(days: number): Promise<{ date: string; count: number }[]> {
    const since = new Date(Date.now() - days * 86400000).toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    });
    const [rows] = await this.pool.execute(
      `SELECT DATE(submitted_at) as d, COUNT(*) as c FROM users
       WHERE role = 'student' AND submitted_at >= ?
       GROUP BY DATE(submitted_at) ORDER BY d`,
      [since]
    );
    return (rows as { d: string; c: number }[]).map((r) => ({ date: String(r.d), count: Number(r.c) }));
  }

  async getCompareBy(by: "class" | "segment"): Promise<{ key: string; count: number }[]> {
    if (by === "class") {
      const [rows] = await this.pool.execute(
        `SELECT COALESCE(c.name, '未分班') as k, COUNT(*) as c
         FROM users u LEFT JOIN classes c ON u.class_id = c.id
         WHERE u.role = 'student' AND u.submitted_at IS NOT NULL
         GROUP BY k ORDER BY k`
      );
      return (rows as { k: string; c: number }[]).map((r) => ({ key: r.k, count: Number(r.c) }));
    }
    const [rows] = await this.pool.execute(
      `SELECT LEFT(user_code, 4) as k, COUNT(*) as c FROM users
       WHERE role = 'student' AND submitted_at IS NOT NULL
       GROUP BY k ORDER BY k`
    );
    return (rows as { k: string; c: number }[]).map((r) => ({ key: r.k, count: Number(r.c) }));
  }

  // tags & classes
  async getTags(): Promise<TagRow[]> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM tags ORDER BY category_order, sort_order, id"
    );
    return rows as TagRow[];
  }

  async getClasses(): Promise<ClassRow[]> {
    const [rows] = await this.pool.execute("SELECT * FROM classes ORDER BY id");
    return rows as ClassRow[];
  }

  async getClassByName(name: string): Promise<ClassRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM classes WHERE name = ?", [name]);
    return (rows as ClassRow[])[0];
  }

  async getClassByInviteCode(code: string): Promise<ClassRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM classes WHERE invitation_code = ?", [code]);
    return (rows as ClassRow[])[0];
  }

  async insertClass(name: string, invitationCode: string): Promise<number> {
    const [result] = await this.pool.execute(
      "INSERT INTO classes (name, invitation_code, created_at) VALUES (?, ?, ?)",
      [name, invitationCode, getNow()]
    );
    return (result as mysql.ResultSetHeader).insertId;
  }

  async backup(): Promise<BackupData> {
    const [users] = await this.pool.execute("SELECT * FROM users ORDER BY id");
    const [classes] = await this.pool.execute("SELECT * FROM classes ORDER BY id");
    const [teacherClasses] = await this.pool.execute("SELECT * FROM teacher_classes ORDER BY id");
    const [tags] = await this.pool.execute("SELECT * FROM tags ORDER BY id");
    return {
      version: 2,
      sourceType: "mysql",
      createdAt: new Date().toISOString(),
      users: users as UserRow[],
      classes: classes as ClassRow[],
      teacher_classes: teacherClasses as BackupData["teacher_classes"],
      tags: tags as TagRow[],
    };
  }

  async restore(data: BackupData): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("DELETE FROM teacher_classes");
      await conn.execute("DELETE FROM users");
      await conn.execute("DELETE FROM classes");
      await conn.execute("DELETE FROM tags");
      if (data.tags.length > 0) {
        const values = data.tags.map((t) => [t.id, t.name, t.category, t.class_id, t.category_order, t.sort_order]);
        await conn.query(
          "INSERT INTO tags (id, name, category, class_id, category_order, sort_order) VALUES ?",
          [values]
        );
      }
      if (data.classes.length > 0) {
        const values = data.classes.map((c) => [c.id, c.name, c.invitation_code, c.created_at]);
        await conn.query(
          "INSERT INTO classes (id, name, invitation_code, created_at) VALUES ?",
          [values]
        );
      }
      if (data.users.length > 0) {
        const values = data.users.map((u) => [
          u.id,
          u.user_code,
          u.password_hash,
          u.role,
          u.name,
          u.class_id,
          u.tags,
          u.avatar_url,
          u.evaluation_url,
          u.submitted_at,
          u.created_at,
        ]);
        await conn.query(
          `INSERT INTO users (id, user_code, password_hash, role, name, class_id, tags, avatar_url, evaluation_url, submitted_at, created_at)
           VALUES ?`,
          [values]
        );
      }
      if (data.teacher_classes.length > 0) {
        const values = data.teacher_classes.map((tc) => [tc.id, tc.teacher_id, tc.class_id, tc.created_at]);
        await conn.query(
          "INSERT INTO teacher_classes (id, teacher_id, class_id, created_at) VALUES ?",
          [values]
        );
      }
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
