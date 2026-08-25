import mysql from "mysql2/promise";
import { readFileSync, existsSync } from "fs";
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

/** SQLite 弱类型：可空整数列可能导出空字符串，MySQL 严格模式需转为 null */
function nullableInt(v: unknown): number | null {
  if (v === null || v === undefined || v === "") return null;
  return Number(v);
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
        type VARCHAR(20) NOT NULL,
        parent_id INT,
        class_id INT NOT NULL DEFAULT 0,
        category_order INT DEFAULT 0,
        sort_order INT DEFAULT 0,
        active TINYINT NOT NULL DEFAULT 1,
        UNIQUE KEY uq_tag_parent_class (name, parent_id, class_id),
        UNIQUE KEY uq_tag_type_class (name, type, class_id),
        INDEX idx_tags_parent (parent_id),
        INDEX idx_tags_order (category_order, sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS configs_profile (
        id INT AUTO_INCREMENT PRIMARY KEY,
        \`key\` VARCHAR(50) NOT NULL UNIQUE,
        value TEXT NOT NULL,
        updated_at TEXT,
        INDEX idx_configs_profile_key (\`key\`)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    // 默认配置幂等写入（已存在则不覆盖）
    await this.pool.execute(
      "INSERT IGNORE INTO configs_profile (`key`, value, updated_at) VALUES (?, ?, ?)",
      ["max_custom_tags", String(DEFAULT_MAX_CUSTOM_TAGS), getNow()]
    );
    // 操作审计日志（#110）：只追加 + 查询，操作者字段快照冗余，追溯不依赖外键（账号可被删改）
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT AUTO_INCREMENT PRIMARY KEY,
        created_at TEXT NOT NULL,
        actor_id INT,
        actor_user_code TEXT,
        actor_name TEXT,
        actor_role TEXT,
        action VARCHAR(100) NOT NULL,
        method VARCHAR(10),
        path TEXT,
        resource_type VARCHAR(50),
        resource_id VARCHAR(100),
        status VARCHAR(20) NOT NULL,
        error_message TEXT,
        ip TEXT,
        user_agent TEXT,
        metadata TEXT,
        INDEX idx_audit_created_at (created_at(19)),
        INDEX idx_audit_actor_id (actor_id),
        INDEX idx_audit_resource (resource_type, resource_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.migrateStorageSchema();
    await this.migrateTagSchema();
    await this.seedTags();
    await this.migrateLegacy();
    await this.migrateProfileSubmissions();
  }

  /**
   * 对象存储多后端注册表（#111）：
   * 1) storage_backends 表 + 内置本地后端种子（幂等，不可删除）
   * 2) users.storage_id 列（幂等守卫）+ 回填本地后端 id + 迁移扫描索引
   */
  private async migrateStorageSchema(): Promise<void> {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS storage_backends (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(100) NOT NULL UNIQUE,
        type VARCHAR(10) NOT NULL,
        endpoint VARCHAR(500) NOT NULL DEFAULT '',
        internal_endpoint VARCHAR(500),
        region VARCHAR(100),
        bucket VARCHAR(200),
        path_prefix VARCHAR(500),
        is_default TINYINT NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.execute(
      `INSERT IGNORE INTO storage_backends (name, type, endpoint, is_default, created_at, updated_at)
       VALUES ('本地存储', 'local', '', 1, ?, ?)`,
      [getNow(), getNow()]
    );

    if (!(await this.columnExists("users", "storage_id"))) {
      await this.pool.execute("ALTER TABLE users ADD COLUMN storage_id INT NOT NULL DEFAULT 1");
    }
    if (!(await this.indexExists("users", "idx_users_storage_id"))) {
      await this.pool.execute("CREATE INDEX idx_users_storage_id ON users (storage_id)");
    }
    // 回填：存量行统一指向本地后端（防御后端 id 非 1 的场景）
    await this.pool.execute(
      `UPDATE users SET storage_id = (SELECT id FROM storage_backends WHERE type = 'local' LIMIT 1)
       WHERE storage_id NOT IN (SELECT id FROM (SELECT id FROM storage_backends) t)`
    );
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

  private async indexExists(table: string, index: string): Promise<boolean> {
    const [rows] = await this.pool.execute(
      "SELECT 1 FROM information_schema.statistics WHERE table_schema = ? AND table_name = ? AND index_name = ?",
      [this.database, table, index]
    );
    return (rows as unknown[]).length > 0;
  }

  private async migrateTagSchema(): Promise<void> {
    const hasCategory = await this.columnExists("tags", "category");
    const hasType = await this.columnExists("tags", "type");
    if (!hasType) {
      await this.pool.execute("ALTER TABLE tags ADD COLUMN type VARCHAR(20) NOT NULL DEFAULT 'tag'");
    }
    if (!(await this.columnExists("tags", "parent_id"))) {
      await this.pool.execute("ALTER TABLE tags ADD COLUMN parent_id INT");
    }
    if (!(await this.columnExists("tags", "active"))) {
      await this.pool.execute("ALTER TABLE tags ADD COLUMN active TINYINT NOT NULL DEFAULT 1");
    }
    await this.pool.execute("UPDATE tags SET class_id = 0 WHERE class_id IS NULL");
    if (!hasCategory) return;

    const [categoryRows] = await this.pool.execute(
      `SELECT category as name, MIN(category_order) as category_order
       FROM tags WHERE class_id = 0 GROUP BY category`
    );
    const insertCategory =
      "INSERT IGNORE INTO tags (name, category, type, parent_id, class_id, category_order, sort_order, active) VALUES (?, ?, 'category', NULL, 0, ?, 0, 1)";
    for (const category of categoryRows as { name: string; category_order: number }[]) {
      await this.pool.execute(insertCategory, [category.name, category.name, category.category_order]);
    }
    await this.pool.execute(
      `UPDATE tags child
       JOIN tags parent ON parent.name = child.category AND parent.type = 'category' AND parent.class_id = 0
       SET child.type = 'tag', child.parent_id = parent.id, child.active = 1
       WHERE child.class_id = 0 AND child.type = 'tag'`
    );
  }

  /**
   * 仅首次安装时种子填充（以 configs_profile 的 tags_seeded 为标记）；
   * 升级场景一次性幂等补齐缺失默认项，此后不再自动回填（#94 补充：避免污染已整理标签的环境）。
   */
  private async seedTags(): Promise<void> {
    const [rows] = await this.pool.execute(
      "SELECT value FROM configs_profile WHERE `key` = ?",
      ["tags_seeded"]
    );
    if ((rows as unknown[]).length > 0) return;
    await this.seedDefaultTags();
    await this.pool.execute(
      "INSERT IGNORE INTO configs_profile (`key`, value, updated_at) VALUES (?, ?, ?)",
      ["tags_seeded", "1", getNow()]
    );
  }

  /** 默认预设插入（INSERT IGNORE，重复执行安全；class_id=0 表示全局标签） */
  private async seedDefaultTags(): Promise<void> {
    const hasLegacyCategory = await this.columnExists("tags", "category");
    for (let ci = 0; ci < tagCategories.length; ci++) {
      const cat = tagCategories[ci];
      if (hasLegacyCategory) {
        await this.pool.execute(
          `INSERT IGNORE INTO tags (name, category, type, parent_id, class_id, category_order, sort_order, active)
           VALUES (?, ?, 'category', NULL, 0, ?, 0, 1)`,
          [cat.name, cat.name, ci]
        );
      } else {
        await this.pool.execute(
          `INSERT IGNORE INTO tags (name, type, parent_id, class_id, category_order, sort_order, active)
           VALUES (?, 'category', NULL, 0, ?, 0, 1)`,
          [cat.name, ci]
        );
      }
      const [parents] = await this.pool.execute(
        "SELECT id FROM tags WHERE name = ? AND type = 'category' AND class_id = 0",
        [cat.name]
      );
      const parent = (parents as { id: number }[])[0];
      if (!parent) continue;
      for (let ti = 0; ti < cat.tags.length; ti++) {
        await this.pool.execute(
          hasLegacyCategory
            ? `INSERT IGNORE INTO tags (name, category, type, parent_id, class_id, category_order, sort_order, active)
               VALUES (?, ?, 'tag', ?, 0, ?, ?, 1)`
            : `INSERT IGNORE INTO tags (name, type, parent_id, class_id, category_order, sort_order, active)
               VALUES (?, 'tag', ?, 0, ?, ?, 1)`,
          hasLegacyCategory
            ? [cat.tags[ti], cat.name, parent.id, ci, ti]
            : [cat.tags[ti], parent.id, ci, ti]
        );
      }
    }
  }

  /** 重置为默认预设（标签管理页「恢复默认」，#94 补充）：清空全部标签后重插默认预设；学生已提交标签为文本直存，不受影响 */
  async resetTagsToDefaults(): Promise<void> {
    await this.pool.execute("DELETE FROM tags");
    await this.seedDefaultTags();
  }

  /**
   * 档案提交历史版本（#95）：建表 + 索引 + 存量已提交学生生成初始版本 + 默认上限配置，幂等
   * 1) CREATE TABLE IF NOT EXISTS
   * 2) 存量已提交学生 INSERT（version=1, is_current=1），NOT IN 防重复
   * 3) configs_profile 写入默认上限值（INSERT IGNORE 不覆盖配置）
   */
  private async migrateProfileSubmissions(): Promise<void> {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS profile_submissions (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        version INT NOT NULL,
        tags TEXT,
        avatar_url VARCHAR(500),
        evaluation_url VARCHAR(500),
        storage_id INT NOT NULL DEFAULT 1,
        submitted_at TEXT NOT NULL,
        is_current TINYINT NOT NULL DEFAULT 0,
        INDEX idx_ps_user_version (user_id, version),
        INDEX idx_ps_user_current (user_id, is_current)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
    await this.pool.execute(`
      INSERT IGNORE INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, storage_id, submitted_at, is_current)
      SELECT u.id, 1, u.tags, u.avatar_url, u.evaluation_url, u.storage_id, u.submitted_at, 1
      FROM users u
      WHERE u.role = 'student' AND u.submitted_at IS NOT NULL
        AND u.id NOT IN (SELECT user_id FROM profile_submissions)
    `);
    await this.pool.execute(
      "INSERT IGNORE INTO configs_profile (`key`, value, updated_at) VALUES (?, ?, ?)",
      [MAX_PROFILE_SUBMISSIONS_KEY, String(DEFAULT_MAX_PROFILE_SUBMISSIONS), getNow()]
    );
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

  async getUserById(id: number): Promise<UserRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE id = ?", [id]);
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
  async upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, storageId: number): Promise<void> {
    await this.pool.execute(
      `UPDATE users SET tags = ?, avatar_url = ?, evaluation_url = ?, submitted_at = ?, storage_id = ?
       WHERE role = 'student' AND user_code = ?`,
      [tagsJson, avatarUrl, evaluationUrl, getNow(), storageId, userCode]
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

  // profile_submissions（档案提交历史版本，#95）
  async insertProfileSubmission(userId: number, version: number, data: ProfileSubmissionData): Promise<number> {
    const [result] = await this.pool.execute(
      `INSERT INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, storage_id, submitted_at, is_current)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        userId,
        version,
        data.tags,
        data.avatar_url,
        data.evaluation_url,
        data.storage_id,
        data.submitted_at,
        data.is_current,
      ]
    );
    return (result as mysql.ResultSetHeader).insertId;
  }

  async getMaxProfileSubmissionVersion(userId: number): Promise<number> {
    const [rows] = await this.pool.execute(
      "SELECT MAX(version) as m FROM profile_submissions WHERE user_id = ?",
      [userId]
    );
    const row = (rows as { m: number | null }[])[0];
    return row?.m ? Number(row.m) : 0;
  }

  async getProfileSubmissions(userId: number): Promise<ProfileSubmissionRow[]> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM profile_submissions WHERE user_id = ? ORDER BY version DESC",
      [userId]
    );
    return rows as ProfileSubmissionRow[];
  }

  async getProfileSubmission(id: number): Promise<ProfileSubmissionRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM profile_submissions WHERE id = ?", [id]);
    return (rows as ProfileSubmissionRow[])[0];
  }

  async deleteOldestProfileSubmissions(userId: number, count: number): Promise<number> {
    if (count <= 0) return 0;
    // MySQL 禁止 UPDATE/DELETE 直接引用目标表子查询，需派生表包装一层
    const [result] = await this.pool.execute(
      `DELETE FROM profile_submissions WHERE id IN (
         SELECT t.id FROM (SELECT id FROM profile_submissions WHERE user_id = ? ORDER BY version ASC LIMIT ?) t
       )`,
      [userId, count]
    );
    return (result as mysql.ResultSetHeader).affectedRows;
  }

  async setCurrentProfileSubmission(versionId: number, userId: number): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("UPDATE profile_submissions SET is_current = 0 WHERE user_id = ?", [userId]);
      await conn.execute(
        "UPDATE profile_submissions SET is_current = 1 WHERE id = ? AND user_id = ?",
        [versionId, userId]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getStudentsExceedingSubmissionLimit(
    maxVersions: number
  ): Promise<ProfileSubmissionExceedRow[]> {
    const [rows] = await this.pool.execute(
      `SELECT u.id as user_id, u.user_code, u.name, u.class_id, COUNT(ps.id) as version_count
       FROM users u JOIN profile_submissions ps ON ps.user_id = u.id
       WHERE u.role = 'student'
       GROUP BY u.id, u.user_code, u.name, u.class_id
       HAVING COUNT(ps.id) > ?
       ORDER BY version_count DESC, u.user_code`,
      [maxVersions]
    );
    return (rows as ProfileSubmissionExceedRow[]).map((r) => ({
      ...r,
      version_count: Number(r.version_count),
    }));
  }

  async submitProfileWithVersion(
    userCode: string,
    tagsJson: string,
    avatarUrl: string,
    evaluationUrl: string,
    storageId: number
  ): Promise<{ version: number }> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      const [userRows] = await conn.execute(
        "SELECT id FROM users WHERE role = 'student' AND user_code = ?",
        [userCode]
      );
      const user = (userRows as { id: number }[])[0];
      if (!user) throw new Error("学生不存在：" + userCode);
      // 1) UPDATE users（不变）
      await conn.execute(
        "UPDATE users SET tags = ?, avatar_url = ?, evaluation_url = ?, submitted_at = ?, storage_id = ? WHERE id = ?",
        [tagsJson, avatarUrl, evaluationUrl, getNow(), storageId, user.id]
      );
      // 2) 旧 is_current → 0
      await conn.execute("UPDATE profile_submissions SET is_current = 0 WHERE user_id = ?", [user.id]);
      // 3) 计算 nextVersion = MAX(version) + 1
      const [maxRows] = await conn.execute(
        "SELECT MAX(version) as m FROM profile_submissions WHERE user_id = ?",
        [user.id]
      );
      const maxRow = (maxRows as { m: number | null }[])[0];
      const nextVersion = (maxRow?.m ? Number(maxRow.m) : 0) + 1;
      // 4) INSERT 新版本（is_current=1）
      await conn.execute(
        `INSERT INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, storage_id, submitted_at, is_current)
         VALUES (?, ?, ?, ?, ?, ?, ?, 1)`,
        [user.id, nextVersion, tagsJson, avatarUrl, evaluationUrl, storageId, getNow()]
      );
      // 5) 超限检查 → 删除最旧版本（仅删 DB 记录，文件保留，#111 旧文件不自动删除）
      const [configRows] = await conn.execute(
        "SELECT value FROM configs_profile WHERE `key` = ?",
        [MAX_PROFILE_SUBMISSIONS_KEY]
      );
      const config = (configRows as { value: string }[])[0];
      const maxVersions = config ? Number(config.value) : DEFAULT_MAX_PROFILE_SUBMISSIONS;
      if (Number.isInteger(maxVersions) && maxVersions > 0) {
        const [countRows] = await conn.execute(
          "SELECT COUNT(*) as c FROM profile_submissions WHERE user_id = ?",
          [user.id]
        );
        const count = Number((countRows as { c: number }[])[0].c);
        if (count > maxVersions) {
          await this.deleteOldestProfileSubmissions(user.id, count - maxVersions);
        }
      }
      await conn.commit();
      return { version: nextVersion };
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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
      `SELECT id, name, type, parent_id, class_id, category_order, sort_order, active
       FROM tags WHERE class_id = 0
       ORDER BY category_order, CASE WHEN type = 'category' THEN 0 ELSE 1 END, sort_order, id`
    );
    return rows as TagRow[];
  }

  async getActiveTags(): Promise<TagRow[]> {
    const [rows] = await this.pool.execute(
      `SELECT t.id, t.name, t.type, t.parent_id, t.class_id, t.category_order, t.sort_order, t.active
       FROM tags t
       LEFT JOIN tags p ON p.id = t.parent_id
       WHERE t.class_id = 0 AND t.active = 1
         AND (t.type = 'category' OR (p.active = 1 AND p.type = 'category'))
         ORDER BY t.category_order, CASE WHEN t.type = 'category' THEN 0 ELSE 1 END, t.sort_order, t.id`
    );
    return rows as TagRow[];
  }

  async insertTag(tag: {
    name: string;
    type: "category" | "tag";
    parent_id?: number | null;
    category_order?: number;
    sort_order?: number;
  }): Promise<number> {
    const [result] = await this.pool.execute(
      `INSERT INTO tags (name, type, parent_id, class_id, category_order, sort_order, active)
       VALUES (?, ?, ?, 0, ?, ?, 1)`,
      [tag.name, tag.type, tag.type === "category" ? null : tag.parent_id ?? null, tag.category_order ?? 0, tag.sort_order ?? 0]
    );
    return (result as mysql.ResultSetHeader).insertId;
  }

  async updateTag(id: number, fields: {
    name?: string;
    parent_id?: number | null;
    category_order?: number;
    sort_order?: number;
  }): Promise<void> {
    const assignments: string[] = [];
    const values: (string | number | null)[] = [];
    if (fields.name !== undefined) { assignments.push("name = ?"); values.push(fields.name); }
    if (fields.parent_id !== undefined) { assignments.push("parent_id = ?"); values.push(fields.parent_id); }
    if (fields.category_order !== undefined) { assignments.push("category_order = ?"); values.push(fields.category_order); }
    if (fields.sort_order !== undefined) { assignments.push("sort_order = ?"); values.push(fields.sort_order); }
    if (assignments.length === 0) return;
    values.push(id);
    await this.pool.execute(`UPDATE tags SET ${assignments.join(", ")} WHERE id = ?`, values);
  }

  async deleteTags(ids: number[]): Promise<void> {
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(", ");
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      // 分类级联：先删所选分类下的二级标签，再删目标行本身（含重复分类下的标签）
      await conn.execute(`DELETE FROM tags WHERE parent_id IN (${placeholders})`, ids);
      await conn.execute(`DELETE FROM tags WHERE id IN (${placeholders})`, ids);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
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

  async updateClass(id: number, fields: { name?: string; invitation_code?: string }): Promise<void> {
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
    await this.pool.execute(`UPDATE classes SET ${sets.join(", ")} WHERE id = ?`, [...params, id]);
  }

  async deleteClass(id: number): Promise<void> {
    // 建表未定义外键，事务内显式清理关联数据
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("UPDATE users SET class_id = NULL WHERE class_id = ?", [id]);
      await conn.execute("DELETE FROM teacher_classes WHERE class_id = ?", [id]);
      await conn.execute("DELETE FROM classes WHERE id = ?", [id]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async insertTeacherClass(teacherId: number, classId: number): Promise<void> {
    await this.pool.execute(
      "INSERT INTO teacher_classes (teacher_id, class_id, created_at) VALUES (?, ?, ?)",
      [teacherId, classId, getNow()]
    );
  }

  async getTeacherClassPairs(): Promise<TeacherClassRow[]> {
    const [rows] = await this.pool.execute("SELECT * FROM teacher_classes ORDER BY id");
    return rows as TeacherClassRow[];
  }

  async getTeachers(): Promise<UserRow[]> {
    const [rows] = await this.pool.execute("SELECT * FROM users WHERE role = 'teacher' ORDER BY id");
    return rows as UserRow[];
  }

  async deleteTeacher(id: number): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("DELETE FROM teacher_classes WHERE teacher_id = ?", [id]);
      await conn.execute("DELETE FROM users WHERE id = ?", [id]);
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  getProfileConfigs(): Promise<ConfigRow[]> {
    return (async () => {
      const [rows] = await this.pool.execute("SELECT `key` as `key`, value FROM configs_profile ORDER BY id");
      return rows as ConfigRow[];
    })();
  }

  async setProfileConfig(key: string, value: string): Promise<void> {
    await this.pool.execute(
      `INSERT INTO configs_profile (\`key\`, value, updated_at) VALUES (?, ?, ?)
       ON DUPLICATE KEY UPDATE value = VALUES(value), updated_at = VALUES(updated_at)`,
      [key, value, getNow()]
    );
  }

  // storage_backends（#111）
  async listStorageBackends(): Promise<StorageBackendRow[]> {
    const [rows] = await this.pool.execute("SELECT * FROM storage_backends ORDER BY id");
    return rows as StorageBackendRow[];
  }

  async getStorageBackend(id: number): Promise<StorageBackendRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM storage_backends WHERE id = ?", [id]);
    return (rows as StorageBackendRow[])[0];
  }

  async insertStorageBackend(backend: NewStorageBackend): Promise<number> {
    const [result] = await this.pool.execute(
      `INSERT INTO storage_backends (name, type, endpoint, internal_endpoint, region, bucket, path_prefix, is_default, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?, ?)`,
      [
        backend.name,
        backend.type,
        backend.endpoint ?? "",
        backend.internal_endpoint ?? null,
        backend.region ?? null,
        backend.bucket ?? null,
        backend.path_prefix ?? null,
        getNow(),
        getNow(),
      ]
    );
    return (result as mysql.ResultSetHeader).insertId;
  }

  async updateStorageBackend(id: number, fields: StorageBackendUpdateFields): Promise<void> {
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
    await this.pool.execute(`UPDATE storage_backends SET ${sets.join(", ")} WHERE id = ?`, [...values, id]);
  }

  async deleteStorageBackend(id: number): Promise<void> {
    await this.pool.execute("DELETE FROM storage_backends WHERE id = ?", [id]);
  }

  async setDefaultStorageBackend(id: number): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      await conn.execute("UPDATE storage_backends SET is_default = 0");
      await conn.execute(
        "UPDATE storage_backends SET is_default = 1, updated_at = ? WHERE id = ?",
        [getNow(), id]
      );
      await conn.commit();
    } catch (err) {
      await conn.rollback();
      throw err;
    } finally {
      conn.release();
    }
  }

  async getDefaultStorageBackend(): Promise<StorageBackendRow | undefined> {
    const [rows] = await this.pool.execute("SELECT * FROM storage_backends WHERE is_default = 1 LIMIT 1");
    return (rows as StorageBackendRow[])[0];
  }

  async countUsersByStorageId(storageId: number): Promise<number> {
    const [rows] = await this.pool.execute("SELECT COUNT(*) AS c FROM users WHERE storage_id = ?", [storageId]);
    return Number((rows as { c: number }[])[0].c);
  }

  async getUsersByStorageId(storageId: number): Promise<UserRow[]> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM users WHERE storage_id = ? ORDER BY id",
      [storageId]
    );
    return rows as UserRow[];
  }

  async updateUserStorageId(userId: number, storageId: number): Promise<void> {
    await this.pool.execute("UPDATE users SET storage_id = ? WHERE id = ?", [storageId, userId]);
  }

  async updateUserStorageRef(userId: number, storageId: number, avatarUrl: string | null, evaluationUrl: string | null): Promise<void> {
    await this.pool.execute(
      "UPDATE users SET storage_id = ?, avatar_url = ?, evaluation_url = ? WHERE id = ?",
      [storageId, avatarUrl, evaluationUrl, userId]
    );
  }

  async insertAuditLog(log: NewAuditLog): Promise<void> {
    await this.pool.execute(
      `INSERT INTO audit_logs (
        created_at, actor_id, actor_user_code, actor_name, actor_role,
        action, method, path, resource_type, resource_id,
        status, error_message, ip, user_agent, metadata
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
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
        log.metadata,
      ]
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

  async queryAuditLogs(filters: AuditLogFilters): Promise<{ rows: AuditLogRow[]; total: number }> {
    const { where, params } = this.buildAuditWhere(filters);
    const [countRows] = await this.pool.execute(
      `SELECT COUNT(*) AS n FROM audit_logs${where}`,
      params
    );
    const total = Number((countRows as { n: number }[])[0]?.n ?? 0);
    const [rows] = await this.pool.execute(
      `SELECT * FROM audit_logs${where} ORDER BY id DESC LIMIT ? OFFSET ?`,
      [...params, filters.pageSize, (filters.page - 1) * filters.pageSize]
    );
    return { rows: rows as AuditLogRow[], total };
  }

  async backup(): Promise<BackupData> {
    const [users] = await this.pool.execute("SELECT * FROM users ORDER BY id");
    const [classes] = await this.pool.execute("SELECT * FROM classes ORDER BY id");
    const [teacherClasses] = await this.pool.execute("SELECT * FROM teacher_classes ORDER BY id");
    const [tags] = await this.pool.execute(
      "SELECT id, name, type, parent_id, class_id, category_order, sort_order, active FROM tags ORDER BY id"
    );
    const [configs] = await this.pool.execute(
      "SELECT `key` as `key`, value FROM configs_profile ORDER BY id"
    );
    const [auditLogs] = await this.pool.execute("SELECT * FROM audit_logs ORDER BY id");
    const [storageBackends] = await this.pool.execute("SELECT * FROM storage_backends ORDER BY id");
    return {
      version: 3,
      sourceType: "mysql",
      createdAt: new Date().toISOString(),
      users: users as UserRow[],
      classes: classes as ClassRow[],
      teacher_classes: teacherClasses as BackupData["teacher_classes"],
      tags: tags as TagRow[],
      audit_logs: auditLogs as AuditLogRow[],
      configs_profile: configs as { key: string; value: string }[],
      storage_backends: storageBackends as StorageBackendRow[],
    };
  }

  async restore(data: BackupData): Promise<void> {
    const conn = await this.pool.getConnection();
    try {
      await conn.beginTransaction();
      // 恢复期间关闭外键约束（全量 DELETE + INSERT 顺序可能违反 REFERENCES）
      await conn.execute("SET FOREIGN_KEY_CHECKS = 0");
      const tags = normalizeBackupTags(data.tags);
      await conn.execute("DELETE FROM teacher_classes");
      await conn.execute("DELETE FROM users");
      await conn.execute("DELETE FROM classes");
      await conn.execute("DELETE FROM tags");
      // 存储后端恢复（#111）：含此字段 → 整体替换；旧备份 → 保留当前后端表不动；
      // 必须在 users 之前（同一备份内 storage_id 引用天然一致）；恢复后保证本地后端存在（内置不可删）
      if (Array.isArray(data.storage_backends)) {
        await conn.execute("DELETE FROM storage_backends");
        if (data.storage_backends.length > 0) {
          const values = data.storage_backends.map((b) => [
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
            b.updated_at ?? getNow(),
          ]);
          await conn.query(
            `INSERT INTO storage_backends (id, name, type, endpoint, internal_endpoint, region, bucket, path_prefix, is_default, created_at, updated_at)
             VALUES ?`,
            [values]
          );
        }
      }
      const [localRows] = await conn.execute(
        "SELECT id FROM storage_backends WHERE type = 'local' LIMIT 1"
      );
      if ((localRows as unknown[]).length === 0) {
        await conn.execute(
          `INSERT IGNORE INTO storage_backends (name, type, endpoint, is_default, created_at, updated_at)
           VALUES ('本地存储', 'local', '', 0, ?, ?)`,
          [getNow(), getNow()]
        );
      }
      const [localIdRows] = await conn.execute(
        "SELECT id FROM storage_backends WHERE type = 'local' LIMIT 1"
      );
      const localId = Number((localIdRows as { id: number }[])[0].id);
      if (tags.length > 0) {
        const values = tags.map((t) => [
          t.id,
          t.name,
          t.type ?? "tag",
          nullableInt(t.parent_id),
          t.class_id ?? 0,
          t.category_order ?? 0,
          t.sort_order ?? 0,
          t.active ?? 1,
        ]);
        await conn.query(
          "INSERT INTO tags (id, name, type, parent_id, class_id, category_order, sort_order, active) VALUES ?",
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
          nullableInt(u.class_id),
          u.tags,
          u.avatar_url,
          u.evaluation_url,
          u.submitted_at,
          u.created_at,
          nullableInt(u.storage_id) ?? localId,
        ]);
        await conn.query(
          `INSERT INTO users (id, user_code, password_hash, role, name, class_id, tags, avatar_url, evaluation_url, submitted_at, created_at, storage_id)
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
      // 配置恢复（旧备份无此字段时保留当前配置不动）
      if (Array.isArray(data.configs_profile)) {
        await conn.execute("DELETE FROM configs_profile");
        if (data.configs_profile.length > 0) {
          const values = data.configs_profile.map((c) => [c.key, c.value, getNow()]);
          await conn.query(
            "INSERT INTO configs_profile (`key`, value, updated_at) VALUES ?",
            [values]
          );
        }
      }
      // 审计日志恢复（#110；旧备份无此字段时保留当前审计记录不动）
      if (Array.isArray(data.audit_logs)) {
        await conn.execute("DELETE FROM audit_logs");
        if (data.audit_logs.length > 0) {
          const values = data.audit_logs.map((a) => [
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
            a.metadata,
          ]);
          await conn.query(
            `INSERT INTO audit_logs (
              id, created_at, actor_id, actor_user_code, actor_name, actor_role,
              action, method, path, resource_type, resource_id,
              status, error_message, ip, user_agent, metadata
            ) VALUES ?`,
            [values]
          );
        }
      }
      await conn.execute("SET FOREIGN_KEY_CHECKS = 1");
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
