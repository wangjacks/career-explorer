import Database from "better-sqlite3";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
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

/**
 * 校验 SQLite 数据库路径：解析后必须位于项目目录或系统临时目录内，防止路径穿越。
 */
export function sanitizeSqlitePath(input: string): string {
  const candidate = path.resolve(process.cwd(), input);
  const roots = [path.resolve(process.cwd()), path.resolve(tmpdir())];
  for (const root of roots) {
    const rel = path.relative(root, candidate);
    if (rel !== ".." && !rel.startsWith(`..${path.sep}`) && !path.isAbsolute(rel)) {
      return candidate;
    }
  }
  throw new Error("SQLite 路径必须位于项目目录或系统临时目录内");
}

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database;

  constructor(dbPath: string) {
    const safePath = sanitizeSqlitePath(dbPath);
    const dir = path.dirname(safePath);
    mkdirSync(dir, { recursive: true });
    this.db = new Database(safePath);
    this.db.pragma("journal_mode = WAL");
  }

  init(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        invitation_code TEXT NOT NULL UNIQUE,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_code TEXT NOT NULL UNIQUE,
        password_hash TEXT,
        role TEXT NOT NULL,
        name TEXT NOT NULL,
        class_id INTEGER REFERENCES classes(id),
        tags TEXT,
        avatar_url TEXT,
        evaluation_url TEXT,
        submitted_at TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_users_role ON users(role)`);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS teacher_classes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        teacher_id INTEGER NOT NULL REFERENCES users(id),
        class_id INTEGER NOT NULL REFERENCES classes(id),
        created_at TEXT DEFAULT (datetime('now', 'localtime')),
        UNIQUE(teacher_id, class_id)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        class_id INTEGER,
        category_order INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(name, class_id)
      )
    `);
    this.migrateLegacy();
    this.seedTags();
  }

  /** 预填充标签（INSERT OR IGNORE，重复执行安全；class_id=0 表示全局标签，避免 NULL 破坏 UNIQUE 约束） */
  private seedTags(): void {
    const stmt = this.db.prepare(
      `INSERT OR IGNORE INTO tags (name, category, class_id, category_order, sort_order)
       VALUES (?, ?, 0, ?, ?)`
    );
    const seed = this.db.transaction(() => {
      tagCategories.forEach((cat, ci) => {
        cat.tags.forEach((tag, ti) => stmt.run(tag, cat.name, ci, ti));
      });
    });
    seed();
  }

  /** 检测旧 students 表并迁移到 users 表 */
  private migrateLegacy(): void {
    const legacy = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='students'")
      .get();
    if (!legacy) return;

    const cols = this.db.prepare("PRAGMA table_info(students)").all() as { name: string }[];
    const hasClassName = cols.some((c) => c.name === "class_name");
    const students = this.db
      .prepare(
        hasClassName
          ? "SELECT student_id, name, class_name, created_at FROM students"
          : "SELECT student_id, name, '' as class_name, created_at FROM students"
      )
      .all() as LegacyStudent[];

    const hasProfiles = this.db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='profiles'")
      .get();
    const profiles = hasProfiles
      ? (this.db.prepare("SELECT * FROM profiles").all() as LegacyProfile[])
      : [];
    const profileMap = new Map(profiles.map((p) => [p.student_id, p]));

    // 迁移前必须先填充标签，才能做名称→ID 转换
    this.seedTags();
    const tagRows = this.db
      .prepare("SELECT id, name FROM tags WHERE class_id = 0")
      .all() as { id: number; name: string }[];
    const nameToId = new Map(tagRows.map((t) => [t.name, t.id]));

    const insertUser = this.db.prepare(
      `INSERT OR IGNORE INTO users (user_code, role, name, tags, avatar_url, evaluation_url, submitted_at, created_at)
       VALUES (?, 'student', ?, ?, ?, ?, ?, ?)`
    );
    const migrate = this.db.transaction(() => {
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
        insertUser.run(
          s.student_id,
          s.name,
          tagsJson,
          p?.avatar_url ?? null,
          p?.evaluation_url ?? null,
          p ? (p.created_at ?? getNow()) : null,
          s.created_at
        );
      }
      this.ensureAdminUser();
      if (hasProfiles) this.db.exec("DROP TABLE profiles");
      this.db.exec("DROP TABLE students");
    });
    migrate();
  }

  /** 从 admin-hash.txt 迁移管理员密码到 users 表（文件不存在则跳过） */
  private ensureAdminUser(): void {
    const existing = this.db.prepare("SELECT id FROM users WHERE role = 'admin' LIMIT 1").get();
    if (existing) return;
    if (!existsSync(ADMIN_HASH_PATH)) return;
    const hash = readFileSync(ADMIN_HASH_PATH, "utf-8").trim();
    if (!hash) return;
    this.db
      .prepare(
        `INSERT OR IGNORE INTO users (user_code, password_hash, role, name, created_at)
         VALUES ('10001', ?, 'admin', '管理员', ?)`
      )
      .run(hash, getNow());
  }

  // users
  insertUser(user: NewUser): number {
    const result = this.db
      .prepare(
        `INSERT INTO users (user_code, password_hash, role, name, class_id, created_at)
         VALUES (?, ?, ?, ?, ?, ?)`
      )
      .run(
        user.user_code,
        user.password_hash ?? null,
        user.role,
        user.name,
        user.class_id ?? null,
        getNow()
      );
    return Number(result.lastInsertRowid);
  }

  getUserByCode(userCode: string): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE user_code = ?").get(userCode) as
      | UserRow
      | undefined;
  }

  getAdminUser(): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE role = 'admin' LIMIT 1").get() as
      | UserRow
      | undefined;
  }

  updateUser(id: number, fields: UserUpdateFields): void {
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
    this.db.prepare(`UPDATE users SET ${sets.join(", ")} WHERE id = ?`).run(...values);
  }

  deleteStudents(userCodes: string[]): number {
    if (userCodes.length === 0) return 0;
    const placeholders = userCodes.map(() => "?").join(",");
    const result = this.db
      .prepare(`DELETE FROM users WHERE role = 'student' AND user_code IN (${placeholders})`)
      .run(...userCodes);
    return result.changes;
  }

  getStudents(): UserRow[] {
    return this.db.prepare("SELECT * FROM users WHERE role = 'student' ORDER BY id").all() as UserRow[];
  }

  getStudentByCode(userCode: string): UserRow | undefined {
    return this.db
      .prepare("SELECT * FROM users WHERE role = 'student' AND user_code = ?")
      .get(userCode) as UserRow | undefined;
  }

  // submissions
  upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string): void {
    this.db
      .prepare(
        `UPDATE users SET tags = ?, avatar_url = ?, evaluation_url = ?, submitted_at = ?
         WHERE role = 'student' AND user_code = ?`
      )
      .run(tagsJson, avatarUrl, evaluationUrl, getNow(), userCode);
  }

  getSubmittedProfiles(page: number = 1, pageSize: number = 20): { rows: UserRow[]; total: number } {
    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'student' AND submitted_at IS NOT NULL").get() as { c: number }
    ).c;
    const offset = (page - 1) * pageSize;
    const rows = this.db
      .prepare(
        `SELECT * FROM users WHERE role = 'student' AND submitted_at IS NOT NULL
         ORDER BY submitted_at DESC LIMIT ? OFFSET ?`
      )
      .all(pageSize, offset) as UserRow[];
    return { rows, total };
  }

  getAllSubmitted(): UserRow[] {
    return this.db
      .prepare(
        `SELECT * FROM users WHERE role = 'student' AND submitted_at IS NOT NULL
         ORDER BY user_code`
      )
      .all() as UserRow[];
  }

  clearSubmissions(userCodes: string[]): number {
    if (userCodes.length === 0) return 0;
    const placeholders = userCodes.map(() => "?").join(",");
    const result = this.db
      .prepare(
        `UPDATE users SET tags = NULL, avatar_url = NULL, evaluation_url = NULL, submitted_at = NULL
         WHERE role = 'student' AND user_code IN (${placeholders})`
      )
      .run(...userCodes);
    return result.changes;
  }

  // stats
  getStats(): Stats {
    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM users WHERE role = 'student' AND submitted_at IS NOT NULL").get() as { c: number }
    ).c;
    const today = getToday();
    const tomorrow = new Date(new Date(today).getTime() + 86400000).toISOString().slice(0, 10);
    const todayCount = (
      this.db
        .prepare(
          `SELECT COUNT(*) as c FROM users
           WHERE role = 'student' AND submitted_at >= ? AND submitted_at < ?`
        )
        .get(today, tomorrow) as { c: number }
    ).c;
    const idToName = new Map(
      (this.db.prepare("SELECT id, name FROM tags").all() as { id: number; name: string }[]).map(
        (t) => [t.id, t.name]
      )
    );
    const allRows = this.db
      .prepare("SELECT tags FROM users WHERE role = 'student' AND submitted_at IS NOT NULL AND tags IS NOT NULL")
      .all() as { tags: string }[];
    const tagCount: Record<string, number> = {};
    for (const row of allRows) {
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

  getTrends(days: number): { date: string; count: number }[] {
    const since = new Date(Date.now() - days * 86400000).toLocaleDateString("sv-SE", {
      timeZone: "Asia/Shanghai",
    });
    const rows = this.db
      .prepare(
        `SELECT DATE(submitted_at) as d, COUNT(*) as c FROM users
         WHERE role = 'student' AND submitted_at >= ?
         GROUP BY DATE(submitted_at) ORDER BY d`
      )
      .all(since) as { d: string; c: number }[];
    return rows.map((r) => ({ date: r.d, count: r.c }));
  }

  getCompareBy(by: "class" | "segment"): { key: string; count: number }[] {
    if (by === "class") {
      const rows = this.db
        .prepare(
          `SELECT COALESCE(c.name, '未分班') as k, COUNT(*) as c
           FROM users u LEFT JOIN classes c ON u.class_id = c.id
           WHERE u.role = 'student' AND u.submitted_at IS NOT NULL
           GROUP BY k ORDER BY k`
        )
        .all() as { k: string; c: number }[];
      return rows.map((r) => ({ key: r.k, count: r.c }));
    }
    const rows = this.db
      .prepare(
        `SELECT SUBSTR(user_code, 1, 4) as k, COUNT(*) as c FROM users
         WHERE role = 'student' AND submitted_at IS NOT NULL
         GROUP BY k ORDER BY k`
      )
      .all() as { k: string; c: number }[];
    return rows.map((r) => ({ key: r.k, count: r.c }));
  }

  // tags & classes
  getTags(): TagRow[] {
    return this.db
      .prepare("SELECT * FROM tags ORDER BY category_order, sort_order, id")
      .all() as TagRow[];
  }

  getClasses(): ClassRow[] {
    return this.db.prepare("SELECT * FROM classes ORDER BY id").all() as ClassRow[];
  }

  getClassByName(name: string): ClassRow | undefined {
    return this.db.prepare("SELECT * FROM classes WHERE name = ?").get(name) as ClassRow | undefined;
  }

  getClassByInviteCode(code: string): ClassRow | undefined {
    return this.db.prepare("SELECT * FROM classes WHERE invitation_code = ?").get(code) as ClassRow | undefined;
  }

  insertClass(name: string, invitationCode: string): number {
    const result = this.db
      .prepare("INSERT INTO classes (name, invitation_code, created_at) VALUES (?, ?, ?)")
      .run(name, invitationCode, getNow());
    return Number(result.lastInsertRowid);
  }

  backup(): BackupData {
    const users = this.db.prepare("SELECT * FROM users ORDER BY id").all() as UserRow[];
    const classes = this.db.prepare("SELECT * FROM classes ORDER BY id").all() as ClassRow[];
    const teacherClasses = this.db.prepare("SELECT * FROM teacher_classes ORDER BY id").all() as BackupData["teacher_classes"];
    const tags = this.db.prepare("SELECT * FROM tags ORDER BY id").all() as TagRow[];
    return {
      version: 2,
      sourceType: "sqlite",
      createdAt: new Date().toISOString(),
      users,
      classes,
      teacher_classes: teacherClasses,
      tags,
    };
  }

  restore(data: BackupData): void {
    const restoreTx = this.db.transaction((d: BackupData) => {
      this.db.exec("DELETE FROM teacher_classes");
      this.db.exec("DELETE FROM users");
      this.db.exec("DELETE FROM classes");
      this.db.exec("DELETE FROM tags");
      if (d.tags.length > 0) {
        const stmt = this.db.prepare(
          "INSERT INTO tags (id, name, category, class_id, category_order, sort_order) VALUES (?, ?, ?, ?, ?, ?)"
        );
        for (const t of d.tags) stmt.run(t.id, t.name, t.category, t.class_id, t.category_order, t.sort_order);
      }
      if (d.classes.length > 0) {
        const stmt = this.db.prepare(
          "INSERT INTO classes (id, name, invitation_code, created_at) VALUES (?, ?, ?, ?)"
        );
        for (const c of d.classes) stmt.run(c.id, c.name, c.invitation_code, c.created_at);
      }
      if (d.users.length > 0) {
        const stmt = this.db.prepare(
          `INSERT INTO users (id, user_code, password_hash, role, name, class_id, tags, avatar_url, evaluation_url, submitted_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const u of d.users) {
          stmt.run(
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
            u.created_at
          );
        }
      }
      if (d.teacher_classes.length > 0) {
        const stmt = this.db.prepare(
          "INSERT INTO teacher_classes (id, teacher_id, class_id, created_at) VALUES (?, ?, ?, ?)"
        );
        for (const tc of d.teacher_classes) stmt.run(tc.id, tc.teacher_id, tc.class_id, tc.created_at);
      }
    });
    restoreTx(data);
  }

  close(): void {
    this.db.close();
  }
}
