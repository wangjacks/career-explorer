import mysql from "mysql2/promise";
import type { ProfileRow, StudentRow, Stats, DbAdapter, BackupData } from "./db";

function getNow(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function getToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

interface MySqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export class MysqlAdapter implements DbAdapter {
  private pool: mysql.Pool;

  constructor(config: MySqlConfig) {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      timezone: "+08:00",
      waitForConnections: true,
      connectionLimit: 5,
    });
  }

  async init(): Promise<void> {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS students (
        student_id VARCHAR(12) PRIMARY KEY,
        name VARCHAR(50) NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS profiles (
        student_id VARCHAR(12) PRIMARY KEY,
        tags TEXT NOT NULL,
        avatar_url VARCHAR(500),
        evaluation_url VARCHAR(500),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    try {
      await this.pool.execute("ALTER TABLE profiles ADD COLUMN evaluation_url VARCHAR(500)");
    } catch {}
    try {
      await this.pool.execute("CREATE INDEX idx_profiles_created_at ON profiles(created_at)");
    } catch {}
    try {
      await this.pool.execute("ALTER TABLE students ADD COLUMN class_name VARCHAR(50) DEFAULT ''");
    } catch {}
  }

  // Students
  async insertStudent(studentId: string, name: string, className: string = ""): Promise<void> {
    await this.pool.execute(
      "INSERT INTO students (student_id, name, class_name, created_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), class_name = VALUES(class_name), created_at = VALUES(created_at)",
      [studentId, name, className, getNow()]
    );
  }

  async insertStudentsBatch(students: { studentId: string; name: string; className?: string }[]): Promise<void> {
    if (students.length === 0) return;
    const now = getNow();
    const values = students.map((s) => [s.studentId, s.name, s.className || "", now]);
    await this.pool.query(
      "INSERT INTO students (student_id, name, class_name, created_at) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name), class_name = VALUES(class_name), created_at = VALUES(created_at)",
      [values]
    );
  }

  async getStudent(studentId: string): Promise<StudentRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM students WHERE student_id = ?", [studentId]);
    return (rows as StudentRow[])[0];
  }

  async getAllStudents(): Promise<StudentRow[]> {
    const [rows] = await this.pool.execute("SELECT * FROM students ORDER BY student_id");
    return rows as StudentRow[];
  }

  async deleteStudents(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const [result] = await this.pool.execute(`DELETE FROM students WHERE student_id IN (${placeholders})`, ids);
    return (result as mysql.ResultSetHeader).affectedRows;
  }

  // Profiles
  async insertProfile(studentId: string, tags: string[], avatarUrl: string, evaluationUrl: string): Promise<void> {
    await this.pool.execute(
      "INSERT INTO profiles (student_id, tags, avatar_url, evaluation_url, created_at) VALUES (?, ?, ?, ?, ?) ON DUPLICATE KEY UPDATE tags = VALUES(tags), avatar_url = VALUES(avatar_url), evaluation_url = VALUES(evaluation_url), created_at = VALUES(created_at)",
      [studentId, JSON.stringify(tags), avatarUrl, evaluationUrl, getNow()]
    );
  }

  async getProfile(studentId: string): Promise<ProfileRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM profiles WHERE student_id = ?", [studentId]);
    return (rows as ProfileRow[])[0];
  }

  async getAllProfiles(
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ rows: (ProfileRow & { studentName?: string })[]; total: number }> {
    const [countResult] = await this.pool.execute("SELECT COUNT(*) as c FROM profiles");
    const total = (countResult as { c: number }[])[0].c;
    const offset = (page - 1) * pageSize;
    const [rows] = await this.pool.execute(
      `SELECT p.*, s.name as student_name
       FROM profiles p LEFT JOIN students s ON p.student_id = s.student_id
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    return {
      rows: (rows as (ProfileRow & { student_name?: string })[]).map((r) => ({ ...r, studentName: r.student_name })),
      total,
    };
  }

  async deleteProfiles(studentIds: string[]): Promise<number> {
    if (studentIds.length === 0) return 0;
    const placeholders = studentIds.map(() => "?").join(",");
    const [result] = await this.pool.execute(`DELETE FROM profiles WHERE student_id IN (${placeholders})`, studentIds);
    return (result as mysql.ResultSetHeader).affectedRows;
  }

  async getAllProfilesRaw(): Promise<ProfileRow[]> {
    const [rows] = await this.pool.execute("SELECT * FROM profiles ORDER BY student_id");
    return rows as ProfileRow[];
  }

  async getStats(): Promise<Stats> {
    const [countResult] = await this.pool.execute("SELECT COUNT(*) as c FROM profiles");
    const total = (countResult as { c: number }[])[0].c;
    const today = getToday();
    const [todayResult] = await this.pool.execute(
      "SELECT COUNT(*) as c FROM profiles WHERE created_at >= ? AND created_at < ?",
      [today, new Date(new Date(today).getTime() + 86400000).toISOString().slice(0, 10)]
    );
    const todayCount = (todayResult as { c: number }[])[0].c;
    const [allRows] = await this.pool.execute("SELECT tags FROM profiles");
    const tagCount: Record<string, number> = {};
    for (const row of allRows as { tags: string }[]) {
      for (const tag of JSON.parse(row.tags)) tagCount[tag] = (tagCount[tag] || 0) + 1;
    }
    const uniqueTags = Object.keys(tagCount).length;
    const topTags = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count);
    return { total, today: todayCount, uniqueTags, topTags };
  }

  async getTrends(days: number): Promise<{ date: string; count: number }[]> {
    const since = new Date(Date.now() - days * 86400000)
      .toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const [rows] = await this.pool.execute(
      "SELECT DATE(created_at) as d, COUNT(*) as c FROM profiles WHERE created_at >= ? GROUP BY DATE(created_at) ORDER BY d",
      [since]
    );
    return (rows as { d: string; c: number }[]).map((r) => ({ date: r.d, count: r.c }));
  }

  async getCompareBy(by: "class" | "segment"): Promise<{ key: string; count: number }[]> {
    if (by === "class") {
      const [rows] = await this.pool.execute(
        `SELECT COALESCE(NULLIF(s.class_name, ''), '未分班') as k, COUNT(*) as c
         FROM profiles p JOIN students s ON p.student_id = s.student_id
         GROUP BY k ORDER BY k`
      );
      return (rows as { k: string; c: number }[]).map((r) => ({ key: r.k, count: r.c }));
    }
    const [rows] = await this.pool.execute(
      `SELECT LEFT(student_id, 4) as k, COUNT(*) as c FROM profiles GROUP BY k ORDER BY k`
    );
    return (rows as { k: string; c: number }[]).map((r) => ({ key: r.k, count: r.c }));
  }

  async updateStudentClass(studentId: string, className: string): Promise<void> {
    await this.pool.execute("UPDATE students SET class_name = ? WHERE student_id = ?", [className, studentId]);
  }

  async updateStudent(studentId: string, fields: { name?: string; className?: string }): Promise<void> {
    const sets: string[] = [];
    const values: string[] = [];
    if (fields.name !== undefined) { sets.push("name = ?"); values.push(fields.name); }
    if (fields.className !== undefined) { sets.push("class_name = ?"); values.push(fields.className); }
    if (sets.length === 0) return;
    values.push(studentId);
    await this.pool.execute(`UPDATE students SET ${sets.join(", ")} WHERE student_id = ?`, values);
  }

  async getClasses(): Promise<string[]> {
    const [rows] = await this.pool.execute(
      "SELECT DISTINCT class_name FROM students WHERE class_name != '' ORDER BY class_name"
    );
    return (rows as { class_name: string }[]).map((r) => r.class_name);
  }

  async backup(): Promise<BackupData> {
    const [students] = await this.pool.execute("SELECT * FROM students ORDER BY student_id");
    const [profiles] = await this.pool.execute("SELECT * FROM profiles ORDER BY student_id");
    return {
      version: 1,
      sourceType: "mysql",
      createdAt: new Date().toISOString(),
      students: students as StudentRow[],
      profiles: profiles as ProfileRow[],
    };
  }

  async restore(data: BackupData): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("DELETE FROM profiles");
      await conn.execute("DELETE FROM students");
      if (data.students.length > 0) {
        const values = data.students.map((s) => [s.student_id, s.name, s.class_name || "", s.created_at]);
        await conn.query(
          "INSERT INTO students (student_id, name, class_name, created_at) VALUES ?",
          [values]
        );
      }
      if (data.profiles.length > 0) {
        const values = data.profiles.map((p) => [p.student_id, p.tags, p.avatar_url, p.evaluation_url, p.created_at]);
        await conn.query(
          "INSERT INTO profiles (student_id, tags, avatar_url, evaluation_url, created_at) VALUES ?",
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
