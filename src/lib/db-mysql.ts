import mysql from "mysql2/promise";
import type { ProfileRow, Stats, DbAdapter } from "./db";

function getNow(): string {
  return new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" });
}

function getToday(): string {
  return new Date().toLocaleDateString("sv-SE", { timeZone: "Asia/Shanghai" });
}

interface MySqlConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export class MysqlAdapter implements DbAdapter {
  private pool: mysql.Pool;

  constructor(config: MySqlConfig) {
    this.pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      timezone: "+08:00",
      waitForConnections: true,
      connectionLimit: 5,
    });
  }

  async init(): Promise<void> {
    await this.pool.execute(`
      CREATE TABLE IF NOT EXISTS profiles (
        id INT AUTO_INCREMENT PRIMARY KEY,
        tags TEXT NOT NULL,
        avatar_url VARCHAR(500),
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4
    `);
  }

  async insertProfile(tags: string[], avatarUrl: string): Promise<number> {
    const [result] = await this.pool.execute(
      "INSERT INTO profiles (tags, avatar_url, created_at) VALUES (?, ?, ?)",
      [JSON.stringify(tags), avatarUrl, getNow()]
    );
    return (result as mysql.ResultSetHeader).insertId;
  }

  async getProfile(id: number): Promise<ProfileRow | undefined> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM profiles WHERE id = ?",
      [id]
    );
    return (rows as ProfileRow[])[0];
  }

  async getAllProfiles(
    page: number = 1,
    pageSize: number = 20
  ): Promise<{ rows: ProfileRow[]; total: number }> {
    const [countResult] = await this.pool.execute(
      "SELECT COUNT(*) as c FROM profiles"
    );
    const total = (countResult as { c: number }[])[0].c;

    const offset = (page - 1) * pageSize;
    const [rows] = await this.pool.execute(
      "SELECT * FROM profiles ORDER BY id DESC LIMIT ? OFFSET ?",
      [pageSize, offset]
    );
    return { rows: rows as ProfileRow[], total };
  }

  async deleteProfiles(ids: number[]): Promise<number> {
    if (ids.length === 0) return 0;
    const placeholders = ids.map(() => "?").join(",");
    const [result] = await this.pool.execute(
      `DELETE FROM profiles WHERE id IN (${placeholders})`,
      ids
    );
    return (result as mysql.ResultSetHeader).affectedRows;
  }

  async getAllProfilesRaw(): Promise<ProfileRow[]> {
    const [rows] = await this.pool.execute(
      "SELECT * FROM profiles ORDER BY id"
    );
    return rows as ProfileRow[];
  }

  async getStats(): Promise<Stats> {
    const [countResult] = await this.pool.execute(
      "SELECT COUNT(*) as c FROM profiles"
    );
    const total = (countResult as { c: number }[])[0].c;

    const [todayResult] = await this.pool.execute(
      "SELECT COUNT(*) as c FROM profiles WHERE DATE(created_at) = ?",
      [getToday()]
    );
    const today = (todayResult as { c: number }[])[0].c;

    const [allRows] = await this.pool.execute("SELECT tags FROM profiles");
    const tagCount: Record<string, number> = {};
    for (const row of allRows as { tags: string }[]) {
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

  async close(): Promise<void> {
    await this.pool.end();
  }
}
