import { getConfig } from "./db-config";
import { SqliteAdapter } from "./db-sqlite";
import { MysqlAdapter } from "./db-mysql";

export interface ProfileRow {
  student_id: string;
  tags: string;
  avatar_url: string | null;
  created_at: string;
}

export interface StudentRow {
  student_id: string;
  name: string;
  created_at: string;
}

export interface Stats {
  total: number;
  today: number;
  uniqueTags: number;
  topTags: { tag: string; count: number }[];
}

export interface DbAdapter {
  // Students
  insertStudent(studentId: string, name: string): Promise<void> | void;
  insertStudentsBatch(students: { studentId: string; name: string }[]): Promise<void> | void;
  getStudent(studentId: string): Promise<StudentRow | undefined> | StudentRow | undefined;
  getAllStudents(): Promise<StudentRow[]> | StudentRow[];
  deleteStudents(ids: string[]): Promise<number> | number;

  // Profiles
  insertProfile(studentId: string, tags: string[], avatarUrl: string): Promise<void> | void;
  getProfile(studentId: string): Promise<ProfileRow | undefined> | ProfileRow | undefined;
  getAllProfiles(
    page: number,
    pageSize: number
  ): Promise<{ rows: (ProfileRow & { studentName?: string })[]; total: number }> | { rows: (ProfileRow & { studentName?: string })[]; total: number };
  deleteProfiles(studentIds: string[]): Promise<number> | number;
  getAllProfilesRaw(): Promise<ProfileRow[]> | ProfileRow[];
  getStats(): Promise<Stats> | Stats;
  close(): Promise<void> | void;
}

let currentAdapter: DbAdapter | null = null;
let currentType: string = "";

function createAdapter(): DbAdapter {
  const config = getConfig();
  const configType = `${config.type}-${JSON.stringify(config.mysql)}`;

  if (currentAdapter && currentType === configType) {
    return currentAdapter;
  }

  if (currentAdapter) {
    try {
      const c = currentAdapter.close();
      if (c instanceof Promise) c.catch(() => {});
    } catch {}
  }

  if (config.type === "mysql") {
    const adapter = new MysqlAdapter(config.mysql);
    currentAdapter = adapter;
    currentType = configType;
    return adapter;
  }

  const adapter = new SqliteAdapter();
  currentAdapter = adapter;
  currentType = configType;
  return adapter;
}

// Async wrappers
export async function insertStudent(studentId: string, name: string): Promise<void> {
  return Promise.resolve(createAdapter().insertStudent(studentId, name));
}

export async function insertStudentsBatch(students: { studentId: string; name: string }[]): Promise<void> {
  return Promise.resolve(createAdapter().insertStudentsBatch(students));
}

export async function getStudent(studentId: string): Promise<StudentRow | undefined> {
  return Promise.resolve(createAdapter().getStudent(studentId));
}

export async function getAllStudents(): Promise<StudentRow[]> {
  return Promise.resolve(createAdapter().getAllStudents());
}

export async function deleteStudents(ids: string[]): Promise<number> {
  return Promise.resolve(createAdapter().deleteStudents(ids));
}

export async function insertProfile(studentId: string, tags: string[], avatarUrl: string): Promise<void> {
  return Promise.resolve(createAdapter().insertProfile(studentId, tags, avatarUrl));
}

export async function getProfile(studentId: string): Promise<ProfileRow | undefined> {
  return Promise.resolve(createAdapter().getProfile(studentId));
}

export async function getAllProfiles(
  page: number = 1,
  pageSize: number = 20
): Promise<{ rows: (ProfileRow & { studentName?: string })[]; total: number }> {
  return Promise.resolve(createAdapter().getAllProfiles(page, pageSize));
}

export async function deleteProfiles(studentIds: string[]): Promise<number> {
  return Promise.resolve(createAdapter().deleteProfiles(studentIds));
}

export async function getAllProfilesRaw(): Promise<ProfileRow[]> {
  return Promise.resolve(createAdapter().getAllProfilesRaw());
}

export async function getStats(): Promise<Stats> {
  return Promise.resolve(createAdapter().getStats());
}

export async function closeDb(): Promise<void> {
  if (currentAdapter) {
    await Promise.resolve(currentAdapter.close());
    currentAdapter = null;
    currentType = "";
  }
}
