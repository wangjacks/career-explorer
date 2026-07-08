import mysql from "mysql2/promise";
import type { ProfileRow, StudentRow, Stats, DbAdapter } from "./db";

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
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  // Students
  async insertStudent(studentId: string, name: string): Promise<void> {
    await this.pool.execute(
      "INSERT INTO students (student_id, name, created_at) VALUES (?, ?, ?) ON DUPLICATE KEY UPDATE name = VALUES(name), created_at = VALUES(created_at)",
      [studentId, name, getNow()]
    );
  }

  async insertStudentsBatch(students: { studentId: string; name: string }[]): Promise<void> {
    if (students.length === 0) return;
    const now = getNow();
    const values = students.map((s) => [s.studentId, s.name, now]);
    await this.pool.query(
      "INSERT INTO students (student_id, name, created_at) VALUES ? ON DUPLICATE KEY UPDATE name = VALUES(name), created_at = VALUES(created_at)",
      [values]
    );
  }

  async getStudent(studentId: string): Promise<StudentRow | undefined> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM students WHERE student_id = ?",
      [studentId]
    );
    return (rows as StudentRow[])[0];
  }

  async getAllStudents(): Promise<StudentRow[]> {
    const [rows] = await this.pool.execute("SELECT * FROM students ORDER BY student_id");
    return rows as StudentRow[];
  }

  async deleteStudents(ids: string[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const [result] = await this.pool.execute(
      `DELETE FROM students WHERE student_id IN (${placeholders})`,
      ids
    );
    return (result as mysql.ResultSetHeader).affectedRows;
  }

  // Profiles
  async insertProfile(studentId: string, tags: string[], avatarUrl: string): Promise<void> {
    await this.pool.execute(
      "INSERT INTO profiles (student_id, tags, avatar_url, created_at) VALUES (?, ?, ?, ?) ON DUPLICATE KEY UPDATE tags = VALUES(tags), avatar_url = VALUES(avatar_url), created_at = VALUES(created_at)",
      [studentId, JSON.stringify(tags), avatarUrl, getNow()]
    );
  }

  async getProfile(studentId: string): Promise<ProfileRow | undefined> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM profiles WHERE student_id = ?",
      [studentId]
    );
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
       FROM profiles p
       LEFT JOIN students s ON p.student_id = s.student_id
       ORDER BY p.created_at DESC
       LIMIT ? OFFSET ?`,
      [pageSize, offset]
    );
    return {
      rows: (rows as (ProfileRow & { student_name?: string })[]).map((r) => ({
        ...r,
        studentName: r.student_name,
      })),
      total,
    };
  }

  async deleteProfiles(studentIds: string[]): Promise<number> {
    if (studentIds.length === 0) return 0;
    const placeholders = studentIds.map(() => "?").join(",");
    const [result] = await this.pool.execute(
      `DELETE FROM profiles WHERE student_id IN (${placeholders})`,
      studentIds
    );
    return (result as mysql.ResultSetHeader).affectedRows;
  }

  async getAllProfilesRaw(): Promise<ProfileRow[]> {
    const [rows] = await this.pool.execute("SELECT * FROM profiles ORDER BY student_id");
    return rows as ProfileRow[];
  }

  async getStats(): Promise<Stats> {
    const [countResult] = await this.pool.execute("SELECT COUNT(*) as c FROM profiles");
    const total = (countResult as { c: number }[])[0].c;

    const [todayResult] = await this.pool.execute(
      "SELECT COUNT(*) as c FROM profiles WHERE DATE(created_at) = ?",
      [getToday()]
    );
    const today = (todayResult as { c: number }[])[0].c;

    const [allRows] = await this.pool.execute("SELECT tags FROM profiles");
    const tagCount: Record<string, number> = {};
    for (const row of allRows as { tags: string }[]) {
      const parsed: string[] = JSON.parse(row.tags);
      for (const tag of parsed) {
        tagCount[tag] = (tagCount[tag] || 0) + 1;
      }
    }
    const uniqueTags = Object.keys(tagCount).length;
    const topTags = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);

    return { total, today, uniqueTags, topTags };
  }

  async close(): Promise<void> {
    await this.pool.end();
  }
}
