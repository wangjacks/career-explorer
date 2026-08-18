import Database from "better-sqlite3";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { tagCategories } from "./tagData";
import { normalizeBackupTags } from "./db";
import type {
  UserRow,
  TagRow,
  ClassRow,
  TeacherClassRow,
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
        type TEXT NOT NULL,
        parent_id INTEGER,
        class_id INTEGER NOT NULL DEFAULT 0,
        category_order INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        active INTEGER NOT NULL DEFAULT 1
      )
    `);
    this.migrateTagSchema();
    this.seedTags();
    this.migrateLegacy();
  }

  /** 将旧 category 文本迁移为分类记录和 parent_id 层级。 */
  private migrateTagSchema(): void {
    const columns = this.db.prepare("PRAGMA table_info(tags)").all() as { name: string }[];
    const names = new Set(columns.map((column) => column.name));
    if (!names.has("type")) {
      this.db.exec("ALTER TABLE tags ADD COLUMN type TEXT NOT NULL DEFAULT 'tag'");
    }
    if (!names.has("parent_id")) {
      this.db.exec("ALTER TABLE tags ADD COLUMN parent_id INTEGER");
    }
    if (!names.has("active")) {
      this.db.exec("ALTER TABLE tags ADD COLUMN active INTEGER NOT NULL DEFAULT 1");
    }
    this.db.exec("UPDATE tags SET class_id = 0 WHERE class_id IS NULL");
    if (!names.has("category")) {
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_parent_class ON tags(name, parent_id, class_id)");
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_category_name_class ON tags(name, type, class_id)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id)");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_tags_order ON tags(category_order, sort_order)");
      return;
    }

    const legacyCategories = this.db
      .prepare(
        `SELECT category as name, MIN(category_order) as category_order
         FROM tags WHERE class_id = 0 GROUP BY category`
      )
      .all() as { name: string; category_order: number }[];
    const insertCategory = this.db.prepare(
      `INSERT OR IGNORE INTO tags (name, category, type, parent_id, class_id, category_order, sort_order, active)
       VALUES (?, ?, 'category', NULL, 0, ?, 0, 1)`
    );
    const updateTag = this.db.prepare(
      `UPDATE tags SET type = 'tag', parent_id = ?, active = 1
       WHERE category = ? AND class_id = 0 AND type = 'tag'`
    );
    const migrate = this.db.transaction(() => {
      for (const category of legacyCategories) {
        insertCategory.run(category.name, category.name, category.category_order);
        const parent = this.db
          .prepare("SELECT id FROM tags WHERE name = ? AND type = 'category' AND class_id = 0")
          .get(category.name) as { id: number } | undefined;
        if (parent) updateTag.run(parent.id, category.name);
      }
    });
    migrate();
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_name_parent_class ON tags(name, parent_id, class_id)");
    this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_tags_category_name_class ON tags(name, type, class_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tags_parent ON tags(parent_id)");
    this.db.exec("CREATE INDEX IF NOT EXISTS idx_tags_order ON tags(category_order, sort_order)");
  }

  /** 预填充标签（INSERT OR IGNORE，重复执行安全；class_id=0 表示全局标签） */
  private seedTags(): void {
    const columns = this.db.prepare("PRAGMA table_info(tags)").all() as { name: string }[];
    const hasLegacyCategory = columns.some((column) => column.name === "category");
    const insertCategory = this.db.prepare(hasLegacyCategory
      ? `INSERT OR IGNORE INTO tags (name, category, type, parent_id, class_id, category_order, sort_order, active)
         VALUES (?, ?, 'category', NULL, 0, ?, 0, 1)`
      : `INSERT OR IGNORE INTO tags (name, type, parent_id, class_id, category_order, sort_order, active)
         VALUES (?, 'category', NULL, 0, ?, 0, 1)`);
    const insertTag = this.db.prepare(hasLegacyCategory
      ? `INSERT OR IGNORE INTO tags (name, category, type, parent_id, class_id, category_order, sort_order, active)
         VALUES (?, ?, 'tag', ?, 0, ?, ?, 1)`
      : `INSERT OR IGNORE INTO tags (name, type, parent_id, class_id, category_order, sort_order, active)
         VALUES (?, 'tag', ?, 0, ?, ?, 1)`);
    const seed = this.db.transaction(() => {
      tagCategories.forEach((cat, ci) => {
        if (hasLegacyCategory) insertCategory.run(cat.name, cat.name, ci);
        else insertCategory.run(cat.name, ci);
        const parent = this.db
          .prepare("SELECT id FROM tags WHERE name = ? AND type = 'category' AND class_id = 0")
          .get(cat.name) as { id: number } | undefined;
        if (!parent) return;
        cat.tags.forEach((tag, ti) => {
          if (hasLegacyCategory) insertTag.run(tag, cat.name, parent.id, ci, ti);
          else insertTag.run(tag, parent.id, ci, ti);
        });
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
      .prepare(
        `SELECT id, name, type, parent_id, class_id, category_order, sort_order, active
         FROM tags WHERE class_id = 0 ORDER BY category_order, type DESC, sort_order, id`
      )
      .all() as TagRow[];
  }

  getActiveTags(): TagRow[] {
    return this.db
      .prepare(
        `SELECT t.id, t.name, t.type, t.parent_id, t.class_id, t.category_order, t.sort_order, t.active
         FROM tags t
         LEFT JOIN tags p ON p.id = t.parent_id
         WHERE t.class_id = 0 AND t.active = 1
           AND (t.type = 'category' OR (p.active = 1 AND p.type = 'category'))
         ORDER BY t.category_order, CASE WHEN t.type = 'category' THEN 0 ELSE 1 END, t.sort_order, t.id`
      )
      .all() as TagRow[];
  }

  insertTag(tag: {
    name: string;
    type: "category" | "tag";
    parent_id?: number | null;
    category_order?: number;
    sort_order?: number;
  }): number {
    const result = this.db
      .prepare(
        `INSERT INTO tags (name, type, parent_id, class_id, category_order, sort_order, active)
         VALUES (?, ?, ?, 0, ?, ?, 1)`
      )
      .run(
        tag.name,
        tag.type,
        tag.type === "category" ? null : tag.parent_id ?? null,
        tag.category_order ?? 0,
        tag.sort_order ?? 0
      );
    return Number(result.lastInsertRowid);
  }

  updateTag(id: number, fields: {
    name?: string;
    parent_id?: number | null;
    category_order?: number;
    sort_order?: number;
  }): void {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    if (fields.name !== undefined) { assignments.push("name = ?"); values.push(fields.name); }
    if (fields.parent_id !== undefined) { assignments.push("parent_id = ?"); values.push(fields.parent_id); }
    if (fields.category_order !== undefined) { assignments.push("category_order = ?"); values.push(fields.category_order); }
    if (fields.sort_order !== undefined) { assignments.push("sort_order = ?"); values.push(fields.sort_order); }
    if (assignments.length === 0) return;
    values.push(id);
    this.db.prepare(`UPDATE tags SET ${assignments.join(", ")} WHERE id = ?`).run(...values);
  }

  setTagActive(id: number, active: boolean): void {
    const update = this.db.transaction(() => {
      const tag = this.db.prepare("SELECT type FROM tags WHERE id = ?").get(id) as { type: string } | undefined;
      if (!tag) throw new Error("标签不存在");
      this.db.prepare("UPDATE tags SET active = ? WHERE id = ?").run(active ? 1 : 0, id);
      if (tag.type === "category") {
        this.db.prepare("UPDATE tags SET active = ? WHERE parent_id = ?").run(active ? 1 : 0, id);
      }
    });
    update();
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

  updateClass(id: number, fields: { name?: string; invitation_code?: string }): void {
    const sets: string[] = [];
    const params: (string | number)[] = [];
    if (fields.name !== undefined) {
      sets.push("name = ?");
      params.push(fields.name);
    }
    if (fields.invitation_code !== undefined) {
      sets.push("invitation_code = ?");
      params.push(fields.invitation_code);
    }
    if (sets.length === 0) return;
    this.db.prepare(`UPDATE classes SET ${sets.join(", ")} WHERE id = ?`).run(...params, id);
  }

  deleteClass(id: number): void {
    // 外键级联不可依赖（未启用 PRAGMA foreign_keys），事务内显式清理关联数据
    const tx = this.db.transaction((classId: number) => {
      this.db.prepare("UPDATE users SET class_id = NULL WHERE class_id = ?").run(classId);
      this.db.prepare("DELETE FROM teacher_classes WHERE class_id = ?").run(classId);
      this.db.prepare("DELETE FROM classes WHERE id = ?").run(classId);
    });
    tx(id);
  }

  insertTeacherClass(teacherId: number, classId: number): void {
    this.db
      .prepare("INSERT INTO teacher_classes (teacher_id, class_id, created_at) VALUES (?, ?, ?)")
      .run(teacherId, classId, getNow());
  }

  getTeacherClassPairs(): TeacherClassRow[] {
    return this.db.prepare("SELECT * FROM teacher_classes ORDER BY id").all() as TeacherClassRow[];
  }

  getTeachers(): UserRow[] {
    return this.db.prepare("SELECT * FROM users WHERE role = 'teacher' ORDER BY id").all() as UserRow[];
  }

  deleteTeacher(id: number): void {
    const tx = this.db.transaction((teacherId: number) => {
      this.db.prepare("DELETE FROM teacher_classes WHERE teacher_id = ?").run(teacherId);
      this.db.prepare("DELETE FROM users WHERE id = ?").run(teacherId);
    });
    tx(id);
  }

  backup(): BackupData {
    const users = this.db.prepare("SELECT * FROM users ORDER BY id").all() as UserRow[];
    const classes = this.db.prepare("SELECT * FROM classes ORDER BY id").all() as ClassRow[];
    const teacherClasses = this.db.prepare("SELECT * FROM teacher_classes ORDER BY id").all() as BackupData["teacher_classes"];
    const tags = this.db
      .prepare(
        `SELECT id, name, type, parent_id, class_id, category_order, sort_order, active
         FROM tags ORDER BY id`
      )
      .all() as TagRow[];
    return {
      version: 3,
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
      const tags = normalizeBackupTags(d.tags);
      this.db.exec("DELETE FROM teacher_classes");
      this.db.exec("DELETE FROM users");
      this.db.exec("DELETE FROM classes");
      this.db.exec("DELETE FROM tags");
      if (tags.length > 0) {
        const stmt = this.db.prepare(
          `INSERT INTO tags (id, name, type, parent_id, class_id, category_order, sort_order, active)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const t of tags) {
          stmt.run(
            t.id,
            t.name,
            t.type ?? "tag",
            t.parent_id ?? null,
            t.class_id ?? 0,
            t.category_order ?? 0,
            t.sort_order ?? 0,
            t.active ?? 1
          );
        }
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
