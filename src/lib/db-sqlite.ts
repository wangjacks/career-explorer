import Database from "better-sqlite3";
import { mkdirSync } from "fs";
import path from "path";
import type { ProfileRow, StudentRow, Stats, DbAdapter, BackupData } from "./db";

function getNow(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function getToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database;

  constructor(dbPath: string) {
    const dir = path.dirname(dbPath);
    mkdirSync(dir, { recursive: true });
    this.db = new Database(dbPath);
    this.db.pragma("journal_mode = WAL");
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS students (
        student_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        class_name TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        student_id TEXT PRIMARY KEY,
        tags TEXT NOT NULL,
        avatar_url TEXT,
        evaluation_url TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_profiles_created_at ON profiles(created_at)`);
  }

  // Students
  insertStudent(studentId: string, name: string, className: string = ""): void {
    this.db.prepare(
      `INSERT OR REPLACE INTO students (student_id, name, class_name, created_at)
       VALUES (?, ?, ?, COALESCE((SELECT created_at FROM students WHERE student_id = ?), ?))`
    ).run(studentId, name, className, studentId, getNow());
  }

  insertStudentsBatch(students: { studentId: string; name: string; className?: string }[]): void {
    if (students.length === 0) return;
    const now = getNow();
    const stmt = this.db.prepare(
      `INSERT OR REPLACE INTO students (student_id, name, class_name, created_at)
       VALUES (?, ?, ?, COALESCE((SELECT created_at FROM students WHERE student_id = ?), ?))`
    );
    const insertMany = this.db.transaction((items: typeof students) => {
      for (const s of items) {
        stmt.run(s.studentId, s.name, s.className || "", s.studentId, now);
      }
    });
    insertMany(students);
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
    this.db.prepare(
      `INSERT OR REPLACE INTO profiles (student_id, tags, avatar_url, evaluation_url, created_at)
       VALUES (?, ?, ?, ?, COALESCE((SELECT created_at FROM profiles WHERE student_id = ?), ?))`
    ).run(studentId, JSON.stringify(tags), avatarUrl, evaluationUrl, studentId, getNow());
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
    const rows = this.db.prepare(
      `SELECT p.*, s.name as student_name
       FROM profiles p LEFT JOIN students s ON p.student_id = s.student_id
       ORDER BY p.created_at DESC LIMIT ? OFFSET ?`
    ).all(pageSize, offset) as (ProfileRow & { student_name?: string })[];
    return {
      rows: rows.map((r) => ({ ...r, studentName: r.student_name })),
      total,
    };
  }

  deleteProfiles(studentIds: string[]): number {
    if (studentIds.length === 0) return 0;
    const placeholders = studentIds.map(() => "?").join(",");
    const result = this.db.prepare(`DELETE FROM profiles WHERE student_id IN (${placeholders})`).run(...studentIds);
    return result.changes;
  }

  getAllProfilesRaw(): ProfileRow[] {
    return this.db.prepare("SELECT * FROM profiles ORDER BY student_id").all() as ProfileRow[];
  }

  getStats(): Stats {
    const total = (this.db.prepare("SELECT COUNT(*) as c FROM profiles").get() as { c: number }).c;
    const today = getToday();
    const tomorrow = new Date(new Date(today).getTime() + 86400000).toISOString().slice(0, 10);
    const todayCount = (
      this.db.prepare("SELECT COUNT(*) as c FROM profiles WHERE created_at >= ? AND created_at < ?").get(today, tomorrow) as { c: number }
    ).c;
    const allRows = this.db.prepare("SELECT tags FROM profiles").all() as { tags: string }[];
    const tagCount: Record<string, number> = {};
    for (const row of allRows) {
      for (const tag of JSON.parse(row.tags)) tagCount[tag] = (tagCount[tag] || 0) + 1;
    }
    const uniqueTags = Object.keys(tagCount).length;
    const topTags = Object.entries(tagCount)
      .map(([tag, count]) => ({ tag, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 5);
    return { total, today: todayCount, uniqueTags, topTags };
  }

  getTrends(days: number): { date: string; count: number }[] {
    const since = new Date(Date.now() - days * 86400000)
      .toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
    const rows = this.db.prepare(
      `SELECT DATE(created_at) as d, COUNT(*) as c FROM profiles WHERE created_at >= ? GROUP BY DATE(created_at) ORDER BY d`
    ).all(since) as { d: string; c: number }[];
    return rows.map((r) => ({ date: r.d, count: r.c }));
  }

  getCompareBy(by: "class" | "segment"): { key: string; count: number }[] {
    if (by === "class") {
      const rows = this.db.prepare(
        `SELECT COALESCE(NULLIF(s.class_name, ''), '未分班') as k, COUNT(*) as c
         FROM profiles p JOIN students s ON p.student_id = s.student_id
         GROUP BY k ORDER BY k`
      ).all() as { k: string; c: number }[];
      return rows.map((r) => ({ key: r.k, count: r.c }));
    }
    const rows = this.db.prepare(
      `SELECT SUBSTR(student_id, 1, 4) as k, COUNT(*) as c FROM profiles GROUP BY k ORDER BY k`
    ).all() as { k: string; c: number }[];
    return rows.map((r) => ({ key: r.k, count: r.c }));
  }

  updateStudentClass(studentId: string, className: string): void {
    this.db.prepare("UPDATE students SET class_name = ? WHERE student_id = ?").run(className, studentId);
  }

  getClasses(): string[] {
    const rows = this.db.prepare(
      "SELECT DISTINCT class_name FROM students WHERE class_name != '' ORDER BY class_name"
    ).all() as { class_name: string }[];
    return rows.map((r) => r.class_name);
  }

  backup(): BackupData {
    const students = this.db.prepare("SELECT * FROM students ORDER BY student_id").all() as StudentRow[];
    const profiles = this.db.prepare("SELECT * FROM profiles ORDER BY student_id").all() as ProfileRow[];
    return {
      version: 1,
      sourceType: "sqlite",
      createdAt: new Date().toISOString(),
      students,
      profiles,
    };
  }

  restore(data: BackupData): void {
    const restoreTx = this.db.transaction((d: BackupData) => {
      this.db.exec("DELETE FROM profiles");
      this.db.exec("DELETE FROM students");
      if (d.students.length > 0) {
        const stmt = this.db.prepare(
          "INSERT INTO students (student_id, name, class_name, created_at) VALUES (?, ?, ?, ?)"
        );
        for (const s of d.students) {
          stmt.run(s.student_id, s.name, s.class_name || "", s.created_at);
        }
      }
      if (d.profiles.length > 0) {
        const stmt = this.db.prepare(
          "INSERT INTO profiles (student_id, tags, avatar_url, evaluation_url, created_at) VALUES (?, ?, ?, ?, ?)"
        );
        for (const p of d.profiles) {
          stmt.run(p.student_id, p.tags, p.avatar_url, p.evaluation_url, p.created_at);
        }
      }
    });
    restoreTx(data);
  }

  close(): void {
    this.db.close();
  }
}
