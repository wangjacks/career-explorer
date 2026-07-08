import Database from "better-sqlite3";
import path from "path";
import type { ProfileRow, StudentRow, Stats, DbAdapter } from "./db";

const DB_PATH = path.join(process.cwd(), "data.db");

function getNow(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function getToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        student_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        student_id TEXT PRIMARY KEY,
        tags TEXT NOT NULL,
        avatar_url TEXT,
        evaluation_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    try { this.db.exec("ALTER TABLE profiles ADD COLUMN evaluation_url TEXT"); } catch {}
  }

  // Students
  insertStudent(studentId: string, name: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO students (student_id, name, created_at) VALUES (?, ?, ?)")
      .run(studentId, name, getNow());
  }

  insertStudentsBatch(students: { studentId: string; name: string }[]): void {
    const now = getNow();
    const stmt = this.db.prepare("INSERT OR REPLACE INTO students (student_id, name, created_at) VALUES (?, ?, ?)");
    const tx = this.db.transaction((items: { studentId: string; name: string }[]) => {
      for (const s of items) stmt.run(s.studentId, s.name, now);
    });
    tx(students);
  }

  getStudent(studentId: string): StudentRow | undefined {
    return this.db.prepare("SELECT * FROM students WHERE student_id = ?").get(studentId) as StudentRow | undefined;
  }

  getAllStudents(): StudentRow[] {
    return this.db.prepare("SELECT * FROM students ORDER BY student_id").all() as StudentRow[];
  }

  deleteStudents(ids: string[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const result = this.db.prepare(`DELETE FROM students WHERE student_id IN (${placeholders})`).run(...ids);
    return result.changes;
  }

  // Profiles
  insertProfile(studentId: string, tags: string[], avatarUrl: string, evaluationUrl: string): void {
    this.db
      .prepare("INSERT OR REPLACE INTO profiles (student_id, tags, avatar_url, evaluation_url, created_at) VALUES (?, ?, ?, ?, ?)")
      .run(studentId, JSON.stringify(tags), avatarUrl, evaluationUrl, getNow());
  }

  getProfile(studentId: string): ProfileRow | undefined {
    return this.db.prepare("SELECT * FROM profiles WHERE student_id = ?").get(studentId) as ProfileRow | undefined;
  }

  getAllProfiles(
    page: number = 1,
    pageSize: number = 20
  ): { rows: (ProfileRow & { studentName?: string })[]; total: number } {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM profiles").get() as { c: number }).c;
    const offset = (page - 1) * pageSize;
    const rows = this.db
      .prepare(`
        SELECT p.*, s.name as student_name
        FROM profiles p
        LEFT JOIN students s ON p.student_id = s.student_id
        ORDER BY p.created_at DESC
        LIMIT ? OFFSET ?
      `)
      .all(pageSize, offset) as (ProfileRow & { student_name?: string })[];
    return {
      rows: rows.map((r) => ({ ...r, studentName: r.student_name })),
      total,
    };
  }

  deleteProfiles(studentIds: string[]): number {
    if (studentIds.length === 0) return 0;
    const placeholders = studentIds.map(() => "?").join(",");
    const result = this.db
      .prepare(`DELETE FROM profiles WHERE student_id IN (${placeholders})`)
      .run(...studentIds);
    return result.changes;
  }

  getAllProfilesRaw(): ProfileRow[] {
    return this.db.prepare("SELECT * FROM profiles ORDER BY student_id").all() as ProfileRow[];
  }

  getStats(): Stats {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM profiles").get() as { c: number }).c;

    const today = (
      this.db
        .prepare("SELECT COUNT(*) as c FROM profiles WHERE date(created_at) = ?")
        .get(getToday()) as { c: number }
    ).c;

    const allRows = this.db.prepare("SELECT tags FROM profiles").all() as { tags: string }[];
    const tagCount: Record<string, number> = {};
    for (const row of allRows) {
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

  close(): void {
    this.db.close();
  }
}
