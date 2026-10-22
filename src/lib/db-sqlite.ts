import Database from "better-sqlite3";
import { mkdirSync, readFileSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { tagCategories } from "./tagData";
import { ASSESSMENT_SEEDS, RIASEC_CODE, getQuestionSeeds, validateAssessmentSeed } from "./assessment-data";
import { buildSubmittedProfilesSql } from "./profile-query";
import type { QuestionSeed } from "./assessment-data";
import { getOnetOccupationSeeds, needsOnetReseed, ONET_SEED_MARKER_KEY, onetInterestCodeOf } from "./onet";
import { ONET_DATASET_VERSION } from "./onet-data";
import { normalizeBackupTags, normalizeAssessmentCode, DEFAULT_MAX_CUSTOM_TAGS, DEFAULT_MAX_PROFILE_SUBMISSIONS, MAX_PROFILE_SUBMISSIONS_KEY, DEFAULT_MEDIA_ORPHAN_RETENTION_DAYS, MEDIA_ORPHAN_RETENTION_KEY, chunkArray } from "./db";
import type {
  UserRow,
  UserCodeRef,
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
  ProfileSubmissionFileOwner,
  MediaFileRef,
  ClassGroupRow,
  ClassGroupMemberRow,
  ClassGroupingInput,
  GroupBatchRow,
  GroupBatchGroupRow,
  GroupBatchMemberRow,
  NewGroupBatchInput,
  GroupWorkspaceRow,
  GroupPostRow,
  GroupTaskRow,
  GroupWorkspaceReadRow,
  GroupWorkspaceContext,
  StudentWorkspaceSummary,
  NewGroupPostInput,
  NewGroupTaskInput,
  GroupPostUpdateFields,
  GroupTaskUpdateFields,
  TrendPoint,
  CompareStat,
  ClassTrendSeries,
  ClassRosterRow,
  AssessmentRow,
  AssessmentQuestionRow,
  AssessmentResultRow,
  AssessmentResultSummary,
  CompleteAssessmentInput,
  OnetOccupationRow,
  AssessmentStatsRaw,
  CompletionStatsRaw,
  DimensionalResultScoreRow,
  AssessmentRosterRow,
  AssessmentMissingRosterRow,
  AssessmentBankUpgradeResult,
  SubmittedProfileFilters,
} from "./db";
import {
  fillClassTrend,
  fillTrendSeries,
  mapCompareRows,
  shiftDate,
  type RawClassTrendRow,
  type RawCompareRow,
} from "./stats-utils";
import {
  buildCompletionStatsSql,
  mapCompletionStatsRows,
  type CompletionStatsRow,
} from "./completion-query";

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
        evaluation_text TEXT,
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
    this.migrateGroupSchema();
    this.migrateAssessmentSchema();
    this.seedAssessments();
    // #281：旧库补题 + 只回填 origin + 定义级字段随 scale_version 更新（只增不改）
    this.upgradeAssessmentBank();
    this.migrateOnetSchema();
    try {
      this.seedOnetOccupations();
    } catch (err) {
      // 只读参考数据灌库失败不应拖垮全站启动：职业库为空时推荐接口返回 503，
      // 下次 init() 会重试（判据仍是版本标记 + 行数）。推荐是渐进功能，降级可见即可。
      console.error("O*NET occupations seed failed (career recommendations degraded):", err);
    }
  }

  /**
   * 分组五表（#101）：**当前分组（可写）与历史批次（只追加）物理分离**。
   * 当前侧刻意不用 is_current —— 手工调整直接改、自动分组整体覆盖，避免「改一下就要存版本」的负担；
   * 历史侧只存自动分组的结果，故成员的姓名/学号做快照（账号删除后仍可读）。
   */
  private migrateGroupSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS class_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES classes(id),
        group_no INTEGER NOT NULL,
        leader_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
        created_at TEXT NOT NULL,
        UNIQUE(class_id, group_no)
      )
    `);
    // user_id 全局唯一：一个学生同时只能属于一个当前组（转班/删人时必须清理旧行，否则此处会拦住并报错）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS class_group_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        group_id INTEGER NOT NULL REFERENCES class_groups(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        created_at TEXT NOT NULL,
        UNIQUE(user_id),
        UNIQUE(group_id, user_id)
      )
    `);
    // feature_sources：本次用到的特征源（key/kind/weight）。新增数据源只需扩充这一列，不动其余结构
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_batches (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES classes(id),
        strategy TEXT NOT NULL,
        feature_sources TEXT,
        group_size INTEGER NOT NULL,
        student_count INTEGER NOT NULL,
        tagged_count INTEGER NOT NULL,
        metrics TEXT,
        created_by_id INTEGER,
        created_by_name TEXT,
        created_by_role TEXT,
        created_at TEXT NOT NULL
      )
    `);
    // cohesion 为组内平均相似度的**快照**：标签会随时间变，事后算不出当时的质量
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_batch_groups (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES group_batches(id),
        group_no INTEGER NOT NULL,
        cohesion REAL,
        member_count INTEGER NOT NULL,
        leader_user_id INTEGER,
        created_at TEXT NOT NULL,
        UNIQUE(batch_id, group_no)
      )
    `);
    // 刻意**不加** user_id 外键：历史批次要保留已删/已转出学生的快照（姓名/学号），
    // 加外键会让删除学生失败，与「历史只追加、永久保留」冲突
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_batch_members (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_id INTEGER NOT NULL REFERENCES group_batches(id),
        group_id INTEGER NOT NULL REFERENCES group_batch_groups(id),
        user_id INTEGER NOT NULL,
        user_code TEXT,
        name TEXT,
        created_at TEXT NOT NULL,
        UNIQUE(batch_id, user_id)
      )
    `);
    // 小组工作区（#346）：锚定**批次内的组**而不是批次头——同批多个组各有公告/任务，
    // 共用一个工作区会把别组内容暴露给本组。重分组追加新批次 → 新工作区，旧批次只读。
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_workspaces (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        class_id INTEGER NOT NULL REFERENCES classes(id),
        batch_id INTEGER NOT NULL REFERENCES group_batches(id),
        batch_group_id INTEGER NOT NULL REFERENCES group_batch_groups(id),
        group_no INTEGER NOT NULL,
        title TEXT NOT NULL,
        created_at TEXT NOT NULL,
        UNIQUE(batch_group_id)
      )
    `);
    // 公告：作者姓名/角色做快照；deleted_at 软删除（保留审计链）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_posts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES group_workspaces(id),
        author_id INTEGER,
        author_name TEXT,
        author_role TEXT,
        title TEXT NOT NULL,
        content TEXT NOT NULL,
        pinned INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        deleted_at TEXT
      )
    `);
    // 任务：认领人姓名做快照；status 只接受 open / in_progress / done（路由层校验）
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES group_workspaces(id),
        title TEXT NOT NULL,
        description TEXT,
        assignee_id INTEGER,
        assignee_name TEXT,
        status TEXT NOT NULL DEFAULT 'open',
        due_at TEXT,
        created_by_id INTEGER,
        created_by_name TEXT,
        created_by_role TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        deleted_at TEXT
      )
    `);
    // 已读水位：未读红点按「水位之后的公告数」算；唯一约束让 upsert 两库语义一致
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS group_workspace_reads (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workspace_id INTEGER NOT NULL REFERENCES group_workspaces(id),
        user_id INTEGER NOT NULL REFERENCES users(id),
        last_read_at TEXT NOT NULL,
        last_read_post_id INTEGER NOT NULL DEFAULT 0,
        UNIQUE(workspace_id, user_id)
      )
    `);
    // 增量补列（#346 首版只有 last_read_at）：旧库缺列时补上，水位从 0 起算
    const readColumns = this.db.prepare("PRAGMA table_info(group_workspace_reads)").all() as { name: string }[];
    if (!readColumns.some((column) => column.name === "last_read_post_id")) {
      this.db.exec("ALTER TABLE group_workspace_reads ADD COLUMN last_read_post_id INTEGER NOT NULL DEFAULT 0");
    }
    // #345 补列：旧库（#101 时期创建）没有组长列。SQLite 的 ALTER TABLE 只能加可空列，
    // 正好符合「组长可空」的语义；新库由上面的 CREATE TABLE 直接带列。
    const classGroupColumns = this.db.prepare("PRAGMA table_info(class_groups)").all() as { name: string }[];
    if (!classGroupColumns.some((column) => column.name === "leader_user_id")) {
      this.db.exec(
        "ALTER TABLE class_groups ADD COLUMN leader_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL"
      );
    }
    // 组长必须在本组：旧库没有外键覆盖转班路径、早期数据也可能留下指向非成员的组长，启动时修掉
    this.db.exec(`
      UPDATE class_groups
         SET leader_user_id = NULL
       WHERE leader_user_id IS NOT NULL
         AND NOT EXISTS (
           SELECT 1 FROM class_group_members m
            WHERE m.group_id = class_groups.id AND m.user_id = class_groups.leader_user_id
         )
    `);
    const batchGroupColumns = this.db.prepare("PRAGMA table_info(group_batch_groups)").all() as { name: string }[];
    if (!batchGroupColumns.some((column) => column.name === "leader_user_id")) {
      this.db.exec("ALTER TABLE group_batch_groups ADD COLUMN leader_user_id INTEGER");
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_class_groups_class ON class_groups(class_id)`);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_class_group_members_group ON class_group_members(group_id)`
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_class_group_members_user ON class_group_members(user_id)`
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_group_batches_class ON group_batches(class_id, created_at)`
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_group_batch_groups_batch ON group_batch_groups(batch_id)`
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_group_batch_members_batch ON group_batch_members(batch_id)`
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_group_batch_members_user ON group_batch_members(user_id)`
    );
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_group_workspaces_class ON group_workspaces(class_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_group_workspaces_batch ON group_workspaces(batch_id)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_group_posts_workspace ON group_posts(workspace_id, created_at)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_group_tasks_workspace ON group_tasks(workspace_id, status)`);
    // 旧库升级（#346 之前已有批次）：为存量批次组补建工作区，避免上线后「已分组但没有工作区」。
    // 幂等：仅补 NOT EXISTS 的组；标题与新建工作区保持同一口径。历史批次的工作区天然只读。
    this.db.exec(`
      INSERT INTO group_workspaces (class_id, batch_id, batch_group_id, group_no, title, created_at)
      SELECT b.class_id, bg.batch_id, bg.id, bg.group_no,
             '第 ' || bg.group_no || ' 组工作区',
             COALESCE(b.created_at, datetime('now', 'localtime'))
        FROM group_batch_groups bg
        JOIN group_batches b ON b.id = bg.batch_id
       WHERE NOT EXISTS (SELECT 1 FROM group_workspaces w WHERE w.batch_group_id = bg.id)
    `);
  }

  /**
   * 职业测评三表（#221）：
   * 1) `assessments` 测评定义（维度 JSON / 计分类型 / 量表版本 / 署名与授权文本）
   * 2) `assessment_questions` 题库（题号 + 题干 + 维度 + 反向计分 + 题面版本）
   * 3) `assessment_results` 作答与结果**快照**（草稿与完成记录同表，`is_current` 标当前完成版本）
   *
   * 设计要点：
   * - 题库进库而非写死代码：扩充量表、后台维护题面都不必改代码；
   * - 结果是快照（作答 + 得分 JSON 落库），学生半年后回看仍是当时结论，不随后续改题漂移；
   * - 抽题口径（#282）：`assessments.items_per_attempt` 声明每次作答题数（0 = 整库作答），
   *   `assessment_results.items_json` 落本轮抽题快照（题序 = 展示序），历史结果据此还原当轮题量；
   * - 草稿唯一性（同 user + 量表至多一条 in_progress）靠可空的 `draft_slot` + 唯一约束兜住：
   *   草稿恒填 1、完成记录置 NULL，两库都允许多个 NULL，行为一致（MySQL 无部分唯一索引，
   *   这是可移植的等价物，不再只靠「先查再写」的事务）；
   * - `user_id` / `assessment_id` 只写 REFERENCES 不建 ON DELETE CASCADE，与其余表一致。
   */
  private migrateAssessmentSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assessments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        question_count INTEGER NOT NULL,
        items_per_attempt INTEGER NOT NULL DEFAULT 0,
        dimensions_json TEXT NOT NULL,
        scoring_mode TEXT NOT NULL DEFAULT 'typological',
        scale_version TEXT NOT NULL,
        attribution TEXT NOT NULL,
        license_text TEXT NOT NULL,
        disclaimer TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assessment_questions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        assessment_id INTEGER NOT NULL REFERENCES assessments(id),
        question_index INTEGER NOT NULL,
        prompt TEXT NOT NULL,
        dimension TEXT NOT NULL,
        origin TEXT NOT NULL DEFAULT 'cn-original',
        reverse_scored INTEGER NOT NULL DEFAULT 0,
        version INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL,
        UNIQUE(assessment_id, question_index)
      )
    `);
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS assessment_results (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL REFERENCES users(id),
        assessment_id INTEGER NOT NULL REFERENCES assessments(id),
        status TEXT NOT NULL DEFAULT 'in_progress',
        answers_json TEXT NOT NULL,
        items_json TEXT NOT NULL DEFAULT '[]',
        scores_json TEXT,
        type_code TEXT,
        is_current INTEGER NOT NULL DEFAULT 0,
        draft_slot INTEGER,
        started_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        completed_at TEXT,
        UNIQUE(user_id, assessment_id, draft_slot)
      )
    `);
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_assessment_results_user ON assessment_results(user_id, assessment_id, status)`
    );
    this.db.exec(
      `CREATE INDEX IF NOT EXISTS idx_assessment_results_current ON assessment_results(user_id, assessment_id, is_current)`
    );
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_assessment_results_assessment ON assessment_results(assessment_id)`);
    // #281 补列：旧库（#221 时期创建）没有 origin，SQLite 的 ALTER TABLE 只能加可空/带默认值的列
    const columns = this.db.prepare("PRAGMA table_info(assessment_questions)").all() as { name: string }[];
    if (!columns.some((column) => column.name === "origin")) {
      this.db.exec("ALTER TABLE assessment_questions ADD COLUMN origin TEXT NOT NULL DEFAULT 'cn-original'");
    }
    // #282 补列：旧库没有抽题两列（每次作答量默认 0 = 全量作答；抽题快照默认空数组 = 全库即本轮）
    const assessmentColumns = this.db.prepare("PRAGMA table_info(assessments)").all() as { name: string }[];
    if (!assessmentColumns.some((column) => column.name === "items_per_attempt")) {
      this.db.exec("ALTER TABLE assessments ADD COLUMN items_per_attempt INTEGER NOT NULL DEFAULT 0");
    }
    const resultColumns = this.db.prepare("PRAGMA table_info(assessment_results)").all() as { name: string }[];
    if (!resultColumns.some((column) => column.name === "items_json")) {
      this.db.exec("ALTER TABLE assessment_results ADD COLUMN items_json TEXT NOT NULL DEFAULT '[]'");
    }
  }

  /**
   * 量表种子（#221）：以 `code` 存在性 + 题库题数判定——题面被后台维护过（非空）就完全不碰；
   * 只补两种残缺态：量表行缺失，或量表行存在但题库为空（例如恢复了一份 `assessment_questions: []` 的备份）。
   * 落库前用 `validateAssessmentSeed` 自检，坏种子在安装时报错而不是留半截题库。
   */
  private seedAssessments(): void {
    const findAssessment = this.db.prepare("SELECT id FROM assessments WHERE code = ?");
    const countQuestions = this.db.prepare(
      "SELECT COUNT(*) as c FROM assessment_questions WHERE assessment_id = ?"
    );
    const updateQuestionCount = this.db.prepare("UPDATE assessments SET question_count = ?, updated_at = ? WHERE id = ?");
    const insertAssessment = this.db.prepare(
      `INSERT INTO assessments
         (code, name, question_count, items_per_attempt, dimensions_json, scoring_mode, scale_version,
          attribution, license_text, disclaimer, enabled, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)`
    );
    const insertQuestion = this.db.prepare(
      `INSERT INTO assessment_questions
         (assessment_id, question_index, prompt, dimension, origin, reverse_scored, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    );
    const insertQuestions = (assessmentId: number, questions: readonly QuestionSeed[], now: string) => {
      for (const question of questions) {
        insertQuestion.run(
          assessmentId,
          question.index,
          question.prompt,
          question.dimension,
          question.origin,
          question.reverseScored ? 1 : 0,
          now
        );
      }
    };

    const seed = this.db.transaction(() => {
      for (const definition of ASSESSMENT_SEEDS) {
        const questions = getQuestionSeeds(definition.code);
        if (!questions) throw new Error(`量表 ${definition.code} 缺少题库种子`);
        // 落库前自检：坏种子宁可安装时报错，也不留半截题库（#281 起含 anchor 与近重复校验）
        validateAssessmentSeed(definition, questions, onetInterestCodeOf);

        const existing = findAssessment.get(definition.code) as { id: number } | undefined;
        if (existing) {
          const { c } = countQuestions.get(existing.id) as { c: number };
          if (c > 0) continue; // 后台维护过的题库：绝不覆盖
          // 题库为空：只补种题库并校正题数，不动其它字段（题面/署名等可能已被后台改过）
          const now = getNow();
          updateQuestionCount.run(questions.length, now, existing.id);
          insertQuestions(existing.id, questions, now);
          continue;
        }

        const now = getNow();
        const result = insertAssessment.run(
          definition.code,
          definition.name,
          definition.questionCount,
          definition.itemsPerAttempt,
          JSON.stringify(definition.dimensions),
          definition.scoringMode,
          definition.scaleVersion,
          definition.attribution,
          definition.licenseText,
          definition.disclaimer,
          now,
          now
        );
        insertQuestions(Number(result.lastInsertRowid), questions, now);
      }
    });
    seed();
  }

  /**
   * 题库**只增不改**升级（#281）：生产库已有的题库由 `seedAssessments` 的「非空一律不碰」保护，
   * 所以扩库必须另走这里，且**只允许五种写动作**：
   * 1. 缺失的题号 → INSERT；
   * 2. 已存在的题号 → **只回填 `origin`**（`prompt` / `dimension` / `version` 一个字节都不动，
   *    后台维护过的题面神圣不可侵犯）；
   * 3. 量表定义字段 → 仅当 `scale_version` 与种子不一致时整体更新（名字/题数/署名/授权/免责）；
   * 4. `items_per_attempt`（#282）→ 与版本号无关，只要与种子不一致就只回填这一列；
   * 5. `license_text`（#284）→ 合规文案与版本号无关，同版本库与种子不一致时只刷新这一列。
   *
   * 写之前跑新版 `validateAssessmentSeed`（含 anchor 与近重复校验）；全程单事务。
   * 重复执行幂等：第二次没有缺题、origin 已一致、版本号 / 每次题量 / 授权文案都已一致，什么都不改。
   */
  upgradeAssessmentBank(): AssessmentBankUpgradeResult {
    const result: AssessmentBankUpgradeResult = {
      inserted: 0,
      originBackfilled: 0,
      definitionUpdated: false,
      licenseTextUpdated: false,
      itemsPerAttemptUpdated: false,
    };
    const findAssessment = this.db.prepare("SELECT * FROM assessments WHERE code = ?");
    const listQuestions = this.db.prepare(
      "SELECT question_index, origin FROM assessment_questions WHERE assessment_id = ?"
    );
    const insertQuestion = this.db.prepare(
      `INSERT INTO assessment_questions
         (assessment_id, question_index, prompt, dimension, origin, reverse_scored, version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
    );
    const updateOrigin = this.db.prepare(
      "UPDATE assessment_questions SET origin = ? WHERE assessment_id = ? AND question_index = ?"
    );
    const updateDefinition = this.db.prepare(
      `UPDATE assessments
          SET name = ?, question_count = ?, scale_version = ?, attribution = ?, license_text = ?, disclaimer = ?, updated_at = ?
        WHERE id = ?`
    );
    // #282：旧库的 items_per_attempt 由补列默认值给 0，与种子不一致时**只回填这一列**
    // （不并入上面整条定义 UPDATE——同版本库里后台改过的名字/署名不能被顺带覆盖）
    const updateItemsPerAttempt = this.db.prepare(
      "UPDATE assessments SET items_per_attempt = ?, updated_at = ? WHERE id = ?"
    );
    // #284：授权与放行状态文案随合规要求变化，与 scale_version 无关；同版本库只刷新这一列，
    // 避免整条定义 UPDATE 把后台维护的 name / attribution 顺带覆盖
    const updateLicenseText = this.db.prepare(
      "UPDATE assessments SET license_text = ?, updated_at = ? WHERE id = ?"
    );

    const upgrade = this.db.transaction(() => {
      for (const definition of ASSESSMENT_SEEDS) {
        const questions = getQuestionSeeds(definition.code);
        if (!questions) throw new Error(`量表 ${definition.code} 缺少题库种子`);
        validateAssessmentSeed(definition, questions, onetInterestCodeOf);

        // 量表行不存在 = 全新库，由 seedAssessments 负责；这里只管「已有行」的升级
        const existing = findAssessment.get(definition.code) as AssessmentRow | undefined;
        if (!existing) continue;

        const existingQuestions = new Map(
          (listQuestions.all(existing.id) as { question_index: number; origin: string }[]).map((row) => [
            row.question_index,
            row.origin,
          ])
        );
        const now = getNow();
        for (const question of questions) {
          const currentOrigin = existingQuestions.get(question.index);
          if (currentOrigin === undefined) {
            insertQuestion.run(
              existing.id,
              question.index,
              question.prompt,
              question.dimension,
              question.origin,
              question.reverseScored ? 1 : 0,
              now
            );
            result.inserted += 1;
            continue;
          }
          if (currentOrigin !== question.origin) {
            updateOrigin.run(question.origin, existing.id, question.index);
            result.originBackfilled += 1;
          }
        }

        if (existing.scale_version !== definition.scaleVersion) {
          updateDefinition.run(
            definition.name,
            definition.questionCount,
            definition.scaleVersion,
            definition.attribution,
            definition.licenseText,
            definition.disclaimer,
            now,
            existing.id
          );
          result.definitionUpdated = true;
        } else if (existing.license_text !== definition.licenseText) {
          updateLicenseText.run(definition.licenseText, now, existing.id);
          result.licenseTextUpdated = true;
        }

        // #282：`items_per_attempt` 与 scale_version 无关也要补齐——生产库在 #281 时已是
        // 「RIASEC-CN 2.0」，只有补列默认值 0（= 整库作答），不回填就永远进不了抽题口径。
        if (existing.items_per_attempt !== definition.itemsPerAttempt) {
          updateItemsPerAttempt.run(definition.itemsPerAttempt, now, existing.id);
          result.itemsPerAttemptUpdated = true;
        }
      }
    });
    upgrade();
    return result;
  }

  /**
   * O*NET 职业库（#226）：**只读参考数据**，来自离线快照（`src/lib/onet-data.ts`）。
   *
   * 与量表种子（`seedAssessments`）不同：职业库是整批发布的，没有「后台维护」的语义，
   * 所以判据是「快照版本标记 + 行数」，快照升级时**整表重灌**（避免新旧职业混在一起）；
   * 平时每次 init 只做两条轻查询就跳过。不纳入备份：可离线重灌，且体量远大于业务数据。
   */
  private migrateOnetSchema(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS onet_occupations (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        code TEXT NOT NULL UNIQUE,
        name TEXT NOT NULL,
        name_zh TEXT,
        interest_code TEXT NOT NULL,
        interests_json TEXT NOT NULL,
        job_zone INTEGER NOT NULL,
        education_level TEXT NOT NULL,
        cluster TEXT NOT NULL,
        dataset_version TEXT NOT NULL,
        created_at TEXT NOT NULL
      )
    `);
  }

  /** 职业库种子：按快照版本幂等整表重灌（判据见 `needsOnetReseed`，两适配器共用） */
  private seedOnetOccupations(): void {
    const seeds = getOnetOccupationSeeds();
    const marker = this.db
      .prepare("SELECT value FROM configs_profile WHERE key = ?")
      .get(ONET_SEED_MARKER_KEY) as { value: string } | undefined;
    const { c } = this.db.prepare("SELECT COUNT(*) as c FROM onet_occupations").get() as { c: number };
    if (!needsOnetReseed(marker?.value, c, seeds.length)) return;

    const insert = this.db.prepare(
      `INSERT INTO onet_occupations
         (code, name, name_zh, interest_code, interests_json, job_zone, education_level, cluster, dataset_version, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );
    const now = getNow();
    const tx = this.db.transaction(() => {
      this.db.exec("DELETE FROM onet_occupations");
      for (const seed of seeds) {
        insert.run(
          seed.code,
          seed.name,
          seed.nameZh,
          seed.interestCode,
          JSON.stringify(seed.scores),
          seed.jobZone,
          seed.educationLevel,
          seed.cluster,
          seed.datasetVersion,
          now
        );
      }
    });
    tx();
    this.setProfileConfig(ONET_SEED_MARKER_KEY, ONET_DATASET_VERSION);
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
    if (!columns.some((c) => c.name === "evaluation_text")) {
      this.db.exec("ALTER TABLE users ADD COLUMN evaluation_text TEXT");
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
        evaluation_text TEXT,
        storage_id INTEGER NOT NULL DEFAULT 1,
        submitted_at TEXT NOT NULL,
        is_current INTEGER NOT NULL DEFAULT 0
      )
    `);
    const columns = this.db.prepare("PRAGMA table_info(profile_submissions)").all() as { name: string }[];
    if (!columns.some((c) => c.name === "evaluation_text")) {
      this.db.exec("ALTER TABLE profile_submissions ADD COLUMN evaluation_text TEXT");
    }
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ps_user_version ON profile_submissions(user_id, version)`);
    this.db.exec(`CREATE INDEX IF NOT EXISTS idx_ps_user_current ON profile_submissions(user_id, is_current)`);
    this.db.exec(`
      INSERT OR IGNORE INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, evaluation_text, storage_id, submitted_at, is_current)
      SELECT u.id, 1, u.tags, u.avatar_url, u.evaluation_url, u.evaluation_text, u.storage_id, u.submitted_at, 1
      FROM users u
      WHERE u.role = 'student' AND u.submitted_at IS NOT NULL
        AND u.id NOT IN (SELECT user_id FROM profile_submissions)
    `);
    this.db
      .prepare("INSERT OR IGNORE INTO configs_profile (key, value, updated_at) VALUES (?, ?, ?)")
      .run(MAX_PROFILE_SUBMISSIONS_KEY, String(DEFAULT_MAX_PROFILE_SUBMISSIONS), getNow());
    // 孤儿文件保留期默认值（#117，INSERT OR IGNORE 不覆盖配置）
    this.db
      .prepare("INSERT OR IGNORE INTO configs_profile (key, value, updated_at) VALUES (?, ?, ?)")
      .run(MEDIA_ORPHAN_RETENTION_KEY, String(DEFAULT_MEDIA_ORPHAN_RETENTION_DAYS), getNow());
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
            tagsJson = JSON.stringify(names);
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

  getUsersByCodes(userCodes: string[]): UserCodeRef[] {
    if (userCodes.length === 0) return [];
    const rows: UserCodeRef[] = [];
    for (const chunk of chunkArray([...new Set(userCodes)])) {
      const placeholders = chunk.map(() => "?").join(",");
      // 只取标识与班级归属：批量导入不需要整行（尤其不把 password_hash 带进内存）
      rows.push(
        ...(this.db
          .prepare(`SELECT id, user_code, class_id FROM users WHERE user_code IN (${placeholders})`)
          .all(...chunk) as UserCodeRef[])
      );
    }
    return rows;
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
    // 摘除旧班归属与改 users 必须同事务：分两步写中途失败会留下「人已换班、成员行还挂在旧班」的脏归属
    const tx = this.db.transaction(() => {
      // 分组（#101）：**转班**时先摘掉旧班的当前分组归属。
      // 不清理会撞 class_group_members 的 UNIQUE(user_id)，且学生会同时出现在两个班的名单里
      if (fields.class_id !== undefined) {
        const current = this.db.prepare("SELECT class_id FROM users WHERE id = ?").get(id) as
          | { class_id: number | null }
          | undefined;
        if (current && current.class_id !== fields.class_id) {
          // #345：转班后组长必须仍是本组成员，先清组长位再摘成员行（同一事务）
          this.db.prepare("UPDATE class_groups SET leader_user_id = NULL WHERE leader_user_id = ?").run(id);
          this.db.prepare("DELETE FROM class_group_members WHERE user_id = ?").run(id);
        }
      }
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
    });
    tx();
  }

  deleteStudents(userCodes: string[]): number {
    if (userCodes.length === 0) return 0;
    const placeholders = userCodes.map(() => "?").join(",");
    const tx = this.db.transaction(() => {
      // 分组（#101）：只清「当前分组」的成员行；历史批次保留快照（姓名/学号冗余，账号删除后仍可读）
      // #345：删学生时组长位一并清空（新库有外键 SET NULL，这里显式清是为了两库与旧库行为一致）
      this.db
        .prepare(
          `UPDATE class_groups SET leader_user_id = NULL
            WHERE leader_user_id IN (SELECT id FROM users WHERE user_code IN (${placeholders}))`
        )
        .run(...userCodes);
      this.db
        .prepare(
          `DELETE FROM class_group_members WHERE user_id IN (SELECT id FROM users WHERE user_code IN (${placeholders}))`
        )
        .run(...userCodes);
      // 测评作答（#221）：属学生个人测评数据，账号删除即无归属方，随手一并清掉（不留悬空 user_id）
      this.db
        .prepare(
          `DELETE FROM assessment_results WHERE user_id IN (SELECT id FROM users WHERE user_code IN (${placeholders}))`
        )
        .run(...userCodes);
      // 小组已读水位（#346）：按 user_id 引用 users，删学生前清掉，避免外键拦住删除
      this.db
        .prepare(
          `DELETE FROM group_workspace_reads WHERE user_id IN (SELECT id FROM users WHERE user_code IN (${placeholders}))`
        )
        .run(...userCodes);
      return this.db
        .prepare(`DELETE FROM users WHERE role = 'student' AND user_code IN (${placeholders})`)
        .run(...userCodes).changes;
    });
    return tx();
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
  upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, evaluationText: string | null, storageId: number): void {
    this.db
      .prepare(
        `UPDATE users SET tags = ?, avatar_url = ?, evaluation_url = ?, evaluation_text = ?, submitted_at = ?, storage_id = ?
         WHERE role = 'student' AND user_code = ?`
      )
      .run(tagsJson, avatarUrl, evaluationUrl, evaluationText, getNow(), storageId, userCode);
  }

  getSubmittedProfiles(
    page: number = 1,
    pageSize: number = 20,
    filters?: SubmittedProfileFilters
  ): { rows: UserRow[]; total: number } {
    // #295：筛选 / 排序 / 分页全部下推数据库（跨页数据也能被筛到）；不传 filters 时与改造前等价。
    // WHERE / ORDER BY 由 `buildSubmittedProfilesSql` 统一生成，两适配器口径不会分叉。
    const { whereSql, params, orderBySql } = buildSubmittedProfilesSql("sqlite", filters, RIASEC_CODE);
    const offset = (page - 1) * pageSize;
    const total = (
      this.db.prepare(`SELECT COUNT(*) as c FROM users u WHERE ${whereSql}`).get(...params) as { c: number }
    ).c;
    const rows = this.db
      .prepare(`SELECT u.* FROM users u WHERE ${whereSql} ORDER BY ${orderBySql} LIMIT ? OFFSET ?`)
      .all(...params, pageSize, offset) as UserRow[];
    return { rows, total };
  }

  getSubmittedProfilesForExport(filters?: SubmittedProfileFilters): UserRow[] {
    // #331：与列表共用同一份 WHERE / ORDER BY，只是不套 LIMIT/OFFSET（导出「当前筛选结果」含所有页）
    const { whereSql, params, orderBySql } = buildSubmittedProfilesSql("sqlite", filters, RIASEC_CODE);
    return this.db
      .prepare(`SELECT u.* FROM users u WHERE ${whereSql} ORDER BY ${orderBySql}`)
      .all(...params) as UserRow[];
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
    const tx = this.db.transaction(() => {
      const result = this.db
        .prepare(
          `UPDATE users SET tags = NULL, avatar_url = NULL, evaluation_url = NULL, evaluation_text = NULL, submitted_at = NULL
           WHERE role = 'student' AND user_code IN (${placeholders})`
        )
        .run(...userCodes);
      // #95 review 修复：同步清除历史版本快照，防止删除档案后学生仍可查看/恢复历史（绕过删除）
      this.db
        .prepare(
          `DELETE FROM profile_submissions WHERE user_id IN (
             SELECT id FROM users WHERE role = 'student' AND user_code IN (${placeholders})
           )`
        )
        .run(...userCodes);
      return result.changes;
    });
    return tx();
  }

  // profile_submissions（档案提交历史版本，#95）
  insertProfileSubmission(userId: number, version: number, data: ProfileSubmissionData): number {
    const result = this.db
      .prepare(
        `INSERT INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, evaluation_text, storage_id, submitted_at, is_current)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        userId,
        version,
        data.tags,
        data.avatar_url,
        data.evaluation_url,
        data.evaluation_text,
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

  getProfileSubmissionOwnerByFileUrl(url: string): ProfileSubmissionFileOwner | undefined {
    return this.db
      .prepare(
        `SELECT ps.user_id, u.class_id, ps.storage_id
         FROM profile_submissions ps JOIN users u ON u.id = ps.user_id
         WHERE ps.avatar_url = ? OR ps.evaluation_url = ?
         ORDER BY ps.id DESC LIMIT 1`
      )
      .get(url, url) as ProfileSubmissionFileOwner | undefined;
  }

  getAllReferencedMedia(): MediaFileRef[] {
    return this.db
      .prepare(
        `SELECT avatar_url AS url, storage_id AS storageId, user_code AS userCode, name AS userName FROM users
         WHERE role = 'student' AND submitted_at IS NOT NULL AND avatar_url IS NOT NULL AND avatar_url != ''
         UNION ALL
         SELECT evaluation_url AS url, storage_id AS storageId, user_code AS userCode, name AS userName FROM users
         WHERE role = 'student' AND submitted_at IS NOT NULL AND evaluation_url IS NOT NULL AND evaluation_url != ''
         UNION ALL
         SELECT ps.avatar_url AS url, ps.storage_id AS storageId, u.user_code AS userCode, u.name AS userName
         FROM profile_submissions ps JOIN users u ON u.id = ps.user_id
         WHERE ps.avatar_url IS NOT NULL AND ps.avatar_url != ''
         UNION ALL
         SELECT ps.evaluation_url AS url, ps.storage_id AS storageId, u.user_code AS userCode, u.name AS userName
         FROM profile_submissions ps JOIN users u ON u.id = ps.user_id
         WHERE ps.evaluation_url IS NOT NULL AND ps.evaluation_url != ''`
      )
      .all() as MediaFileRef[];
  }

  submitProfileWithVersion(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, evaluationText: string | null, storageId: number, submittedAt?: string): { version: number } {
    const tx = this.db.transaction(() => {
      const user = this.db
        .prepare("SELECT id FROM users WHERE role = 'student' AND user_code = ?")
        .get(userCode) as { id: number } | undefined;
      if (!user) throw new Error("学生不存在：" + userCode);
      // 1) UPDATE users（不变）
      this.db
        .prepare("UPDATE users SET tags = ?, avatar_url = ?, evaluation_url = ?, evaluation_text = ?, submitted_at = ?, storage_id = ? WHERE id = ?")
        .run(tagsJson, avatarUrl, evaluationUrl, evaluationText, submittedAt ?? getNow(), storageId, user.id);
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
          `INSERT INTO profile_submissions (user_id, version, tags, avatar_url, evaluation_url, evaluation_text, storage_id, submitted_at, is_current)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`
        )
        .run(user.id, nextVersion, tagsJson, avatarUrl, evaluationUrl, evaluationText, storageId, submittedAt ?? getNow());
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
        for (const entry of JSON.parse(row.tags) as (string | number)[]) {
          const name = typeof entry === "string" ? entry : idToName.get(entry);
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

  getTrends(days: number): TrendPoint[] {
    const start = shiftDate(getToday(), -(days - 1));
    const end = shiftDate(getToday(), 1);
    const rows = this.db
      .prepare(
        `SELECT DATE(submitted_at) as d, COUNT(*) as c FROM users
         WHERE role = 'student' AND submitted_at >= ? AND submitted_at < ?
         GROUP BY DATE(submitted_at) ORDER BY d`
      )
      .all(start, end) as { d: string; c: number }[];
    return fillTrendSeries(
      rows.map((r) => ({ date: r.d, count: r.c })),
      start,
      days
    );
  }

  getTrendsByClass(days: number): ClassTrendSeries {
    const start = shiftDate(getToday(), -(days - 1));
    const end = shiftDate(getToday(), 1);
    // 按 classes.id 分组：NULL 自成一组，再用哨兵键与真实班名区分（#260）
    const rows = this.db
      .prepare(
        `SELECT DATE(u.submitted_at) AS d, c.id AS class_id, c.name AS class_name, COUNT(*) AS cnt
         FROM users u LEFT JOIN classes c ON u.class_id = c.id
         WHERE u.role = 'student' AND u.submitted_at >= ? AND u.submitted_at < ?
         GROUP BY d, c.id, c.name
         ORDER BY CASE WHEN c.id IS NULL THEN 1 ELSE 0 END, c.name, d`
      )
      .all(start, end) as RawClassTrendRow[];
    return fillClassTrend(rows, start, days);
  }

  getCompareByClass(): CompareStat[] {
    // 分母口径：按 users 分组统计在册学生，不按提交过滤，故零提交班级也可见
    const rows = this.db
      .prepare(
        `SELECT c.id AS class_id, c.name AS class_name, COUNT(*) AS total,
                SUM(CASE WHEN u.submitted_at IS NOT NULL THEN 1 ELSE 0 END) AS submitted
         FROM users u LEFT JOIN classes c ON u.class_id = c.id
         WHERE u.role = 'student'
         GROUP BY c.id, c.name
         ORDER BY CASE WHEN c.id IS NULL THEN 1 ELSE 0 END, c.name`
      )
      .all() as RawCompareRow[];
    return mapCompareRows(rows);
  }

  getClassRoster(classId: number | null): ClassRosterRow[] {
    // 与 compare 的 NULL 分组严格互补；未提交置顶，其余按学号升序。
    // submitted_at 的空串视为未提交，避免脏数据把空时间显示成「已提交」。
    const orderBy = `ORDER BY CASE WHEN u.submitted_at IS NULL OR TRIM(u.submitted_at) = '' THEN 0 ELSE 1 END,
                  u.user_code`;
    if (classId === null) {
      return this.db
        .prepare(
          `SELECT u.name, u.user_code, u.submitted_at, u.tags
           FROM users u LEFT JOIN classes c ON u.class_id = c.id
           WHERE u.role = 'student' AND c.id IS NULL
           ${orderBy}`
        )
        .all() as ClassRosterRow[];
    }
    return this.db
      .prepare(
        `SELECT u.name, u.user_code, u.submitted_at, u.tags
         FROM users u JOIN classes c ON u.class_id = c.id
         WHERE u.role = 'student' AND c.id = ?
         ${orderBy}`
      )
      .all(classId) as ClassRosterRow[];
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
    return this.getClasses().find((c) => c.name === name);
  }

  getClassById(id: number): ClassRow | undefined {
    return this.db.prepare("SELECT * FROM classes WHERE id = ?").get(id) as ClassRow | undefined;
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
    // 建表只写 REFERENCES、没有 ON DELETE CASCADE：外键在这里的作用是「拦住删除」而不是「替我级联」，
    // 依赖它只会得到 FOREIGN KEY constraint failed，所以事务内按子→父顺序显式清理关联数据
    const tx = this.db.transaction((classId: number) => {
      // 小组工作区（#346）：公告/任务/已读水位 → 工作区 → 批次组，按子→父顺序清理
      this.db
        .prepare(
          "DELETE FROM group_posts WHERE workspace_id IN (SELECT id FROM group_workspaces WHERE class_id = ?)"
        )
        .run(classId);
      this.db
        .prepare(
          "DELETE FROM group_tasks WHERE workspace_id IN (SELECT id FROM group_workspaces WHERE class_id = ?)"
        )
        .run(classId);
      this.db
        .prepare(
          "DELETE FROM group_workspace_reads WHERE workspace_id IN (SELECT id FROM group_workspaces WHERE class_id = ?)"
        )
        .run(classId);
      this.db.prepare("DELETE FROM group_workspaces WHERE class_id = ?").run(classId);
      // 分组（#101）：当前分组与历史批次一并清理（分类消失后它们没有归属方）；子→父顺序
      this.db
        .prepare(
          "DELETE FROM group_batch_members WHERE batch_id IN (SELECT id FROM group_batches WHERE class_id = ?)"
        )
        .run(classId);
      this.db
        .prepare(
          "DELETE FROM group_batch_groups WHERE batch_id IN (SELECT id FROM group_batches WHERE class_id = ?)"
        )
        .run(classId);
      this.db.prepare("DELETE FROM group_batches WHERE class_id = ?").run(classId);
      this.db
        .prepare(
          "DELETE FROM class_group_members WHERE group_id IN (SELECT id FROM class_groups WHERE class_id = ?)"
        )
        .run(classId);
      this.db.prepare("DELETE FROM class_groups WHERE class_id = ?").run(classId);
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

  deleteUserById(id: number): void {
    const tx = this.db.transaction((userId: number) => {
      // 小组已读水位（#346）：引用 users，先清掉再删人，两库行为一致
      this.db.prepare("DELETE FROM group_workspace_reads WHERE user_id = ?").run(userId);
      this.db.prepare("DELETE FROM users WHERE id = ?").run(userId);
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
      // 同时匹配操作者与对象编号（#117 补强）：输入学号可搜到「关于该学生」的记录（操作者或资源）
      clauses.push("(actor_name LIKE ? OR actor_user_code LIKE ? OR resource_id LIKE ?)");
      params.push(`%${filters.actorQuery}%`, `%${filters.actorQuery}%`, `%${filters.actorQuery}%`);
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

  /* ---------- 分组（#101） ---------- */

  getClassGroups(classId: number): ClassGroupRow[] {
    return this.db
      .prepare("SELECT * FROM class_groups WHERE class_id = ? ORDER BY group_no")
      .all(classId) as ClassGroupRow[];
  }

  getClassGroupMembers(classId: number): ClassGroupMemberRow[] {
    return this.db
      .prepare(
        `SELECT m.* FROM class_group_members m
         JOIN class_groups g ON g.id = m.group_id
         WHERE g.class_id = ? ORDER BY m.id`
      )
      .all(classId) as ClassGroupMemberRow[];
  }

  /** 事务体内的写入：清空该班当前分组并写入新分组（供单独调用与「覆盖 + 归档」组合复用） */
  private writeClassGrouping(classId: number, groups: ClassGroupingInput[]): void {
    this.assertMembersOfClass(classId, groups);
    // 先删成员再删组（成员引用组）；等价于「清空该班当前分组」
    this.db
      .prepare(
        "DELETE FROM class_group_members WHERE group_id IN (SELECT id FROM class_groups WHERE class_id = ?)"
      )
      .run(classId);
    this.db.prepare("DELETE FROM class_groups WHERE class_id = ?").run(classId);
    const insertGroup = this.db.prepare(
      "INSERT INTO class_groups (class_id, group_no, leader_user_id, created_at) VALUES (?, ?, ?, ?)"
    );
    const insertMember = this.db.prepare(
      "INSERT INTO class_group_members (group_id, user_id, created_at) VALUES (?, ?, ?)"
    );
    const now = getNow();
    for (const g of groups) {
      // #345：组长必须是本组成员；不满足就整批拒绝（事务回滚，不留半套分组）
      if (g.leader_user_id != null && !g.user_ids.includes(g.leader_user_id)) {
        throw new Error("组长必须是本组成员");
      }
      const info = insertGroup.run(classId, g.group_no, g.leader_user_id ?? null, now);
      const groupId = Number(info.lastInsertRowid);
      for (const userId of g.user_ids) insertMember.run(groupId, userId, now);
    }
  }

  /**
   * 事务体内复核：待写入的成员必须仍是本班在读学生。
   * 名单是**事务之外**读的（路由先 getStudents 再算分组），期间可能有人转班；
   * 而 `class_group_members.group_id` 的外键只保证组存在、不保证组与学生的班一致，
   * 少这一步就会让旧班重新占住该生的全局 UNIQUE(user_id)，并把这份过期名单归档进历史。
   */
  private assertMembersOfClass(classId: number, groups: ClassGroupingInput[]): void {
    const ids = [...new Set(groups.flatMap((g) => g.user_ids))];
    if (ids.length === 0) return;
    const placeholders = ids.map(() => "?").join(",");
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM users WHERE id IN (${placeholders}) AND role = 'student' AND class_id = ?`
      )
      .get(...ids, classId) as { c: number };
    if (row.c !== ids.length) throw new Error("名单在分组期间发生变化，请重新分组");
  }

  /** 事务体内的写入：追加一个历史批次（头 + 组 + 成员），返回批次 id */
  private writeGroupBatch(input: NewGroupBatchInput): number {
    const info = this.db
      .prepare(
        `INSERT INTO group_batches
           (class_id, strategy, feature_sources, group_size, student_count, tagged_count, metrics,
            created_by_id, created_by_name, created_by_role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.classId,
        input.strategy,
        input.featureSources,
        input.groupSize,
        input.studentCount,
        input.taggedCount,
        input.metrics,
        input.actorId,
        input.actorName,
        input.actorRole,
        getNow()
      );
    const batchId = Number(info.lastInsertRowid);
    const insertGroup = this.db.prepare(
      `INSERT INTO group_batch_groups (batch_id, group_no, cohesion, member_count, leader_user_id, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const insertMember = this.db.prepare(
      `INSERT INTO group_batch_members (batch_id, group_id, user_id, user_code, name, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    const now = getNow();
    for (const g of input.groups) {
      const gInfo = insertGroup.run(batchId, g.groupNo, g.cohesion, g.members.length, g.leaderUserId ?? null, now);
      const groupId = Number(gInfo.lastInsertRowid);
      for (const m of g.members) {
        insertMember.run(batchId, groupId, m.userId, m.userCode, m.name, now);
      }
    }
    return batchId;
  }

  /** 事务体内：给一个批次的每个组补建小组工作区（#346），标题口径唯一 */
  private writeBatchWorkspaces(batchId: number, classId: number): void {
    const groups = this.db
      .prepare("SELECT id, group_no FROM group_batch_groups WHERE batch_id = ? ORDER BY group_no")
      .all(batchId) as { id: number; group_no: number }[];
    const now = getNow();
    const stmt = this.db.prepare(
      `INSERT INTO group_workspaces (class_id, batch_id, batch_group_id, group_no, title, created_at)
       VALUES (?, ?, ?, ?, ?, ?)`
    );
    for (const group of groups) {
      stmt.run(classId, batchId, group.id, group.group_no, `第 ${group.group_no} 组工作区`, now);
    }
  }

  replaceClassGrouping(classId: number, groups: ClassGroupingInput[]): void {
    this.db.transaction(() => this.writeClassGrouping(classId, groups))();
  }

  insertGroupBatch(input: NewGroupBatchInput): number {
    let batchId = 0;
    this.db.transaction(() => {
      batchId = this.writeGroupBatch(input);
      this.writeBatchWorkspaces(batchId, input.classId);
    })();
    return batchId;
  }

  /** 自动分组落库：**同一事务**内「覆盖当前分组 + 追加历史批次 + 建工作区」，避免出现无归档的当前态 */
  applyGroupingResult(
    classId: number,
    groups: ClassGroupingInput[],
    batch: NewGroupBatchInput
  ): number {
    // 班级由两个独立参数分别传入：不一致就会「覆盖 A 班、归档成 B 班」，且事务本身看不出来
    if (batch.classId !== classId) throw new Error("归档批次与覆盖的班级不一致");
    let batchId = 0;
    this.db.transaction(() => {
      this.writeClassGrouping(classId, groups);
      batchId = this.writeGroupBatch(batch);
      this.writeBatchWorkspaces(batchId, classId);
    })();
    return batchId;
  }

  insertGroupEntry(classId: number, groupNo: number): void {
    this.db
      .prepare("INSERT INTO class_groups (class_id, group_no, created_at) VALUES (?, ?, ?)")
      .run(classId, groupNo, getNow());
  }

  deleteGroupEntry(classId: number, groupNo: number): void {
    // 「组空不空」与「删组」必须同事务：路由的预检查是先前的一次读，
    // 期间有人被移进来的话，直接删组会被外键拦住——那只是一句 500 + 驱动原文，
    // 这里改成在同事务内复查并抛出可读原因（两库响应一致）
    const tx = this.db.transaction(() => {
      const target = this.db
        .prepare("SELECT id FROM class_groups WHERE class_id = ? AND group_no = ?")
        .get(classId, groupNo) as { id: number } | undefined;
      if (!target) throw new Error("该组不存在");
      const member = this.db
        .prepare("SELECT id FROM class_group_members WHERE group_id = ? LIMIT 1")
        .get(target.id);
      if (member) throw new Error("该组还有成员，请先移到其他组");
      this.db.prepare("DELETE FROM class_groups WHERE id = ?").run(target.id);
    });
    tx();
  }

  moveGroupMember(classId: number, userId: number, toGroupNo: number): { leaderCleared: boolean } {
    // 目标组校验、成员改写与组长回退同事务，避免「查到目标组 → 组被删 → 写入死 group_id」
    // 以及「人已移走、组长位却没清掉」的半套状态
    const tx = this.db.transaction((): { leaderCleared: boolean } => {
      const target = this.db
        .prepare("SELECT id FROM class_groups WHERE class_id = ? AND group_no = ?")
        .get(classId, toGroupNo) as { id: number } | undefined;
      if (!target) throw new Error("目标组不存在");
      // 按 user_id 找，**不限旧组属于哪个班**：路由已确认此生现属 classId，
      // 若它的成员行还挂在别班的组上（转班遗留的脏归属），必须把它搬回来；
      // 只查本班就会查不到而行 → 走 INSERT → 撞全局 UNIQUE(user_id) → 「可修复」变成永久失败
      const current = this.db
        .prepare("SELECT id, group_id FROM class_group_members WHERE user_id = ?")
        .get(userId) as { id: number; group_id: number } | undefined;
      let leaderCleared = false;
      if (current) {
        // 被移走的是原组组长：组长位必须随人一起失效（#345）
        if (current.group_id !== target.id) {
          leaderCleared =
            this.db
              .prepare("UPDATE class_groups SET leader_user_id = NULL WHERE id = ? AND leader_user_id = ?")
              .run(current.group_id, userId).changes > 0;
        }
        this.db.prepare("UPDATE class_group_members SET group_id = ? WHERE id = ?").run(target.id, current.id);
        return { leaderCleared };
      }
      // 未在任何组（新转入的学生等）：直接插入目标组
      this.db
        .prepare("INSERT INTO class_group_members (group_id, user_id, created_at) VALUES (?, ?, ?)")
        .run(target.id, userId, getNow());
      return { leaderCleared };
    });
    return tx();
  }

  /**
   * 设置 / 取消某组组长（#345）：定位条件带上 class_id，避免组号跨班误写。
   * 「组长是否本组成员」由路由校验（这里不查成员表，保持单条 UPDATE）。
   */
  updateClassGroupLeader(classId: number, groupNo: number, leaderUserId: number | null): void {
    // 存在性用 SELECT 判，不靠 `.changes`：`.changes` 的语义由驱动/连接标志决定（MySQL 侧
    // mysql2 默认带 CLIENT_FOUND_ROWS 才与 SQLite 一致，一旦去掉该标志同值 UPDATE 就返回 0），
    // 判存在属于业务语义，不该跟着驱动配置漂。
    const existing = this.db
      .prepare("SELECT 1 AS one FROM class_groups WHERE class_id = ? AND group_no = ? LIMIT 1")
      .get(classId, groupNo);
    if (!existing) throw new Error("该组不存在");
    this.db
      .prepare("UPDATE class_groups SET leader_user_id = ? WHERE class_id = ? AND group_no = ?")
      .run(leaderUserId, classId, groupNo);
  }

  getGroupBatches(classId: number): GroupBatchRow[] {
    return this.db
      .prepare("SELECT * FROM group_batches WHERE class_id = ? ORDER BY id DESC")
      .all(classId) as GroupBatchRow[];
  }

  getGroupBatchDetail(batchId: number): {
    batch: GroupBatchRow | undefined;
    groups: GroupBatchGroupRow[];
    members: GroupBatchMemberRow[];
  } {
    const batch = this.db.prepare("SELECT * FROM group_batches WHERE id = ?").get(batchId) as
      | GroupBatchRow
      | undefined;
    const groups = this.db
      .prepare("SELECT * FROM group_batch_groups WHERE batch_id = ? ORDER BY group_no")
      .all(batchId) as GroupBatchGroupRow[];
    const members = this.db
      .prepare("SELECT * FROM group_batch_members WHERE batch_id = ? ORDER BY id")
      .all(batchId) as GroupBatchMemberRow[];
    return { batch, groups, members };
  }

  getStudentGroupRef(userId: number): { class_id: number; group_no: number } | undefined {
    return this.db
      .prepare(
        `SELECT g.class_id AS class_id, g.group_no AS group_no
         FROM class_group_members m JOIN class_groups g ON g.id = m.group_id
         WHERE m.user_id = ?`
      )
      .get(userId) as { class_id: number; group_no: number } | undefined;
  }

  areStudentsInSameCurrentGroup(userIdA: number, userIdB: number): boolean {
    // 同 group_id 即同班同组（组不存在的学生成员行会被外键拦住，无需再 JOIN class_groups）
    const row = this.db
      .prepare(
        `SELECT EXISTS (
           SELECT 1
           FROM class_group_members a
           JOIN class_group_members b ON b.group_id = a.group_id
           WHERE a.user_id = ? AND b.user_id = ?
         ) AS same`
      )
      .get(userIdA, userIdB) as { same: number };
    return row.same === 1;
  }

  /* ---------- 小组工作区（#346） ---------- */

  /** 在一个批次内按组号定位「批次组 + 工作区」，没有批次/组/工作区返回 undefined */
  private workspaceContextOf(batch: GroupBatchRow, groupNo: number): GroupWorkspaceContext | undefined {
    const batchGroup = this.db
      .prepare("SELECT * FROM group_batch_groups WHERE batch_id = ? AND group_no = ?")
      .get(batch.id, groupNo) as GroupBatchGroupRow | undefined;
    if (!batchGroup) return undefined;
    const workspace = this.db
      .prepare("SELECT * FROM group_workspaces WHERE batch_group_id = ?")
      .get(batchGroup.id) as GroupWorkspaceRow | undefined;
    if (!workspace) return undefined;
    return { workspace, batch, batchGroup };
  }

  getStudentWorkspaceContext(userId: number): GroupWorkspaceContext | undefined {
    const ref = this.getStudentGroupRef(userId);
    if (!ref) return undefined;
    const batch = this.db
      .prepare("SELECT * FROM group_batches WHERE class_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(ref.class_id) as GroupBatchRow | undefined;
    if (!batch) return undefined;
    return this.workspaceContextOf(batch, ref.group_no);
  }

  getClassGroupWorkspace(classId: number, groupNo: number): GroupWorkspaceContext | undefined {
    const batch = this.db
      .prepare("SELECT * FROM group_batches WHERE class_id = ? ORDER BY created_at DESC, id DESC LIMIT 1")
      .get(classId) as GroupBatchRow | undefined;
    if (!batch) return undefined;
    return this.workspaceContextOf(batch, groupNo);
  }

  listStudentWorkspaces(userId: number): StudentWorkspaceSummary[] {
    return this.db
      .prepare(
        `SELECT w.id AS workspaceId, b.id AS batchId, b.created_at AS batchCreatedAt,
                bg.group_no AS groupNo, w.title AS title
           FROM group_batch_members bm
           JOIN group_batch_groups bg ON bg.id = bm.group_id
           JOIN group_batches b ON b.id = bg.batch_id
           JOIN group_workspaces w ON w.batch_group_id = bg.id
          WHERE bm.user_id = ?
          ORDER BY b.created_at DESC, b.id DESC`
      )
      .all(userId) as StudentWorkspaceSummary[];
  }

  getGroupWorkspaceById(workspaceId: number): GroupWorkspaceRow | undefined {
    return this.db.prepare("SELECT * FROM group_workspaces WHERE id = ?").get(workspaceId) as
      | GroupWorkspaceRow
      | undefined;
  }

  getBatchWorkspaces(batchId: number): GroupWorkspaceRow[] {
    return this.db
      .prepare("SELECT * FROM group_workspaces WHERE batch_id = ? ORDER BY group_no")
      .all(batchId) as GroupWorkspaceRow[];
  }

  listGroupPosts(workspaceId: number): GroupPostRow[] {
    return this.db
      .prepare(
        `SELECT * FROM group_posts
          WHERE workspace_id = ? AND deleted_at IS NULL
          ORDER BY pinned DESC, created_at DESC, id DESC`
      )
      .all(workspaceId) as GroupPostRow[];
  }

  getGroupPost(postId: number, workspaceId: number): GroupPostRow | undefined {
    return this.db
      .prepare("SELECT * FROM group_posts WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
      .get(postId, workspaceId) as GroupPostRow | undefined;
  }

  insertGroupPost(input: NewGroupPostInput): number {
    const info = this.db
      .prepare(
        `INSERT INTO group_posts (workspace_id, author_id, author_name, author_role, title, content, pinned, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.workspaceId,
        input.authorId,
        input.authorName,
        input.authorRole,
        input.title,
        input.content,
        input.pinned ? 1 : 0,
        getNow()
      );
    return Number(info.lastInsertRowid);
  }

  updateGroupPost(postId: number, workspaceId: number, fields: GroupPostUpdateFields): void {
    const sets: string[] = [];
    const params: (string | number | null)[] = [];
    if (fields.pinned !== undefined) {
      sets.push("pinned = ?");
      params.push(fields.pinned);
    }
    if (fields.deleted_at !== undefined) {
      sets.push("deleted_at = ?");
      params.push(fields.deleted_at);
    }
    if (sets.length === 0) return;
    this.db
      .prepare(`UPDATE group_posts SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`)
      .run(...params, postId, workspaceId);
  }

  countRecentGroupPosts(workspaceId: number, authorId: number, since: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM group_posts
          WHERE workspace_id = ? AND author_id = ? AND created_at >= ?`
      )
      .get(workspaceId, authorId, since) as { c: number };
    return Number(row.c);
  }

  listGroupTasks(workspaceId: number): GroupTaskRow[] {
    return this.db
      .prepare(
        `SELECT * FROM group_tasks
          WHERE workspace_id = ? AND deleted_at IS NULL
          ORDER BY CASE status WHEN 'open' THEN 0 WHEN 'in_progress' THEN 1 ELSE 2 END,
                   created_at DESC, id DESC`
      )
      .all(workspaceId) as GroupTaskRow[];
  }

  getGroupTask(taskId: number, workspaceId: number): GroupTaskRow | undefined {
    return this.db
      .prepare("SELECT * FROM group_tasks WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL")
      .get(taskId, workspaceId) as GroupTaskRow | undefined;
  }

  insertGroupTask(input: NewGroupTaskInput): number {
    const info = this.db
      .prepare(
        `INSERT INTO group_tasks
           (workspace_id, title, description, assignee_id, assignee_name, status, due_at,
            created_by_id, created_by_name, created_by_role, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run(
        input.workspaceId,
        input.title,
        input.description,
        input.assigneeId,
        input.assigneeName,
        input.assigneeId == null ? "open" : "in_progress",
        input.dueAt,
        input.createdById,
        input.createdByName,
        input.createdByRole,
        getNow()
      );
    return Number(info.lastInsertRowid);
  }

  claimGroupTask(taskId: number, workspaceId: number, userId: number, userName: string | null): boolean {
    // 单条条件更新即原子：并发时只有一个请求能把 assignee 从 NULL 改掉
    const info = this.db
      .prepare(
        `UPDATE group_tasks
            SET assignee_id = ?, assignee_name = ?, status = 'in_progress'
          WHERE id = ? AND workspace_id = ?
            AND deleted_at IS NULL AND status = 'open' AND assignee_id IS NULL`
      )
      .run(userId, userName, taskId, workspaceId);
    return info.changes > 0;
  }

  updateGroupTask(taskId: number, workspaceId: number, fields: GroupTaskUpdateFields): void {
    const sets: string[] = [];
    const params: (string | null)[] = [];
    if (fields.status !== undefined) {
      sets.push("status = ?");
      params.push(fields.status);
    }
    if (fields.completed_at !== undefined) {
      sets.push("completed_at = ?");
      params.push(fields.completed_at);
    }
    if (fields.deleted_at !== undefined) {
      sets.push("deleted_at = ?");
      params.push(fields.deleted_at);
    }
    if (sets.length === 0) return;
    this.db
      .prepare(`UPDATE group_tasks SET ${sets.join(", ")} WHERE id = ? AND workspace_id = ?`)
      .run(...params, taskId, workspaceId);
  }

  countRecentGroupTasks(workspaceId: number, authorId: number, since: string): number {
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM group_tasks
          WHERE workspace_id = ? AND created_by_id = ? AND created_at >= ?`
      )
      .get(workspaceId, authorId, since) as { c: number };
    return Number(row.c);
  }

  getGroupUnreadCount(workspaceId: number, userId: number): number {
    // 按公告 id 水位计数：同一秒内的新公告也不会被当成已读
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS c FROM group_posts
          WHERE workspace_id = ? AND deleted_at IS NULL
            AND id > COALESCE((
              SELECT last_read_post_id FROM group_workspace_reads
               WHERE workspace_id = ? AND user_id = ?
            ), 0)`
      )
      .get(workspaceId, workspaceId, userId) as { c: number };
    return Number(row.c);
  }

  markGroupWorkspaceRead(workspaceId: number, userId: number): void {
    this.db
      .prepare(
        `INSERT INTO group_workspace_reads (workspace_id, user_id, last_read_at, last_read_post_id)
         VALUES (?, ?, ?, (SELECT COALESCE(MAX(id), 0) FROM group_posts WHERE workspace_id = ?))
         ON CONFLICT(workspace_id, user_id) DO UPDATE SET
           last_read_at = excluded.last_read_at,
           last_read_post_id = excluded.last_read_post_id`
      )
      .run(workspaceId, userId, getNow(), workspaceId);
  }

  // assessments / assessment_questions / assessment_results（#221 职业测评数据层）
  getEnabledAssessments(): AssessmentRow[] {
    return this.db
      .prepare("SELECT * FROM assessments WHERE enabled = 1 ORDER BY id")
      .all() as AssessmentRow[];
  }

  getAssessmentByCode(code: string): AssessmentRow | undefined {
    // code 归一化在边界做：SQLite 的 `=` 区分大小写、MySQL 默认不区分，直接比会分叉
    return this.db
      .prepare("SELECT * FROM assessments WHERE code = ?")
      .get(normalizeAssessmentCode(code)) as AssessmentRow | undefined;
  }

  getAssessmentQuestions(assessmentId: number): AssessmentQuestionRow[] {
    return this.db
      .prepare("SELECT * FROM assessment_questions WHERE assessment_id = ? ORDER BY question_index")
      .all(assessmentId) as AssessmentQuestionRow[];
  }

  getAssessmentQuestionsByCode(code: string): AssessmentQuestionRow[] {
    return this.db
      .prepare(
        `SELECT q.* FROM assessment_questions q
         JOIN assessments a ON a.id = q.assessment_id
         WHERE a.code = ? ORDER BY q.question_index`
      )
      .all(normalizeAssessmentCode(code)) as AssessmentQuestionRow[];
  }

  upsertAssessmentDraft(userId: number, assessmentId: number, answersJson: string, itemsJson: string): number {
    // 单条原子 upsert：`draft_slot = 1` 是草稿位，唯一约束保证「至多一条草稿」；
    // 「先查再写」在并发自动保存下会插出第二条草稿，故用 ON CONFLICT 直接覆盖。
    // items_json 每次作答都覆盖：路由拿到的本轮计划本就来自这条草稿的快照，重复写同一个值，
    // 顺带让「旧库留下的空快照」在下一次作答时自愈。
    const now = getNow();
    this.db
      .prepare(
        `INSERT INTO assessment_results
           (user_id, assessment_id, status, answers_json, items_json, is_current, draft_slot, started_at, updated_at)
         VALUES (?, ?, 'in_progress', ?, ?, 0, 1, ?, ?)
         ON CONFLICT(user_id, assessment_id, draft_slot)
         DO UPDATE SET answers_json = excluded.answers_json, items_json = excluded.items_json,
                       updated_at = excluded.updated_at`
      )
      .run(userId, assessmentId, answersJson, itemsJson, now, now);
    const draft = this.db
      .prepare("SELECT id FROM assessment_results WHERE user_id = ? AND assessment_id = ? AND draft_slot = 1")
      .get(userId, assessmentId) as { id: number };
    return draft.id;
  }

  getAssessmentDraft(userId: number, assessmentId: number): AssessmentResultRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM assessment_results
         WHERE user_id = ? AND assessment_id = ? AND draft_slot = 1
         ORDER BY id DESC LIMIT 1`
      )
      .get(userId, assessmentId) as AssessmentResultRow | undefined;
  }

  completeAssessmentResult(input: CompleteAssessmentInput): number {
    const { userId, assessmentId, answersJson, itemsJson, scoresJson, typeCode } = input;
    const tx = this.db.transaction(() => {
      const now = getNow();
      // 当前版本唯一：先整体置 0，再把本次结果置 1（同一事务内，读不到中间态）
      this.db
        .prepare("UPDATE assessment_results SET is_current = 0 WHERE user_id = ? AND assessment_id = ? AND is_current = 1")
        .run(userId, assessmentId);
      const draft = this.db
        .prepare(
          `SELECT id FROM assessment_results
           WHERE user_id = ? AND assessment_id = ? AND draft_slot = 1
           ORDER BY id DESC LIMIT 1`
        )
        .get(userId, assessmentId) as { id: number } | undefined;
      if (draft) {
        // 沿用草稿行：保留 started_at，作答内容以本次提交为准，草稿位释放（draft_slot → NULL）
        this.db
          .prepare(
            `UPDATE assessment_results
             SET status = 'completed', answers_json = ?, items_json = ?, scores_json = ?, type_code = ?,
                 is_current = 1, draft_slot = NULL, updated_at = ?, completed_at = ?
             WHERE id = ?`
          )
          .run(answersJson, itemsJson, scoresJson, typeCode, now, now, draft.id);
        return draft.id;
      }
      const result = this.db
        .prepare(
          `INSERT INTO assessment_results
             (user_id, assessment_id, status, answers_json, items_json, scores_json, type_code, is_current,
              started_at, updated_at, completed_at)
           VALUES (?, ?, 'completed', ?, ?, ?, ?, 1, ?, ?, ?)`
        )
        .run(userId, assessmentId, answersJson, itemsJson, scoresJson, typeCode, now, now, now);
      return Number(result.lastInsertRowid);
    });
    return tx();
  }

  getCurrentAssessmentResult(userId: number, assessmentId: number): AssessmentResultRow | undefined {
    return this.db
      .prepare(
        `SELECT * FROM assessment_results
         WHERE user_id = ? AND assessment_id = ? AND status = 'completed' AND is_current = 1
         ORDER BY id DESC LIMIT 1`
      )
      .get(userId, assessmentId) as AssessmentResultRow | undefined;
  }

  getAssessmentResults(userId: number, assessmentId: number): AssessmentResultRow[] {
    return this.db
      .prepare(
        `SELECT * FROM assessment_results
         WHERE user_id = ? AND assessment_id = ? AND status = 'completed'
         ORDER BY completed_at DESC, id DESC`
      )
      .all(userId, assessmentId) as AssessmentResultRow[];
  }

  getCurrentAssessmentResultsByUserCodes(
    assessmentId: number,
    userCodes: string[]
  ): AssessmentResultSummary[] {
    if (userCodes.length === 0) return [];
    const rows: AssessmentResultSummary[] = [];
    for (const chunk of chunkArray([...new Set(userCodes)])) {
      const placeholders = chunk.map(() => "?").join(",");
      // 只需要列表/导出用的四列：不取作答内容，也不取整行（#233/#234）
      rows.push(
        ...(this.db
          .prepare(
            `SELECT u.user_code AS user_code, r.type_code AS type_code,
                    r.scores_json AS scores_json, r.completed_at AS completed_at
             FROM assessment_results r
             JOIN users u ON u.id = r.user_id
             WHERE r.assessment_id = ? AND r.status = 'completed' AND r.is_current = 1
               AND u.role = 'student' AND u.user_code IN (${placeholders})`
          )
          .all(assessmentId, ...chunk) as AssessmentResultSummary[])
      );
    }
    return rows;
  }

  // onet_occupations（#226 O*NET 职业库：离线导入的只读参考数据）
  getOnetOccupations(): OnetOccupationRow[] {
    return this.db.prepare("SELECT * FROM onet_occupations ORDER BY code").all() as OnetOccupationRow[];
  }

  // 教师端测评统计（#229）：只数数，完成率/排序/标签交给 `assessment-stats.ts`，两适配器不重复口径
  getAssessmentStats(assessmentId: number, classIds: number[] | null, classId?: number): AssessmentStatsRaw {
    if (classIds !== null && classIds.length === 0) {
      return {
        classes: [],
        types: [],
        classTypes: [],
        codes: [],
        total: { enrolled: 0, assessed: 0, last_completed_at: null },
      };
    }
    const scopeClauses: string[] = [];
    const params: number[] = [];
    if (classIds !== null) {
      scopeClauses.push(`u.class_id IN (${classIds.map(() => "?").join(",")})`);
      params.push(...classIds);
    }
    if (classId !== undefined) {
      scopeClauses.push("u.class_id = ?");
      params.push(classId);
    }
    const scopeClause = scopeClauses.length === 0 ? "" : ` AND ${scopeClauses.join(" AND ")}`;
    // 完成/当前有效的结果，且必须是学生账号（教师/管理员本人作答不计入班级完成度）
    const resultWhere = `r.assessment_id = ? AND r.status = 'completed' AND r.is_current = 1 AND u.role = 'student'${scopeClause}`;

    const classClauses: string[] = [];
    const classParams: number[] = [];
    if (classIds !== null) {
      classClauses.push(`c.id IN (${classIds.map(() => "?").join(",")})`);
      classParams.push(...classIds);
    }
    if (classId !== undefined) {
      classClauses.push("c.id = ?");
      classParams.push(classId);
    }
    const classWhere = classClauses.length === 0 ? "" : ` WHERE ${classClauses.join(" AND ")}`;
    const classRows = this.db
      .prepare(
        `SELECT c.id AS class_id, c.name AS name, COUNT(u.id) AS enrolled
         FROM classes c LEFT JOIN users u ON u.class_id = c.id AND u.role = 'student'
         ${classWhere}
         GROUP BY c.id, c.name`
      )
      .all(...classParams) as { class_id: number; name: string; enrolled: number }[];

    const assessedRows = this.db
      .prepare(
        `SELECT u.class_id AS class_id, COUNT(DISTINCT r.user_id) AS assessed
         FROM assessment_results r JOIN users u ON u.id = r.user_id
         WHERE ${resultWhere} AND u.class_id IS NOT NULL
         GROUP BY u.class_id`
      )
      .all(assessmentId, ...params) as { class_id: number; assessed: number }[];
    const assessedByClass = new Map(assessedRows.map((row) => [row.class_id, Number(row.assessed)]));

    const typeRows = this.db
      .prepare(
        `SELECT SUBSTR(r.type_code, 1, 1) AS key, COUNT(*) AS count
         FROM assessment_results r JOIN users u ON u.id = r.user_id
         WHERE ${resultWhere} AND r.type_code IS NOT NULL AND TRIM(r.type_code) <> ''
         GROUP BY SUBSTR(r.type_code, 1, 1)`
      )
      .all(assessmentId, ...params) as { key: string; count: number }[];

    const classTypeRows = this.db
      .prepare(
        `SELECT u.class_id AS class_id,
                SUBSTR(r.type_code, 1, 1) AS key,
                COUNT(*) AS count
         FROM assessment_results r JOIN users u ON u.id = r.user_id
         WHERE ${resultWhere} AND u.class_id IS NOT NULL AND r.type_code IS NOT NULL AND TRIM(r.type_code) <> ''
         GROUP BY u.class_id, SUBSTR(r.type_code, 1, 1)`
      )
      .all(assessmentId, ...params) as { class_id: number; key: string; count: number }[];

    const codeRows = this.db
      .prepare(
        `SELECT r.type_code AS code, COUNT(*) AS count
         FROM assessment_results r JOIN users u ON u.id = r.user_id
         WHERE ${resultWhere} AND r.type_code IS NOT NULL AND TRIM(r.type_code) <> ''
         GROUP BY r.type_code`
      )
      .all(assessmentId, ...params) as { code: string; count: number }[];

    const totalClauses = ["role = 'student'"];
    const totalParams: number[] = [];
    if (classIds !== null) {
      totalClauses.push(`class_id IN (${classIds.map(() => "?").join(",")})`);
      totalParams.push(...classIds);
    }
    if (classId !== undefined) {
      totalClauses.push("class_id = ?");
      totalParams.push(classId);
    }
    const { c: enrolled } = this.db
      .prepare(`SELECT COUNT(*) AS c FROM users WHERE ${totalClauses.join(" AND ")}`)
      .get(...totalParams) as { c: number };
    const { c: assessed, last } = this.db
      .prepare(
        `SELECT COUNT(DISTINCT r.user_id) AS c, MAX(r.completed_at) AS last
         FROM assessment_results r JOIN users u ON u.id = r.user_id
         WHERE ${resultWhere}`
      )
      .get(assessmentId, ...params) as { c: number; last: string | null };

    return {
      classes: classRows.map((row) => ({
        class_id: row.class_id,
        name: row.name,
        enrolled: Number(row.enrolled),
        assessed: assessedByClass.get(row.class_id) ?? 0,
      })),
      types: typeRows.map((row) => ({ key: String(row.key), count: Number(row.count) })),
      classTypes: classTypeRows.map((row) => ({
        class_id: Number(row.class_id),
        key: String(row.key),
        count: Number(row.count),
      })),
      codes: codeRows.map((row) => ({ code: String(row.code), count: Number(row.count) })),
      total: { enrolled: Number(enrolled), assessed: Number(assessed), last_completed_at: last ?? null },
    };
  }

  // 班级完成矩阵（#310）：SQL 与行映射由 `completion-query.ts` 与 MySQL 共用，避免两适配器分叉
  getCompletionStats(assessmentIds: number[], classIds: number[] | null): CompletionStatsRaw {
    const { sql, params } = buildCompletionStatsSql(assessmentIds, classIds);
    if (!sql) return { profile: [], assessments: [] };
    const rows = this.db.prepare(sql).all(...params) as CompletionStatsRow[];
    return mapCompletionStatsRows(rows);
  }

  // dimensional 量表的逐人结果快照（#312）：只取三列，解析与三档归并在纯函数里做
  getDimensionalResultScores(
    assessmentId: number,
    classIds: number[] | null
  ): DimensionalResultScoreRow[] {
    if (classIds !== null && classIds.length === 0) return [];
    const conditions = [
      "r.assessment_id = ?",
      "r.status = 'completed'",
      "r.is_current = 1",
      "u.role = 'student'",
    ];
    const params: number[] = [assessmentId];
    if (classIds !== null) {
      conditions.push(`u.class_id IN (${classIds.map(() => "?").join(",")})`);
      params.push(...classIds);
    }
    return this.db
      .prepare(
        `SELECT r.user_id AS user_id, r.scores_json AS scores_json, r.completed_at AS completed_at
         FROM assessment_results r JOIN users u ON u.id = r.user_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY r.user_id`
      )
      .all(...params) as DimensionalResultScoreRow[];
  }

  getAssessmentRoster(
    assessmentId: number,
    classIds: number[] | null,
    filters: {
      classId?: number | null;
      lead?: string | null;
      code?: string | null;
      includeScores?: boolean;
    } = {}
  ): AssessmentRosterRow[] {
    if (classIds !== null && classIds.length === 0) return [];
    const conditions = [
      "r.assessment_id = ?",
      "r.status = 'completed'",
      "r.is_current = 1",
      "u.role = 'student'",
    ];
    const params: (string | number)[] = [assessmentId];
    if (classIds !== null) {
      conditions.push(`u.class_id IN (${classIds.map(() => "?").join(",")})`);
      params.push(...classIds);
    }
    if (filters.classId != null) {
      conditions.push("u.class_id = ?");
      params.push(filters.classId);
    }
    if (filters.lead) {
      conditions.push("SUBSTR(r.type_code, 1, 1) = ?");
      params.push(filters.lead);
    }
    if (filters.code) {
      // 三字码精确过滤（#232 胶囊下钻）：与 lead 可同时出现，二者是「且」关系
      conditions.push("r.type_code = ?");
      params.push(filters.code);
    }
    // dimensional 量表（#313）没有三字码、要看档位，才需要多取一份结果快照；
    // 默认仍只取展示所需的六列，不让个人分数进入不必要的数据搬运面
    const scoresColumn = filters.includeScores ? ", r.scores_json AS scores_json" : "";
    // 班级名 + 学号排序：下钻列表要稳定（库内 collation 差异不影响，因为教师只按单班看）
    return this.db
      .prepare(
        `SELECT u.class_id AS class_id, c.name AS class_name, u.name AS name, u.user_code AS user_code,
                r.type_code AS code, r.completed_at AS assessed_at${scoresColumn}
         FROM assessment_results r
         JOIN users u ON u.id = r.user_id
         LEFT JOIN classes c ON c.id = u.class_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY COALESCE(c.name, ''), u.user_code`
      )
      .all(...params) as AssessmentRosterRow[];
  }

  getAssessmentMissingRoster(
    assessmentId: number,
    classIds: number[] | null,
    filters: { classId?: number | null } = {}
  ): AssessmentMissingRosterRow[] {
    if (classIds !== null && classIds.length === 0) return [];
    // 基准是「在册学生」而不是结果表：只有 NOT EXISTS 才能把「只有草稿」算作未完成，
    // 写成 LEFT JOIN 结果表再判 NULL 会把草稿行当成已完成（#313 明确要求）
    const conditions = [
      "u.role = 'student'",
      `NOT EXISTS (
         SELECT 1 FROM assessment_results r
         WHERE r.user_id = u.id AND r.assessment_id = ? AND r.status = 'completed' AND r.is_current = 1
       )`,
    ];
    const params: (string | number)[] = [assessmentId];
    if (classIds !== null) {
      conditions.push(`u.class_id IN (${classIds.map(() => "?").join(",")})`);
      params.push(...classIds);
    }
    if (filters.classId != null) {
      conditions.push("u.class_id = ?");
      params.push(filters.classId);
    }
    // 排序沿用名册既有约定（班级名 → 学号），两适配器逐列一致
    return this.db
      .prepare(
        `SELECT u.class_id AS class_id, c.name AS class_name, u.name AS name, u.user_code AS user_code
         FROM users u
         LEFT JOIN classes c ON c.id = u.class_id
         WHERE ${conditions.join(" AND ")}
         ORDER BY COALESCE(c.name, ''), u.user_code`
      )
      .all(...params) as AssessmentMissingRosterRow[];
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
    const classGroups = this.db.prepare("SELECT * FROM class_groups ORDER BY id").all() as ClassGroupRow[];
    const classGroupMembers = this.db
      .prepare("SELECT * FROM class_group_members ORDER BY id")
      .all() as ClassGroupMemberRow[];
    const groupBatches = this.db.prepare("SELECT * FROM group_batches ORDER BY id").all() as GroupBatchRow[];
    const groupBatchGroups = this.db
      .prepare("SELECT * FROM group_batch_groups ORDER BY id")
      .all() as GroupBatchGroupRow[];
    const groupBatchMembers = this.db
      .prepare("SELECT * FROM group_batch_members ORDER BY id")
      .all() as GroupBatchMemberRow[];
    const groupWorkspaces = this.db
      .prepare("SELECT * FROM group_workspaces ORDER BY id")
      .all() as GroupWorkspaceRow[];
    const groupPosts = this.db.prepare("SELECT * FROM group_posts ORDER BY id").all() as GroupPostRow[];
    const groupTasks = this.db.prepare("SELECT * FROM group_tasks ORDER BY id").all() as GroupTaskRow[];
    const groupWorkspaceReads = this.db
      .prepare("SELECT * FROM group_workspace_reads ORDER BY id")
      .all() as GroupWorkspaceReadRow[];
    const assessments = this.db.prepare("SELECT * FROM assessments ORDER BY id").all() as AssessmentRow[];
    const assessmentQuestions = this.db
      .prepare("SELECT * FROM assessment_questions ORDER BY id")
      .all() as AssessmentQuestionRow[];
    const assessmentResults = this.db
      .prepare("SELECT * FROM assessment_results ORDER BY id")
      .all() as AssessmentResultRow[];
    return {
      // #346：version 9 增加小组工作区四表（公告 / 任务 / 已读水位）
      version: 9,
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
      class_groups: classGroups,
      class_group_members: classGroupMembers,
      group_batches: groupBatches,
      group_batch_groups: groupBatchGroups,
      group_batch_members: groupBatchMembers,
      group_workspaces: groupWorkspaces,
      group_posts: groupPosts,
      group_tasks: groupTasks,
      group_workspace_reads: groupWorkspaceReads,
      assessments,
      assessment_questions: assessmentQuestions,
      assessment_results: assessmentResults,
    };
  }

  restore(data: BackupData): void {
    // 恢复期间显式关闭外键约束（DELETE + INSERT 顺序在 FK 开启时可能违反 REFERENCES）——
    // 这是全流程里唯一能写进不一致引用的窗口，所以缺分组字段的旧备份必须清空五表而不是保留现状
    const fkWasOn = (this.db.pragma("foreign_keys", { simple: true }) as number) === 1;
    if (fkWasOn) this.db.pragma("foreign_keys = OFF");
    try {
    const restoreTx = this.db.transaction((d: BackupData) => {
      const tags = normalizeBackupTags(d.tags);
      // 凡按 user_id / class_id 引用 users / classes 的持久表，恢复时一律无条件先清空：这两张表整表替换且按原 id 重插，
      // 旧备份缺字段时若保留现状，行会指向已不存在、或已被别人占用的 id（恢复期间 FK 关闭，库不会拦，事后开启也不回溯校验）。
      // 所以「缺字段 = 恢复后该功能无数据」，不是「保留不动」——#101 分组五表、#95 档案历史版本同此口径
      // #346 工作区四表同样按 user_id / class_id 引用，旧备份缺字段时一律清空
      this.db.exec("DELETE FROM group_workspace_reads");
      this.db.exec("DELETE FROM group_tasks");
      this.db.exec("DELETE FROM group_posts");
      this.db.exec("DELETE FROM group_workspaces");
      this.db.exec("DELETE FROM class_group_members");
      this.db.exec("DELETE FROM class_groups");
      this.db.exec("DELETE FROM group_batch_members");
      this.db.exec("DELETE FROM group_batch_groups");
      this.db.exec("DELETE FROM group_batches");
      this.db.exec("DELETE FROM profile_submissions");
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
          `INSERT INTO users (id, user_code, password_hash, role, name, class_id, tags, avatar_url, evaluation_url, evaluation_text, submitted_at, created_at, storage_id)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
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
            u.evaluation_text ?? null,
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
      // 档案提交历史版本恢复（#95；**含此字段才回填，旧备份恢复后即为无历史版本**——上面已统一清空）
      if (Array.isArray(d.profile_submissions)) {
        if (d.profile_submissions.length > 0) {
          const stmt = this.db.prepare(
            `INSERT INTO profile_submissions (id, user_id, version, tags, avatar_url, evaluation_url, evaluation_text, storage_id, submitted_at, is_current)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const p of d.profile_submissions) {
            stmt.run(
              p.id,
              p.user_id,
              p.version,
              p.tags,
              p.avatar_url,
              p.evaluation_url,
              p.evaluation_text ?? null,
              p.storage_id ?? 1,
              p.submitted_at,
              p.is_current ?? 0
            );
          }
        }
      }
      // 测评恢复（#221）：
      // - `assessments` + `assessment_questions` 是参考数据：两字段齐备才整体替换，否则保留现状（可被种子自愈）；
      // - `assessment_results` 是**学生个人数据且只靠数值 user_id 关联**，而 `users` 上面已经整表替换了：
      //   保留旧结果会在「恢复到另一套库的旧备份」时张冠李戴，故与分组五表同口径——**一律先清空**，
      //   只有备份带该字段才回填。
      this.db.exec("DELETE FROM assessment_results");
      if (Array.isArray(d.assessments) && Array.isArray(d.assessment_questions)) {
        this.db.exec("DELETE FROM assessment_questions");
        this.db.exec("DELETE FROM assessments");
        if (d.assessments.length > 0) {
          const assessmentStmt = this.db.prepare(
            `INSERT INTO assessments
               (id, code, name, question_count, items_per_attempt, dimensions_json, scoring_mode, scale_version,
                attribution, license_text, disclaimer, enabled, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
          );
          for (const a of d.assessments) {
            assessmentStmt.run(
              a.id,
              // code 统一小写入库：两适配器的唯一比较语义已对齐（MySQL 用 utf8mb4_bin），
              // 这里再做一次规范化，避免跨库备份里的大小写差异变成「查不到的量表」
              normalizeAssessmentCode(a.code),
              a.name,
              a.question_count,
              // #282：旧备份没有这一列 → 补 0（全量作答），下次 init 的 upgradeAssessmentBank 会按种子回填
              a.items_per_attempt ?? 0,
              a.dimensions_json,
              a.scoring_mode ?? "typological",
              a.scale_version,
              a.attribution ?? "",
              a.license_text ?? "",
              a.disclaimer ?? "",
              a.enabled ?? 1,
              a.created_at ?? getNow(),
              a.updated_at ?? getNow()
            );
          }
        }
        // #281：旧备份没有 origin → 按原创题默认（与列默认值一致，绝不因缺字段拒绝恢复）
        const questionStmt = this.db.prepare(
          `INSERT INTO assessment_questions
             (id, assessment_id, question_index, prompt, dimension, origin, reverse_scored, version, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const q of d.assessment_questions) {
          questionStmt.run(
            q.id,
            q.assessment_id,
            q.question_index,
            q.prompt,
            q.dimension,
            q.origin ?? "cn-original",
            q.reverse_scored ?? 0,
            q.version ?? 1,
            q.created_at ?? getNow()
          );
        }
      }
      if (Array.isArray(d.assessment_results)) {
        const resultStmt = this.db.prepare(
          `INSERT INTO assessment_results
             (id, user_id, assessment_id, status, answers_json, items_json, scores_json, type_code, is_current,
              draft_slot, started_at, updated_at, completed_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const r of d.assessment_results) {
          resultStmt.run(
            r.id,
            r.user_id,
            r.assessment_id,
            r.status,
            r.answers_json ?? "{}",
            // #282：旧备份没有抽题快照 → 补 '[]'（按整库一轮处理），读取侧还有 parseItemsSnapshot 兜底
            r.items_json ?? "[]",
            r.scores_json ?? null,
            r.type_code ?? null,
            r.is_current ?? 0,
            // 旧备份没有 draft_slot 列：草稿补草稿位、完成记录补 NULL，恢复后不变量仍成立
            r.draft_slot ?? (r.status === "in_progress" ? 1 : null),
            r.started_at ?? getNow(),
            r.updated_at ?? getNow(),
            r.completed_at ?? null
          );
        }
      }
      // 分组恢复（#101；**含此字段才回填，旧备份恢复后即为未分组**——上面已统一清空）
      // 当前侧与历史侧各自成对处理，避免出现「删了组却留着成员」的半截状态
      if (Array.isArray(d.class_groups)) {
        const stmt = this.db.prepare(
          `INSERT INTO class_groups (id, class_id, group_no, leader_user_id, created_at) VALUES (?, ?, ?, ?, ?)`
        );
        for (const g of d.class_groups) stmt.run(g.id, g.class_id, g.group_no, g.leader_user_id ?? null, g.created_at ?? getNow());
        const memberStmt = this.db.prepare(
          `INSERT INTO class_group_members (id, group_id, user_id, created_at) VALUES (?, ?, ?, ?)`
        );
        for (const m of d.class_group_members ?? []) {
          memberStmt.run(m.id, m.group_id, m.user_id, m.created_at ?? getNow());
        }
      }
      if (Array.isArray(d.group_batches)) {
        const batchStmt = this.db.prepare(
          `INSERT INTO group_batches
             (id, class_id, strategy, feature_sources, group_size, student_count, tagged_count, metrics,
              created_by_id, created_by_name, created_by_role, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const b of d.group_batches) {
          batchStmt.run(
            b.id,
            b.class_id,
            b.strategy,
            b.feature_sources ?? null,
            b.group_size ?? 5,
            b.student_count ?? 0,
            b.tagged_count ?? 0,
            b.metrics ?? null,
            b.created_by_id ?? null,
            b.created_by_name ?? null,
            b.created_by_role ?? null,
            b.created_at ?? getNow()
          );
        }
        const groupStmt = this.db.prepare(
          `INSERT INTO group_batch_groups (id, batch_id, group_no, cohesion, member_count, leader_user_id, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const g of d.group_batch_groups ?? []) {
          groupStmt.run(
            g.id,
            g.batch_id,
            g.group_no,
            g.cohesion ?? null,
            g.member_count ?? 0,
            g.leader_user_id ?? null,
            g.created_at ?? getNow()
          );
        }
        const memberStmt = this.db.prepare(
          `INSERT INTO group_batch_members (id, batch_id, group_id, user_id, user_code, name, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const m of d.group_batch_members ?? []) {
          memberStmt.run(
            m.id,
            m.batch_id,
            m.group_id,
            m.user_id,
            m.user_code ?? null,
            m.name ?? null,
            m.created_at ?? getNow()
          );
        }
      }
      // 小组工作区（#346）：旧备份没有这些字段时保持空（上面已清空），
      // 顺序必须是 工作区 → 公告/任务 → 已读水位，保证引用在关闭外键的恢复窗口内也自洽
      if (Array.isArray(d.group_workspaces)) {
        const stmt = this.db.prepare(
          `INSERT INTO group_workspaces (id, class_id, batch_id, batch_group_id, group_no, title, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`
        );
        for (const w of d.group_workspaces) {
          stmt.run(
            w.id,
            w.class_id,
            w.batch_id,
            w.batch_group_id,
            w.group_no,
            w.title ?? `第 ${w.group_no} 组工作区`,
            w.created_at ?? getNow()
          );
        }
        const postStmt = this.db.prepare(
          `INSERT INTO group_posts
             (id, workspace_id, author_id, author_name, author_role, title, content, pinned, created_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const p of d.group_posts ?? []) {
          postStmt.run(
            p.id,
            p.workspace_id,
            p.author_id ?? null,
            p.author_name ?? null,
            p.author_role ?? null,
            p.title,
            p.content,
            p.pinned ?? 0,
            p.created_at ?? getNow(),
            p.deleted_at ?? null
          );
        }
        const taskStmt = this.db.prepare(
          `INSERT INTO group_tasks
             (id, workspace_id, title, description, assignee_id, assignee_name, status, due_at,
              created_by_id, created_by_name, created_by_role, created_at, completed_at, deleted_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
        );
        for (const t of d.group_tasks ?? []) {
          taskStmt.run(
            t.id,
            t.workspace_id,
            t.title,
            t.description ?? null,
            t.assignee_id ?? null,
            t.assignee_name ?? null,
            t.status ?? "open",
            t.due_at ?? null,
            t.created_by_id ?? null,
            t.created_by_name ?? null,
            t.created_by_role ?? null,
            t.created_at ?? getNow(),
            t.completed_at ?? null,
            t.deleted_at ?? null
          );
        }
        const readStmt = this.db.prepare(
          `INSERT INTO group_workspace_reads (id, workspace_id, user_id, last_read_at, last_read_post_id)
           VALUES (?, ?, ?, ?, ?)`
        );
        for (const r of d.group_workspace_reads ?? []) {
          readStmt.run(
            r.id,
            r.workspace_id,
            r.user_id,
            r.last_read_at ?? getNow(),
            r.last_read_post_id ?? 0
          );
        }
      }
    });
    restoreTx(data);
    } finally {
      if (fkWasOn) this.db.pragma("foreign_keys = ON");
    }
    // 恢复后保证内置量表存在（旧备份无测评字段、或备份本身题库为空时自愈）；已存在的量表不覆盖
    this.seedAssessments();
  }

  close(): void {
    this.db.close();
  }
}
