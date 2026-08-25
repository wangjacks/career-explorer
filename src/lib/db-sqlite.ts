import Database from "better-sqlite3";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { tagCategories } from "./tagData";
import { normalizeBackupTags, DEFAULT_MAX_CUSTOM_TAGS, DEFAULT_MAX_PROFILE_SUBMISSIONS, MAX_PROFILE_SUBMISSIONS_KEY } from "./db";
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
  ConfigRow,
  AuditLogRow,
  NewAuditLog,
  AuditLogFilters,
  StorageBackendRow,
  NewStorageBackend,
  StorageBackendUpdateFields,
  ProfileSubmissionRow,
  ProfileSubmissionData,
  ProfileSubmissionExceedRow,
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
 * 采用 resolve + 前缀比较 guard 模式（CodeQL path-injection 可识别的 sanitizer）。
 */
export function sanitizeSqlitePath(input: string): string {
  // 动态路径校验需运行时解析（防穿越），豁免 Turbopack 静态追踪
  const candidate = path.resolve(/*turbopackIgnore: true*/ process.cwd(), input);
  const roots = [
    path.resolve(/*turbopackIgnore: true*/ process.cwd()),
    path.resolve(/*turbopackIgnore: true*/ tmpdir()),
  ];
  const withinRoot = roots.some((root) => candidate === root || candidate.startsWith(root + path.sep));
  if (!withinRoot) {
    throw new Error("SQLite 路径必须位于项目目录或系统临时目录内");
  }
  return candidate;
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
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS configs_profile (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        key TEXT NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    // 默认配置幂等写入（已存在则不覆盖）
    this.db
      .prepare("INSERT OR IGNORE INTO configs_profile (key, value, updated_at) VALUES (?, ?, ?)")
      .run("max_custom_tags", String(DEFAULT_MAX_CUSTOM_TAGS), getNow());
    // 操作审计日志（#110）：只追加 + 查询，操作者字段快照冗余，追溯不依赖外键（账号可被删改）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        created_at TEXT NOT NULL,
        actor_id INTEGER,
        actor_user_code TEXT,
        actor_name TEXT,
        actor_role TEXT,
        action TEXT NOT NULL,
        method TEXT,
        path TEXT,
        resource_type TEXT,
        resource_id TEXT,
        status TEXT NOT NULL,
        error_message TEXT,
        ip TEXT,
        user_agent TEXT,
        metadata TEXT
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_created_at ON audit_logs(created_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_audit_actor_id ON audit_logs(actor_id)`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_audit_resource ON audit_logs(resource_type, resource_id)`
    );
    this.migrateStorageSchema();
    this.migrateTagSchema();
    this.seedTags();
    this.migrateLegacy();
    this.migrateProfileSubmissions();
  }

  /**
   * 对象存储多后端注册表（#111）：
   * 1) storage_backends 表 + 内置本地后端种子（幂等，不可删除）
   * 2) users.storage_id 列（幂等守卫）+ 回填本地后端 id + 迁移扫描索引
   */
  private migrateStorageSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS storage_backends (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        type TEXT NOT NULL,
        endpoint TEXT NOT NULL DEFAULT '',
        internal_endpoint TEXT,
        region TEXT,
        bucket TEXT,
        path_prefix TEXT,
        is_default INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db
      .prepare(
        `INSERT OR IGNORE INTO storage_backends (name, type, endpoint, is_default, created_at, updated_at)
         VALUES ('本地存储', 'local', '', 1, ?, ?)`
      )
      .run(getNow(), getNow());

    const columns = this.db.prepare("PRAGMA table_info(users)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "storage_id")) {
      this.db.exec("ALTER TABLE users ADD COLUMN storage_id INTEGER NOT NULL DEFAULT 1");
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_users_storage_id ON users(storage_id)`);
    // 回填：存量行统一指向本地后端（防御后端 id 非 1 的场景）
    this.db.exec(
      `UPDATE users SET storage_id = (SELECT id FROM storage_backends WHERE type = 'local' LIMIT 1)
       WHERE storage_id NOT IN (SELECT id FROM storage_backends)`
    );
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

  /**
   * 仅首次安装时种子填充（以 configs_profile 的 tags_seeded 为标记）；
   * 升级场景一次性幂等补齐缺失默认项，此后不再自动回填（#94 补充：避免污染已整理标签的环境）。
   */
  private seedTags(): void {
    const marker = this.db
      .prepare("SELECT value FROM configs_profile WHERE key = ?")
      .get("tags_seeded") as { value: string } | undefined;
    if (marker) return;
    this.seedDefaultTags();
    this.db
      .prepare("INSERT OR IGNORE INTO configs_profile (key, value, updated_at) VALUES (?, ?, ?)")
      .run("tags_seeded", "1", getNow());
  }

  /** 默认预设插入（INSERT OR IGNORE，重复执行安全；class_id=0 表示全局标签） */
  private seedDefaultTags(): void {
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

  /** 重置为默认预设（标签管理页「恢复默认」，#94 补充）：清空全部标签后重插默认预设；学生已提交标签为文本直存，不受影响 */
  resetTagsToDefaults(): void {
    this.db.exec("DELETE FROM tags");
    this.seedDefaultTags();
  }

  /**
   * 档案提交历史版本（#95）：建表 + 索引 + 存量已提交学生生成初始版本 + 默认上限配置，幂等
   * 1) CREATE TABLE IF NOT EXISTS
   * 2) 存量已提交学生 INSERT（version=1, is_current=1），NOT IN 防重复
   * 3) configs_profile 写入默认上限值（INSERT OR IGNORE 不覆盖配置）
   */
  private migrateProfileSubmissions(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profile_submissions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        version INTEGER NOT NULL,
        tags TEXT,
        avatar_url TEXT,
        evaluation_url TEXT,
        storage_id INTEGER NOT NULL DEFAULT 1,
        submitted_at TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0
      )
    `);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ps_user_version ON profile_submissions(user_id, version)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ps_user_current ON profile_submissions(user_id, is_current)`);
    this.db.exec(`
      INSERT OR IGNORE INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, storage_id, submitted_at, is_current)
      SELECT u.id, 1, u.tags, u.avatar_url, u.evaluation_url, u.storage_id, u.submitted_at, 1
      FROM users u
      WHERE u.role = 'student' AND u.submitted_at IS NOT NULL
        AND u.id NOT IN (SELECT user_id FROM profile_submissions)
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO configs_profile (key, value, updated_at) VALUES (?, ?, ?)")
      .run(MAX_PROFILE_SUBMISSIONS_KEY, String(DEFAULT_MAX_PROFILE_SUBMISSIONS), getNow());
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

  getUserById(id: number): UserRow | undefined {
    return this.db.prepare("SELECT * FROM users WHERE id = ?").get(id) as UserRow | undefined;
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
  upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, storageId: number): void {
    this.db
      .prepare(
        `UPDATE users SET tags = ?, avatar_url = ?, evaluation_url = ?, submitted_at = ?, storage_id = ?
         WHERE role = 'student' AND user_code = ?`
      )
      .run(tagsJson, avatarUrl, evaluationUrl, getNow(), storageId, userCode);
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

  // profile_submissions（档案提交历史版本，#95）
  insertProfileSubmission(userId: number, version: number, data: ProfileSubmissionData): number {
    const result = this.db
      .prepare(
        `INSERT INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, storage_id, submitted_at, is_current)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        version,
        data.tags,
        data.avatar_url,
        data.evaluation_url,
        data.storage_id,
        data.submitted_at,
        data.is_current
      );
    return Number(result.lastInsertRowid);
  }

  getMaxProfileSubmissionVersion(userId: number): number {
    const row = this.db
      .prepare("SELECT MAX(version) as m FROM profile_submissions WHERE user_id = ?")
      .get(userId) as { m: number | null } | undefined;
    return row?.m ?? 0;
  }

  getProfileSubmissions(userId: number): ProfileSubmissionRow[] {
    return this.db
      .prepare("SELECT * FROM profile_submissions WHERE user_id = ? ORDER BY version DESC")
      .all(userId) as ProfileSubmissionRow[];
  }

  getProfileSubmission(id: number): ProfileSubmissionRow | undefined {
    return this.db
      .prepare("SELECT * FROM profile_submissions WHERE id = ?")
      .get(id) as ProfileSubmissionRow | undefined;
  }

  deleteOldestProfileSubmissions(userId: number, count: number): number {
    if (count <= 0) return 0;
    const result = this.db
      .prepare(
        `DELETE FROM profile_submissions WHERE id IN (
           SELECT id FROM profile_submissions WHERE user_id = ? ORDER BY version ASC LIMIT ?
         )`
      )
      .run(userId, count);
    return result.changes;
  }

  setCurrentProfileSubmission(versionId: number, userId: number): void {
    const tx = this.db.transaction(() => {
      this.db.prepare("UPDATE profile_submissions SET is_current = 0 WHERE user_id = ?").run(userId);
      this.db
        .prepare("UPDATE profile_submissions SET is_current = 1 WHERE id = ? AND user_id = ?")
        .run(versionId, userId);
    });
    tx();
  }

  getStudentsExceedingSubmissionLimit(maxVersions: number): ProfileSubmissionExceedRow[] {
    return this.db
      .prepare(
        `SELECT u.id as user_id, u.user_code, u.name, u.class_id, COUNT(ps.id) as version_count
         FROM users u JOIN profile_submissions ps ON ps.user_id = u.id
         WHERE u.role = 'student'
         GROUP BY u.id, u.user_code, u.name, u.class_id
         HAVING COUNT(ps.id) > ?
         ORDER BY version_count DESC, u.user_code`
      )
      .all(maxVersions) as ProfileSubmissionExceedRow[];
  }

  submitProfileWithVersion(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, storageId: number): { version: number } {
    const tx = this.db.transaction(() => {
      const user = this.db
        .prepare("SELECT id FROM users WHERE role = 'student' AND user_code = ?")
        .get(userCode) as { id: number } | undefined;
      if (!user) throw new Error("学生不存在：" + userCode);
      // 1) UPDATE users（不变）
      this.db
        .prepare("UPDATE users SET tags = ?, avatar_url = ?, evaluation_url = ?, submitted_at = ?, storage_id = ? WHERE id = ?")
        .run(tagsJson, avatarUrl, evaluationUrl, getNow(), storageId, user.id);
      // 2) 旧 is_current → 0
      this.db.prepare("UPDATE profile_submissions SET is_current = 0 WHERE user_id = ?").run(user.id);
      // 3) 计算 nextVersion = MAX(version) + 1
      const maxRow = this.db
        .prepare("SELECT MAX(version) as m FROM profile_submissions WHERE user_id = ?")
        .get(user.id) as { m: number | null } | undefined;
      const nextVersion = (maxRow?.m ?? 0) + 1;
      // 4) INSERT 新版本（is_current=1）
      this.db
        .prepare(
          `INSERT INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, storage_id, submitted_at, is_current)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(user.id, nextVersion, tagsJson, avatarUrl, evaluationUrl, storageId, getNow());
      // 5) 超限检查 → 删除最旧版本（仅删 DB 记录，文件保留，#111 旧文件不自动删除）
      const config = this.db
        .prepare("SELECT value FROM configs_profile WHERE key = ?")
        .get(MAX_PROFILE_SUBMISSIONS_KEY) as { value: string } | undefined;
      const maxVersions = config ? Number(config.value) : DEFAULT_MAX_PROFILE_SUBMISSIONS;
      if (Number.isInteger(maxVersions) && maxVersions > 0) {
        const count = (
          this.db.prepare("SELECT COUNT(*) as c FROM profile_submissions WHERE user_id = ?").get(user.id) as { c: number }
        ).c;
        if (count > maxVersions) {
          this.deleteOldestProfileSubmissions(user.id, count - maxVersions);
        }
      }
      return { version: nextVersion };
    });
    return tx();
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

  deleteTags(ids: number[]): void {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    const tx = this.db.transaction(() => {
      // 分类级联：先删所选分类下的二级标签，再删目标行本身（含重复分类下的标签）
      this.db.prepare(`DELETE FROM tags WHERE parent_id IN (${placeholders})`).run(...ids);
      this.db.prepare(`DELETE FROM tags WHERE id IN (${placeholders})`).run(...ids);
    });
    tx();
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

  getProfileConfigs(): ConfigRow[] {
    return this.db.prepare("SELECT key, value FROM configs_profile ORDER BY id").all() as ConfigRow[];
  }

  setProfileConfig(key: string, value: string): void {
    this.db
      .prepare(
        `INSERT INTO configs_profile (key, value, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`
      )
      .run(key, value, getNow());
  }

  // storage_backends（#111）
  listStorageBackends(): StorageBackendRow[] {
    return this.db.prepare("SELECT * FROM storage_backends ORDER BY id").all() as StorageBackendRow[];
  }

  getStorageBackend(id: number): StorageBackendRow | undefined {
    return this.db.prepare("SELECT * FROM storage_backends WHERE id = ?").get(id) as
      | StorageBackendRow
      | undefined;
  }

  insertStorageBackend(backend: NewStorageBackend): number {
    const result = this.db
      .prepare(
        `INSERT INTO storage_backends (name, type, endpoint, internal_endpoint, region, bucket, path_prefix, is_default, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`
      )
      .run(
        backend.name,
        backend.type,
        backend.endpoint ?? "",
        backend.internal_endpoint ?? null,
        backend.region ?? null,
        backend.bucket ?? null,
        backend.path_prefix ?? null,
        getNow(),
        getNow()
      );
    return Number(result.lastInsertRowid);
  }

  updateStorageBackend(id: number, fields: StorageBackendUpdateFields): void {
    const sets: string[] = [];
    const values: (string | null)[] = [];
    if (fields.name !== undefined) { sets.push("name = ?"); values.push(fields.name); }
    if (fields.endpoint !== undefined) { sets.push("endpoint = ?"); values.push(fields.endpoint); }
    if (fields.internal_endpoint !== undefined) { sets.push("internal_endpoint = ?"); values.push(fields.internal_endpoint); }
    if (fields.region !== undefined) { sets.push("region = ?"); values.push(fields.region); }
    if (fields.bucket !== undefined) { sets.push("bucket = ?"); values.push(fields.bucket); }
    if (fields.path_prefix !== undefined) { sets.push("path_prefix = ?"); values.push(fields.path_prefix); }
    if (sets.length === 0) return;
    sets.push("updated_at = ?");
    values.push(getNow());
    this.db.prepare(`UPDATE storage_backends SET ${sets.join(", ")} WHERE id = ?`).run(...values, id);
  }

  deleteStorageBackend(id: number): void {
    this.db.prepare("DELETE FROM storage_backends WHERE id = ?").run(id);
  }

  setDefaultStorageBackend(id: number): void {
    const tx = this.db.transaction((targetId: number) => {
      this.db.prepare("UPDATE storage_backends SET is_default = 0").run();
      this.db
        .prepare("UPDATE storage_backends SET is_default = 1, updated_at = ? WHERE id = ?")
        .run(getNow(), targetId);
    });
    tx(id);
  }

  getDefaultStorageBackend(): StorageBackendRow | undefined {
    return this.db.prepare("SELECT * FROM storage_backends WHERE is_default = 1 LIMIT 1").get() as
      | StorageBackendRow
      | undefined;
  }

  countUsersByStorageId(storageId: number): number {
    return (
      this.db.prepare("SELECT COUNT(*) AS c FROM users WHERE storage_id = ?").get(storageId) as { c: number }
    ).c;
  }

  getUsersByStorageId(storageId: number): UserRow[] {
    return this.db
      .prepare("SELECT * FROM users WHERE storage_id = ? ORDER BY id")
      .all(storageId) as UserRow[];
  }

  updateUserStorageId(userId: number, storageId: number): void {
    this.db.prepare("UPDATE users SET storage_id = ? WHERE id = ?").run(storageId, userId);
  }

  updateUserStorageRef(userId: number, storageId: number, avatarUrl: string | null, evaluationUrl: string | null): void {
    this.db
      .prepare("UPDATE users SET storage_id = ?, avatar_url = ?, evaluation_url = ? WHERE id = ?")
      .run(storageId, avatarUrl, evaluationUrl, userId);
  }

  insertAuditLog(log: NewAuditLog): void {
    this.db
      .prepare(
        `INSERT INTO audit_logs (
          created_at, actor_id, actor_user_code, actor_name, actor_role,
          action, method, path, resource_type, resource_id,
          status, error_message, ip, user_agent, metadata
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        getNow(),
        log.actor_id,
        log.actor_user_code,
        log.actor_name,
        log.actor_role,
        log.action,
        log.method,
        log.path,
        log.resource_type,
        log.resource_id,
        log.status,
        log.error_message,
        log.ip,
        log.user_agent,
        log.metadata
      );
  }

  /** 审计查询条件构建（参数化，无 SQL 拼接注入风险） */
  private buildAuditWhere(filters: AuditLogFilters): { where: string; params: (string | number)[] } {
    const clauses: string[] = [];
    const params: (string | number)[] = [];
    if (filters.from) {
      clauses.push("created_at >= ?");
      params.push(filters.from);
    }
    if (filters.to) {
      clauses.push("created_at <= ?");
      params.push(filters.to);
    }
    if (filters.actorId !== undefined) {
      clauses.push("actor_id = ?");
      params.push(filters.actorId);
    }
    if (filters.actorRole) {
      clauses.push("actor_role = ?");
      params.push(filters.actorRole);
    }
    if (filters.actorQuery) {
      clauses.push("(actor_name LIKE ? OR actor_user_code LIKE ?)");
      params.push(`%${filters.actorQuery}%`, `%${filters.actorQuery}%`);
    }
    if (filters.action) {
      clauses.push("action = ?");
      params.push(filters.action);
    }
    if (filters.resourceType) {
      clauses.push("resource_type = ?");
      params.push(filters.resourceType);
    }
    if (filters.status) {
      clauses.push("status = ?");
      params.push(filters.status);
    }
    return { where: clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "", params };
  }

  queryAuditLogs(filters: AuditLogFilters): { rows: AuditLogRow[]; total: number } {
    const { where, params } = this.buildAuditWhere(filters);
    const total = (this.db.prepare(`SELECT COUNT(*) AS n FROM audit_logs${where}`).get(...params) as { n: number }).n;
    const rows = this.db
      .prepare(`SELECT * FROM audit_logs${where} ORDER BY id DESC LIMIT ? OFFSET ?`)
      .all(...params, filters.pageSize, (filters.page - 1) * filters.pageSize) as AuditLogRow[];
    return { rows, total };
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
    const configs = this.db
      .prepare("SELECT key, value FROM configs_profile ORDER BY id")
      .all() as { key: string; value: string }[];
    const auditLogs = this.db
      .prepare("SELECT * FROM audit_logs ORDER BY id")
      .all() as AuditLogRow[];
    const storageBackends = this.db
      .prepare("SELECT * FROM storage_backends ORDER BY id")
      .all() as StorageBackendRow[];
    const profileSubmissions = this.db
      .prepare("SELECT * FROM profile_submissions ORDER BY id")
      .all() as ProfileSubmissionRow[];
    return {
      version: 4,
      sourceType: "sqlite",
      createdAt: new Date().toISOString(),
      users,
      classes,
      teacher_classes: teacherClasses,
      tags,
      audit_logs: auditLogs,
      configs_profile: configs,
      storage_backends: storageBackends,
      profile_submissions: profileSubmissions,
    };
  }

  restore(data: BackupData): void {
    // 恢复期间显式关闭外键约束（DELETE + INSERT 顺序在 FK 开启时可能违反 REFERENCES）
    const fkWasOn = (this.db.pragma("foreign_keys", { simple: true }) as number) === 1;
    if (fkWasOn) this.db.pragma("foreign_keys = OFF");
    try {
    const restoreTx = this.db.transaction((d: BackupData) => {
      const tags = normalizeBackupTags(d.tags);
      this.db.exec("DELETE FROM teacher_classes");
      this.db.exec("DELETE FROM users");
      this.db.exec("DELETE FROM classes");
      this.db.exec("DELETE FROM tags");
      // 存储后端恢复（#111）：含此字段 → 整体替换；旧备份 → 保留当前后端表不动；
      // 必须在 users 之前（同一备份内 storage_id 引用天然一致）；恢复后保证本地后端存在（内置不可删）
      if (Array.isArray(d.storage_backends)) {
        this.db.exec("DELETE FROM storage_backends");
        const stmt = this.db.prepare(
          `INSERT INTO storage_backends (id, name, type, endpoint, internal_endpoint, region, bucket, path_prefix, is_default, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const b of d.storage_backends) {
          stmt.run(
            b.id,
            b.name,
            b.type,
            b.endpoint ?? "",
            b.internal_endpoint ?? null,
            b.region ?? null,
            b.bucket ?? null,
            b.path_prefix ?? null,
            b.is_default ?? 0,
            b.created_at ?? getNow(),
            b.updated_at ?? getNow()
          );
        }
      }
      const hasLocal = this.db
        .prepare("SELECT id FROM storage_backends WHERE type = 'local' LIMIT 1")
        .get();
      if (!hasLocal) {
        this.db
          .prepare(
            `INSERT OR IGNORE INTO storage_backends (name, type, endpoint, is_default, created_at, updated_at)
             VALUES ('本地存储', 'local', '', 0, ?, ?)`
          )
          .run(getNow(), getNow());
      }
      const localId = (
        this.db.prepare("SELECT id FROM storage_backends WHERE type = 'local' LIMIT 1").get() as { id: number }
      ).id;
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
          `INSERT INTO users (id, user_code, password_hash, role, name, class_id, tags, avatar_url, evaluation_url, submitted_at, created_at, storage_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            u.created_at,
            // 旧备份无 storage_id → 回填本地后端（旧部署均为本地存储）
            u.storage_id ?? localId
          );
        }
      }
      if (d.teacher_classes.length > 0) {
        const stmt = this.db.prepare(
          "INSERT INTO teacher_classes (id, teacher_id, class_id, created_at) VALUES (?, ?, ?, ?)"
        );
        for (const tc of d.teacher_classes) stmt.run(tc.id, tc.teacher_id, tc.class_id, tc.created_at);
      }
      // 配置恢复（旧备份无此字段时保留当前配置不动）
      if (Array.isArray(d.configs_profile)) {
        this.db.exec("DELETE FROM configs_profile");
        const stmt = this.db.prepare(
          "INSERT INTO configs_profile (key, value, updated_at) VALUES (?, ?, ?)"
        );
        for (const c of d.configs_profile) stmt.run(c.key, c.value, getNow());
      }
      // 审计日志恢复（#110；旧备份无此字段时保留当前审计记录不动）
      if (Array.isArray(d.audit_logs)) {
        this.db.exec("DELETE FROM audit_logs");
        const stmt = this.db.prepare(
          `INSERT INTO audit_logs (
            id, created_at, actor_id, actor_user_code, actor_name, actor_role,
            action, method, path, resource_type, resource_id,
            status, error_message, ip, user_agent, metadata
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const a of d.audit_logs) {
          stmt.run(
            a.id,
            a.created_at,
            a.actor_id,
            a.actor_user_code,
            a.actor_name,
            a.actor_role,
            a.action,
            a.method,
            a.path,
            a.resource_type,
            a.resource_id,
            a.status,
            a.error_message,
            a.ip,
            a.user_agent,
            a.metadata
          );
        }
      }
      // 档案提交历史版本恢复（#95；旧备份无此字段时保留当前记录不动）
      if (Array.isArray(d.profile_submissions)) {
        this.db.exec("DELETE FROM profile_submissions");
        if (d.profile_submissions.length > 0) {
          const stmt = this.db.prepare(
            `INSERT INTO profile_submissions (id, user_id, version, tags, avatar_url, evaluation_url, storage_id, submitted_at, is_current)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const p of d.profile_submissions) {
            stmt.run(
              p.id,
              p.user_id,
              p.version,
              p.tags,
              p.avatar_url,
              p.evaluation_url,
              p.storage_id ?? 1,
              p.submitted_at,
              p.is_current ?? 0
            );
          }
        }
      }
    });
    restoreTx(data);
    } finally {
      if (fkWasOn) this.db.pragma("foreign_keys = ON");
    }
  }

  close(): void {
    this.db.close();
  }
}
