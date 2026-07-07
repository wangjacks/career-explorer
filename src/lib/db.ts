import Database from "better-sqlite3";
import path from "path";

const DB_PATH = path.join(process.cwd(), "data.db");

let db: Database.Database;

function getDb(): Database.Database {
  if (!db) {
    db = new Database(DB_PATH);
    db.pragma("journal_mode = WAL");
    db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tags TEXT NOT NULL,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }
  return db;
}

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

export function insertProfile(tags: string[], avatarUrl: string): number {
  const db = getDb();
  const stmt = db.prepare(
    "INSERT INTO profiles (tags, avatar_url) VALUES (?, ?)"
  );
  const result = stmt.run(JSON.stringify(tags), avatarUrl);
  return Number(result.lastInsertRowid);
}

export function getProfile(id: number): ProfileRow | undefined {
  const db = getDb();
  const stmt = db.prepare("SELECT * FROM profiles WHERE id = ?");
  return stmt.get(id) as ProfileRow | undefined;
}

export function getAllProfiles(
  page: number = 1,
  pageSize: number = 20
): { rows: ProfileRow[]; total: number } {
  const db = getDb();
  const total = (db.prepare("SELECT COUNT(*) as c FROM profiles").get() as { c: number }).c;
  const offset = (page - 1) * pageSize;
  const rows = db
    .prepare("SELECT * FROM profiles ORDER BY id DESC LIMIT ? OFFSET ?")
    .all(pageSize, offset) as ProfileRow[];
  return { rows, total };
}

export function deleteProfiles(ids: number[]): number {
  const db = getDb();
  if (ids.length === 0) return 0;
  const placeholders = ids.map(() => "?").join(",");
  const result = db
    .prepare(`DELETE FROM profiles WHERE id IN (${placeholders})`)
    .run(...ids);
  return result.changes;
}

export function getStats(): Stats {
  const db = getDb();

  const total = (db.prepare("SELECT COUNT(*) as c FROM profiles").get() as { c: number }).c;

  const today = (
    db
      .prepare(
        "SELECT COUNT(*) as c FROM profiles WHERE date(created_at) = date('now')"
      )
      .get() as { c: number }
  ).c;

  const allRows = db.prepare("SELECT tags FROM profiles").all() as {
    tags: string;
  }[];
  const tagCount: Record<string, number> = {};
  for (const row of allRows) {
    const parsed: string[] = JSON.parse(row.tags);
    for (const tag of parsed) {
      tagCount[tag] = (tagCount[tag] || 0) + 1;
    }
  }
  const uniqueTags = Object.keys(tagCount).length;
  const topTags = Object.entries(tagCount)
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count)
    .slice(0, 5);

  return { total, today, uniqueTags, topTags };
}
