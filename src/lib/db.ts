import { getConfig } from "./db-config";
import { MysqlAdapter } from "./db-mysql";
import { SqliteAdapter } from "./db-sqlite";

export interface UserRow {
  id: number;
  user_code: string;
  password_hash: string | null;
  role: string;
  name: string;
  class_id: number | null;
  tags: string | null; // JSON 数组（标签 ID），如 "[1,5,12]"
  avatar_url: string | null;
  evaluation_url: string | null;
  submitted_at: string | null;
  created_at: string;
  /** 文件所在存储后端（#111；旧备份可能缺失，恢复时回填本地后端） */
  storage_id: number;
}

export interface TagRow {
  id: number;
  name: string;
  type: "category" | "tag";
  parent_id: number | null;
  class_id: number;
  category_order: number;
  sort_order: number;
  active: number;
}

/** 档案提交历史版本行（#95）：每次提交的快照，users 表仅保留当前生效版本 */
export interface ProfileSubmissionRow {
  id: number;
  user_id: number;
  version: number;
  tags: string | null;
  avatar_url: string | null;
  evaluation_url: string | null;
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

/** insertProfileSubmission 的可写字段（不含 id/user_id/version） */
export interface ProfileSubmissionData {
  tags: string | null;
  avatar_url: string | null;
  evaluation_url: string | null;
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

/** 超限学生行（#95）：含班级用于教师管辖过滤 */
export interface ProfileSubmissionExceedRow {
  user_id: number;
  user_code: string;
  name: string;
  class_id: number | null;
  version_count: number;
}

export interface BackupTagRow {
  id: number;
  name: string;
  type?: "category" | "tag";
  parent_id?: number | null;
  category?: string;
  class_id?: number | null;
  category_order?: number;
  sort_order?: number;
  active?: number;
}

/** 将 v2 备份中的 category 文本标签转换为 v3 层级标签。 */
export function normalizeBackupTags(tags: BackupTagRow[]): TagRow[] {
  const maxId = tags.reduce((max, tag) => Math.max(max, tag.id), 0);
  let nextCategoryId = maxId + 1;
  const categories = new Map<string, TagRow>();
  const result: TagRow[] = [];

  for (const tag of tags) {
    if (tag.type === "category") {
      const category: TagRow = {
        id: tag.id,
        name: tag.name,
        type: "category",
        parent_id: null,
        class_id: tag.class_id ?? 0,
        category_order: tag.category_order ?? 0,
        sort_order: tag.sort_order ?? 0,
        active: tag.active ?? 1,
      };
      categories.set(tag.name, category);
      result.push(category);
    }
  }

  for (const tag of tags) {
    if (tag.type === "category") continue;
    const categoryName = tag.category;
    let parent = categoryName ? categories.get(categoryName) : undefined;
    if (!parent && categoryName) {
      parent = {
        id: nextCategoryId++,
        name: categoryName,
        type: "category",
        parent_id: null,
        class_id: tag.class_id ?? 0,
        category_order: tag.category_order ?? 0,
        sort_order: 0,
        active: 1,
      };
      categories.set(categoryName, parent);
      result.push(parent);
    }
    result.push({
      id: tag.id,
      name: tag.name,
      type: "tag",
      parent_id: tag.parent_id ?? parent?.id ?? null,
      class_id: tag.class_id ?? 0,
      category_order: tag.category_order ?? parent?.category_order ?? 0,
      sort_order: tag.sort_order ?? 0,
      active: tag.active ?? 1,
    });
  }

  return result.sort((a, b) => a.id - b.id);
}

export interface ClassRow {
  id: number;
  name: string;
  invitation_code: string;
  created_at: string;
}

export interface TeacherClassRow {
  id: number;
  teacher_id: number;
  class_id: number;
  created_at: string;
}

export interface Stats {
  total: number;
  today: number;
  uniqueTags: number;
  topTags: { tag: string; count: number }[];
}

export interface BackupData {
  version: number;
  sourceType: string;
  createdAt: string;
  users: UserRow[];
  classes: ClassRow[];
  teacher_classes: TeacherClassRow[];
  tags: BackupTagRow[];
  /** 审计日志（#110；旧备份可能缺失，读取方容忍 undefined） */
  audit_logs?: AuditLogRow[];
  /** 档案功能配置（configs_profile 键值对；旧备份可能缺失，读取方容忍 undefined） */
  configs_profile?: { key: string; value: string }[];
  /** 存储后端注册表（#111；不含凭据；旧备份可能缺失，读取方容忍 undefined） */
  storage_backends?: StorageBackendRow[];
  /** 档案提交历史版本（#95；旧备份可能缺失，读取方容忍 undefined） */
  profile_submissions?: ProfileSubmissionRow[];
}

/** configs_profile 表行 */
export interface ConfigRow {
  key: string;
  value: string;
}

/** audit_logs 表行（#110）：操作者字段为快照冗余，账号改名/删除后仍可追溯 */
export interface AuditLogRow {
  id: number;
  created_at: string;
  actor_id: number | null; // 登录失败时为 NULL
  actor_user_code: string | null;
  actor_name: string | null;
  actor_role: string | null;
  action: string; // 语义词汇表 `资源:动作`
  method: string | null;
  path: string | null;
  resource_type: string | null;
  resource_id: string | null;
  status: "success" | "failed" | string;
  error_message: string | null;
  ip: string | null;
  user_agent: string | null;
  metadata: string | null; // JSON，已脱敏 + 截断
}

/** 审计日志写入参数（created_at 由适配器统一生成） */
export type NewAuditLog = Omit<AuditLogRow, "id" | "created_at">;

/** 审计日志查询筛选（教师场景由调用方强制注入 actorId，防越权） */
export interface AuditLogFilters {
  page: number;
  pageSize: number;
  from?: string;
  to?: string;
  actorId?: number;
  actorRole?: string;
  actorQuery?: string; // 姓名/编号模糊
  action?: string;
  resourceType?: string;
  status?: string;
}

/** 档案功能配置项：自定义标签数量上限默认值 */
export const DEFAULT_MAX_CUSTOM_TAGS = 6;

/** 上传大小上限配置（#111，单位 MB，按资源类型分设） */
export const MAX_AVATAR_SIZE_KEY = "max_avatar_size_mb";
export const MAX_EVALUATION_SIZE_KEY = "max_evaluation_size_mb";
export const DEFAULT_MAX_AVATAR_SIZE_MB = 5;
export const DEFAULT_MAX_EVALUATION_SIZE_MB = 10;

/** 档案提交历史版本上限配置（#95）：超出后仅删除 DB 记录，文件保留 */
export const MAX_PROFILE_SUBMISSIONS_KEY = "max_profile_submissions";
export const DEFAULT_MAX_PROFILE_SUBMISSIONS = 10;

/** storage_backends 表行（#111）：凭据不入库，走 .env.local（S3_{id}_ACCESS_KEY / S3_{id}_SECRET_KEY） */
export interface StorageBackendRow {
  id: number;
  name: string;
  type: "local" | "s3";
  endpoint: string; // 公网端点（签名 URL 用）；local 后端为空
  internal_endpoint: string | null; // 内网端点，可选（服务端读写优先）
  region: string | null;
  bucket: string | null;
  path_prefix: string | null; // 对象根目录前缀，可选
  is_default: number; // 0/1，唯一默认由事务保证
  created_at: string;
  updated_at: string;
}

export interface NewStorageBackend {
  name: string;
  type: "local" | "s3";
  endpoint?: string;
  internal_endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  path_prefix?: string | null;
}

export interface StorageBackendUpdateFields {
  name?: string;
  endpoint?: string;
  internal_endpoint?: string | null;
  region?: string | null;
  bucket?: string | null;
  path_prefix?: string | null;
}

export interface NewUser {
  user_code: string;
  password_hash?: string;
  role: string;
  name: string;
  class_id?: number | null;
}

export interface UserUpdateFields {
  name?: string;
  class_id?: number | null;
  password_hash?: string | null;
}

export interface DbAdapter {
  init(): Promise<void> | void;

  // users
  insertUser(user: NewUser): Promise<number> | number;
  getUserByCode(userCode: string): Promise<UserRow | undefined> | UserRow | undefined;
  getUserById(id: number): Promise<UserRow | undefined> | UserRow | undefined;
  getAdminUser(): Promise<UserRow | undefined> | UserRow | undefined;
  updateUser(id: number, fields: UserUpdateFields): Promise<void> | void;
  deleteStudents(userCodes: string[]): Promise<number> | number;

  getStudents(): Promise<UserRow[]> | UserRow[];
  getStudentByCode(userCode: string): Promise<UserRow | undefined> | UserRow | undefined;

  // submissions
  upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, storageId: number): Promise<void> | void;
  getSubmittedProfiles(
    page: number,
    pageSize: number
  ): Promise<{ rows: UserRow[]; total: number }> | { rows: UserRow[]; total: number };
  getAllSubmitted(): Promise<UserRow[]> | UserRow[];
  clearSubmissions(userCodes: string[]): Promise<number> | number;

  // profile_submissions（档案提交历史版本，#95）
  insertProfileSubmission(userId: number, version: number, data: ProfileSubmissionData): Promise<number> | number;
  getMaxProfileSubmissionVersion(userId: number): Promise<number> | number;
  getProfileSubmissions(userId: number): Promise<ProfileSubmissionRow[]> | ProfileSubmissionRow[];
  getProfileSubmission(id: number): Promise<ProfileSubmissionRow | undefined> | ProfileSubmissionRow | undefined;
  deleteOldestProfileSubmissions(userId: number, count: number): Promise<number> | number;
  setCurrentProfileSubmission(versionId: number, userId: number): Promise<void> | void;
  getStudentsExceedingSubmissionLimit(
    maxVersions: number
  ): Promise<ProfileSubmissionExceedRow[]> | ProfileSubmissionExceedRow[];
  /** 高层事务函数：提交档案 + 生成版本快照 + 超限清理，原子完成 */
  submitProfileWithVersion(
    userCode: string,
    tagsJson: string,
    avatarUrl: string,
    evaluationUrl: string,
    storageId: number
  ): Promise<{ version: number }> | { version: number };

  // stats
  getStats(): Promise<Stats> | Stats;
  getTrends(days: number): Promise<{ date: string; count: number }[]> | { date: string; count: number }[];
  getCompareBy(by: "class" | "segment"): Promise<{ key: string; count: number }[]> | { key: string; count: number }[];

  // tags & classes
  getTags(): Promise<TagRow[]> | TagRow[];
  getActiveTags(): Promise<TagRow[]> | TagRow[];
  insertTag(tag: {
    name: string;
    type: "category" | "tag";
    parent_id?: number | null;
    category_order?: number;
    sort_order?: number;
  }): Promise<number> | number;
  updateTag(id: number, fields: {
    name?: string;
    parent_id?: number | null;
    category_order?: number;
    sort_order?: number;
  }): Promise<void> | void;
  /** 物理删除标签；分类会级联删除其下标签（#94：停用机制下线） */
  deleteTags(ids: number[]): Promise<void> | void;
  /** 重置为默认预设（标签管理页「恢复默认」，#94 补充） */
  resetTagsToDefaults(): Promise<void> | void;
  getClasses(): Promise<ClassRow[]> | ClassRow[];
  getClassByName(name: string): Promise<ClassRow | undefined> | ClassRow | undefined;
  getClassByInviteCode(code: string): Promise<ClassRow | undefined> | ClassRow | undefined;
  insertClass(name: string, invitationCode: string): Promise<number> | number;
  updateClass(id: number, fields: { name?: string; invitation_code?: string }): Promise<void> | void;
  deleteClass(id: number): Promise<void> | void;
  insertTeacherClass(teacherId: number, classId: number): Promise<void> | void;
  getTeacherClassPairs(): Promise<TeacherClassRow[]> | TeacherClassRow[];

  // teachers
  getTeachers(): Promise<UserRow[]> | UserRow[];
  deleteTeacher(id: number): Promise<void> | void;

  // configs_profile（档案功能配置，键值式）
  getProfileConfigs(): Promise<ConfigRow[]> | ConfigRow[];
  setProfileConfig(key: string, value: string): Promise<void> | void;

  // storage_backends（对象存储多后端注册表，#111）
  listStorageBackends(): Promise<StorageBackendRow[]> | StorageBackendRow[];
  getStorageBackend(id: number): Promise<StorageBackendRow | undefined> | StorageBackendRow | undefined;
  insertStorageBackend(backend: NewStorageBackend): Promise<number> | number;
  updateStorageBackend(id: number, fields: StorageBackendUpdateFields): Promise<void> | void;
  /** 删除保护（本地/默认/被引用不可删）由路由层校验，本方法直接删除 */
  deleteStorageBackend(id: number): Promise<void> | void;
  /** 事务：全部置 0 → 目标置 1，保证唯一默认 */
  setDefaultStorageBackend(id: number): Promise<void> | void;
  getDefaultStorageBackend(): Promise<StorageBackendRow | undefined> | StorageBackendRow | undefined;
  countUsersByStorageId(storageId: number): Promise<number> | number;
  getUsersByStorageId(storageId: number): Promise<UserRow[]> | UserRow[];
  updateUserStorageId(userId: number, storageId: number): Promise<void> | void;
  /** 迁移时原子更新文件引用：后端归属 + 两个文件 URL（本地代理路径 → 对象 key） */
  updateUserStorageRef(userId: number, storageId: number, avatarUrl: string | null, evaluationUrl: string | null): Promise<void> | void;

  // audit_logs（操作审计，#110：只追加 + 查询，不提供修改/删除）
  insertAuditLog(log: NewAuditLog): Promise<void> | void;
  queryAuditLogs(
    filters: AuditLogFilters
  ): Promise<{ rows: AuditLogRow[]; total: number }> | { rows: AuditLogRow[]; total: number };

  backup(): Promise<BackupData> | BackupData;
  restore(data: BackupData): Promise<void> | void;
  close(): Promise<void> | void;
}

/** 生成随机邀请码（排除易混淆字符） */
export function randomInviteCode(len = 8): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  for (let i = 0; i < len; i++) {
    code += chars[Math.floor(Math.random() * chars.length)];
  }
  return code;
}

let currentAdapter: DbAdapter | null = null;
let currentType: string = "";
let initPromise: Promise<void> | null = null;

function createAdapter(): DbAdapter {
  const config = getConfig();
  const dbType = config.type || "mysql";
  const configKey = dbType === "sqlite"
    ? `sqlite:${config.sqlite?.path || "./data/career.db"}`
    : `mysql:${JSON.stringify(config.mysql)}`;

  if (currentAdapter && currentType === configKey) return currentAdapter;

  if (currentAdapter) {
    try {
      const c = currentAdapter.close();
      if (c instanceof Promise) c.catch(() => {});
    } catch {}
  }

  const adapter = dbType === "sqlite"
    ? new SqliteAdapter(config.sqlite?.path || "./data/career.db")
    : new MysqlAdapter(config.mysql);
  currentAdapter = adapter;
  currentType = configKey;
  initPromise = Promise.resolve(adapter.init());
  initPromise.catch(() => {});
  return adapter;
}

async function ensureInit(): Promise<DbAdapter> {
  const adapter = createAdapter();
  if (initPromise) await initPromise;
  return adapter;
}

export async function insertUser(user: NewUser): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertUser(user));
}

export async function getUserByCode(userCode: string): Promise<UserRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getUserByCode(userCode));
}

export async function getUserById(id: number): Promise<UserRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getUserById(id));
}

export async function getAdminUser(): Promise<UserRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAdminUser());
}

export async function updateUser(id: number, fields: UserUpdateFields): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateUser(id, fields));
}

export async function deleteStudents(userCodes: string[]): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteStudents(userCodes));
}

export async function getStudents(): Promise<UserRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStudents());
}

export async function getStudentByCode(userCode: string): Promise<UserRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStudentByCode(userCode));
}

export async function upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string, storageId: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.upsertSubmission(userCode, tagsJson, avatarUrl, evaluationUrl, storageId));
}

export async function getSubmittedProfiles(
  page: number = 1,
  pageSize: number = 20
): Promise<{ rows: UserRow[]; total: number }> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getSubmittedProfiles(page, pageSize));
}

export async function getAllSubmitted(): Promise<UserRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAllSubmitted());
}

export async function clearSubmissions(userCodes: string[]): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.clearSubmissions(userCodes));
}

export async function insertProfileSubmission(userId: number, version: number, data: ProfileSubmissionData): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertProfileSubmission(userId, version, data));
}

export async function getMaxProfileSubmissionVersion(userId: number): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getMaxProfileSubmissionVersion(userId));
}

export async function getProfileSubmissions(userId: number): Promise<ProfileSubmissionRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getProfileSubmissions(userId));
}

export async function getProfileSubmission(id: number): Promise<ProfileSubmissionRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getProfileSubmission(id));
}

export async function deleteOldestProfileSubmissions(userId: number, count: number): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteOldestProfileSubmissions(userId, count));
}

export async function setCurrentProfileSubmission(versionId: number, userId: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.setCurrentProfileSubmission(versionId, userId));
}

export async function getStudentsExceedingSubmissionLimit(
  maxVersions: number
): Promise<ProfileSubmissionExceedRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStudentsExceedingSubmissionLimit(maxVersions));
}

export async function submitProfileWithVersion(
  userCode: string,
  tagsJson: string,
  avatarUrl: string,
  evaluationUrl: string,
  storageId: number
): Promise<{ version: number }> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.submitProfileWithVersion(userCode, tagsJson, avatarUrl, evaluationUrl, storageId));
}

export async function getStats(): Promise<Stats> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStats());
}

export async function getTrends(days: number): Promise<{ date: string; count: number }[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTrends(days));
}

export async function getCompareBy(by: "class" | "segment"): Promise<{ key: string; count: number }[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getCompareBy(by));
}

export async function getTags(): Promise<TagRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTags());
}

export async function getActiveTags(): Promise<TagRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getActiveTags());
}

export async function insertTag(tag: {
  name: string;
  type: "category" | "tag";
  parent_id?: number | null;
  category_order?: number;
  sort_order?: number;
}): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertTag(tag));
}

export async function updateTag(id: number, fields: {
  name?: string;
  parent_id?: number | null;
  category_order?: number;
  sort_order?: number;
}): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateTag(id, fields));
}

export async function deleteTags(ids: number[]): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteTags(ids));
}

export async function resetTagsToDefaults(): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.resetTagsToDefaults());
}

export async function getClasses(): Promise<ClassRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClasses());
}

export async function getClassByName(name: string): Promise<ClassRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClassByName(name));
}

export async function getClassByInviteCode(code: string): Promise<ClassRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClassByInviteCode(code));
}

export async function insertClass(name: string, invitationCode: string): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertClass(name, invitationCode));
}

export async function updateClass(id: number, fields: { name?: string; invitation_code?: string }): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateClass(id, fields));
}

export async function deleteClass(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteClass(id));
}

export async function insertTeacherClass(teacherId: number, classId: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertTeacherClass(teacherId, classId));
}

export async function getTeacherClassPairs(): Promise<TeacherClassRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTeacherClassPairs());
}

export async function getTeachers(): Promise<UserRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getTeachers());
}

export async function deleteTeacher(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteTeacher(id));
}

export async function getProfileConfigs(): Promise<ConfigRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getProfileConfigs());
}

export async function setProfileConfig(key: string, value: string): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.setProfileConfig(key, value));
}

export async function listStorageBackends(): Promise<StorageBackendRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.listStorageBackends());
}

export async function getStorageBackend(id: number): Promise<StorageBackendRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStorageBackend(id));
}

export async function insertStorageBackend(backend: NewStorageBackend): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertStorageBackend(backend));
}

export async function updateStorageBackend(id: number, fields: StorageBackendUpdateFields): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateStorageBackend(id, fields));
}

export async function deleteStorageBackend(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteStorageBackend(id));
}

export async function setDefaultStorageBackend(id: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.setDefaultStorageBackend(id));
}

export async function getDefaultStorageBackend(): Promise<StorageBackendRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getDefaultStorageBackend());
}

export async function countUsersByStorageId(storageId: number): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.countUsersByStorageId(storageId));
}

export async function getUsersByStorageId(storageId: number): Promise<UserRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getUsersByStorageId(storageId));
}

export async function updateUserStorageId(userId: number, storageId: number): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateUserStorageId(userId, storageId));
}

export async function updateUserStorageRef(userId: number, storageId: number, avatarUrl: string | null, evaluationUrl: string | null): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateUserStorageRef(userId, storageId, avatarUrl, evaluationUrl));
}

export async function insertAuditLog(log: NewAuditLog): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertAuditLog(log));
}

export async function queryAuditLogs(
  filters: AuditLogFilters
): Promise<{ rows: AuditLogRow[]; total: number }> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.queryAuditLogs(filters));
}

/** 读取上传大小上限（#111）；配置缺失或非法时回退默认值，合法范围 1–20 由路由层写入时校验 */
async function getSizeLimitMb(key: string, fallback: number): Promise<number> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === key)?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 20 ? parsed : fallback;
}

export async function getMaxAvatarSizeMb(): Promise<number> {
  return getSizeLimitMb(MAX_AVATAR_SIZE_KEY, DEFAULT_MAX_AVATAR_SIZE_MB);
}

export async function getMaxEvaluationSizeMb(): Promise<number> {
  return getSizeLimitMb(MAX_EVALUATION_SIZE_KEY, DEFAULT_MAX_EVALUATION_SIZE_MB);
}

/** 读取自定义标签数量上限；配置缺失或非法时回退默认值 */
export async function getMaxCustomTags(): Promise<number> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === "max_custom_tags")?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CUSTOM_TAGS;
}

/** 读取档案提交历史版本上限（#95）；配置缺失或非法时回退默认值，合法范围 1–100 由路由层写入时校验 */
export async function getMaxProfileSubmissions(): Promise<number> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === MAX_PROFILE_SUBMISSIONS_KEY)?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : DEFAULT_MAX_PROFILE_SUBMISSIONS;
}

/** 提交时限配置键（#96）：存储格式 `YYYY-MM-DD HH:mm`（Asia/Shanghai），空串表示不限制 */
export const SUBMISSION_DEADLINE_KEY = "submission_deadline";

/** 读取档案提交截止时间；未设置（缺失或空串）返回 null（不限制） */
export async function getSubmissionDeadline(): Promise<string | null> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === SUBMISSION_DEADLINE_KEY)?.value;
  return raw && raw.trim().length > 0 ? raw.trim() : null;
}

/** 纯函数：定宽格式 `YYYY-MM-DD HH:mm` 字典序即时间序，便于单测 */
export function isAfterDeadline(nowMinute: string, deadline: string): boolean {
  return nowMinute >= deadline.slice(0, 16);
}

/** 判断当前时刻（Asia/Shanghai，与 getNow 同源）是否已超过提交截止时间；未设置返回 false */
export async function isSubmissionClosed(): Promise<boolean> {
  const deadline = await getSubmissionDeadline();
  if (!deadline) return false;
  // 服务端统一按 Asia/Shanghai 计算，不依赖客户端时钟
  const now = new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" }).slice(0, 16);
  return isAfterDeadline(now, deadline);
}

export async function backup(): Promise<BackupData> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.backup());
}

export async function restore(data: BackupData): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.restore(data));
}

export async function closeDb(): Promise<void> {
  if (currentAdapter) {
    await Promise.resolve(currentAdapter.close());
    currentAdapter = null;
    currentType = "";
  }
}
