import { getConfig } from "./db-config";
import { SqliteAdapter } from "./db-sqlite";
import { MysqlAdapter } from "./db-mysql";

export interface ProfileRow {
  id: number;
  tags: string;
  avatar_url: string | null;
  created_at: string;
}

export interface Stats {
  total: number;
  today: number;
  uniqueTags: number;
  topTags: { tag: string; count: number }[];
}

export interface DbAdapter {
  insertProfile(tags: string[], avatarUrl: string): Promise<number> | number;
  getProfile(id: number): Promise<ProfileRow | undefined> | ProfileRow | undefined;
  getAllProfiles(
    page: number,
    pageSize: number
  ): Promise<{ rows: ProfileRow[]; total: number }> | { rows: ProfileRow[]; total: number };
  deleteProfiles(ids: number[]): Promise<number> | number;
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

// Async wrappers that work for both sync (SQLite) and async (MySQL) adapters
export async function insertProfile(tags: string[], avatarUrl: string): Promise<number> {
  return Promise.resolve(createAdapter().insertProfile(tags, avatarUrl));
}

export async function getProfile(id: number): Promise<ProfileRow | undefined> {
  return Promise.resolve(createAdapter().getProfile(id));
}

export async function getAllProfiles(
  page: number = 1,
  pageSize: number = 20
): Promise<{ rows: ProfileRow[]; total: number }> {
  return Promise.resolve(createAdapter().getAllProfiles(page, pageSize));
}

export async function deleteProfiles(ids: number[]): Promise<number> {
  return Promise.resolve(createAdapter().deleteProfiles(ids));
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
