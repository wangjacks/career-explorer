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
  /** 档案功能配置（configs_profile 键值对；旧备份可能缺失，读取方容忍 undefined） */
  configs_profile?: { key: string; value: string }[];
}

/** configs_profile 表行 */
export interface ConfigRow {
  key: string;
  value: string;
}

/** 档案功能配置项：自定义标签数量上限默认值 */
export const DEFAULT_MAX_CUSTOM_TAGS = 6;

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
  upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string): Promise<void> | void;
  getSubmittedProfiles(
    page: number,
    pageSize: number
  ): Promise<{ rows: UserRow[]; total: number }> | { rows: UserRow[]; total: number };
  getAllSubmitted(): Promise<UserRow[]> | UserRow[];
  clearSubmissions(userCodes: string[]): Promise<number> | number;

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
  setTagActive(id: number, active: boolean): Promise<void> | void;
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

export async function upsertSubmission(userCode: string, tagsJson: string, avatarUrl: string, evaluationUrl: string): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.upsertSubmission(userCode, tagsJson, avatarUrl, evaluationUrl));
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

export async function setTagActive(id: number, active: boolean): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.setTagActive(id, active));
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

/** 读取自定义标签数量上限；配置缺失或非法时回退默认值 */
export async function getMaxCustomTags(): Promise<number> {
  const configs = await getProfileConfigs();
  const raw = configs.find((c) => c.key === "max_custom_tags")?.value;
  const parsed = raw === undefined ? NaN : Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_CUSTOM_TAGS;
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
