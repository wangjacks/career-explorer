import Database from "better-sqlite3";
import path from "path";
import type { ProfileRow, Stats, DbAdapter } from "./db";

const DB_PATH = path.join(process.cwd(), "data.db");

function getNow(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function getToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

export class SqliteAdapter implements DbAdapter {
  private db: Database.Database;

  constructor() {
    this.db = new Database(DB_PATH);
    this.db.pragma("journal_mode = WAL");
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        tags TEXT NOT NULL,
        avatar_url TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
  }

  insertProfile(tags: string[], avatarUrl: string): number {
    const stmt = this.db.prepare(
      "INSERT INTO profiles (tags, avatar_url, created_at) VALUES (?, ?, ?)"
    );
    const result = stmt.run(JSON.stringify(tags), avatarUrl, getNow());
    return Number(result.lastInsertRowid);
  }

  getProfile(id: number): ProfileRow | undefined {
    return this.db
      .prepare("SELECT * FROM profiles WHERE id = ?")
      .get(id) as ProfileRow | undefined;
  }

  getAllProfiles(
    page: number = 1,
    pageSize: number = 20
  ): { rows: ProfileRow[]; total: number } {
    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM profiles").get() as {
        c: number;
      }
    ).c;
    const offset = (page - 1) * pageSize;
    const rows = this.db
      .prepare("SELECT * FROM profiles ORDER BY id DESC LIMIT ? OFFSET ?")
      .all(pageSize, offset) as ProfileRow[];
    return { rows, total };
  }

  deleteProfiles(ids: number[]): number {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const result = this.db
      .prepare(`DELETE FROM profiles WHERE id IN (${placeholders})`)
      .run(...ids);
    return result.changes;
  }

  getAllProfilesRaw(): ProfileRow[] {
    return this.db
      .prepare("SELECT * FROM profiles ORDER BY id")
      .all() as ProfileRow[];
  }

  getStats(): Stats {
    const total = (
      this.db.prepare("SELECT COUNT(*) as c FROM profiles").get() as {
        c: number;
      }
    ).c;

    const today = (
      this.db
        .prepare(
          "SELECT COUNT(*) as c FROM profiles WHERE date(created_at) = ?"
        )
        .get(getToday()) as { c: number }
    ).c;

    const allRows = this.db
      .prepare("SELECT tags FROM profiles")
      .all() as { tags: string }[];
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

  close(): void {
    this.db.close();
  }
}
