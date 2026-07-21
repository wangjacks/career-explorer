import { getConfig } from "./db-config";
import { MysqlAdapter } from "./db-mysql";

export interface ProfileRow {
  student_id: string;
  tags: string;
  avatar_url: string | null;
  evaluation_url: string | null;
  created_at: string;
}

export interface StudentRow {
  student_id: string;
  name: string;
  class_name: string;
  created_at: string;
}

export interface Stats {
  total: number;
  today: number;
  uniqueTags: number;
  topTags: { tag: string; count: number }[];
}

export interface DbAdapter {
  insertStudent(studentId: string, name: string, className?: string): Promise<void> | void;
  insertStudentsBatch(students: { studentId: string; name: string; className?: string }[]): Promise<void> | void;
  getStudent(studentId: string): Promise<StudentRow | undefined> | StudentRow | undefined;
  getAllStudents(): Promise<StudentRow[]> | StudentRow[];
  deleteStudents(ids: string[]): Promise<number> | number;

  insertProfile(studentId: string, tags: string[], avatarUrl: string, evaluationUrl: string): Promise<void> | void;
  getProfile(studentId: string): Promise<ProfileRow | undefined> | ProfileRow | undefined;
  getAllProfiles(
    page: number,
    pageSize: number
  ): Promise<{ rows: (ProfileRow & { studentName?: string })[]; total: number }> | { rows: (ProfileRow & { studentName?: string })[]; total: number };
  deleteProfiles(studentIds: string[]): Promise<number> | number;
  getAllProfilesRaw(): Promise<ProfileRow[]> | ProfileRow[];
  getStats(): Promise<Stats> | Stats;
  getTrends(days: number): Promise<{ date: string; count: number }[]>;
  getCompareBy(by: "class" | "segment"): Promise<{ key: string; count: number }[]>;
  updateStudentClass(studentId: string, className: string): Promise<void> | void;
  getClasses(): Promise<string[]> | string[];
  close(): Promise<void> | void;
}

let currentAdapter: DbAdapter | null = null;
let currentType: string = "";
let initPromise: Promise<void> | null = null;

function createAdapter(): DbAdapter {
  const config = getConfig();
  const configType = JSON.stringify(config.mysql);

  if (currentAdapter && currentType === configType) return currentAdapter;

  if (currentAdapter) {
    try {
      const c = currentAdapter.close();
      if (c instanceof Promise) c.catch(() => {});
    } catch {}
  }

  const adapter = new MysqlAdapter(config.mysql);
  currentAdapter = adapter;
  currentType = configType;
  initPromise = adapter.init();
  initPromise.catch(() => {});
  return adapter;
}

async function ensureInit(): Promise<DbAdapter> {
  const adapter = createAdapter();
  if (initPromise) await initPromise;
  return adapter;
}

export async function insertStudent(studentId: string, name: string, className?: string): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertStudent(studentId, name, className));
}

export async function insertStudentsBatch(students: { studentId: string; name: string; className?: string }[]): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertStudentsBatch(students));
}

export async function getStudent(studentId: string): Promise<StudentRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getStudent(studentId));
}

export async function getAllStudents(): Promise<StudentRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAllStudents());
}

export async function deleteStudents(ids: string[]): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteStudents(ids));
}

export async function insertProfile(studentId: string, tags: string[], avatarUrl: string, evaluationUrl: string): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.insertProfile(studentId, tags, avatarUrl, evaluationUrl));
}

export async function getProfile(studentId: string): Promise<ProfileRow | undefined> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getProfile(studentId));
}

export async function getAllProfiles(
  page: number = 1,
  pageSize: number = 20
): Promise<{ rows: (ProfileRow & { studentName?: string })[]; total: number }> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAllProfiles(page, pageSize));
}

export async function deleteProfiles(studentIds: string[]): Promise<number> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.deleteProfiles(studentIds));
}

export async function getAllProfilesRaw(): Promise<ProfileRow[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getAllProfilesRaw());
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

export async function updateStudentClass(studentId: string, className: string): Promise<void> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.updateStudentClass(studentId, className));
}

export async function getClasses(): Promise<string[]> {
  const adapter = await ensureInit();
  return Promise.resolve(adapter.getClasses());
}

export async function closeDb(): Promise<void> {
  if (currentAdapter) {
    await Promise.resolve(currentAdapter.close());
    currentAdapter = null;
    currentType = "";
  }
}
