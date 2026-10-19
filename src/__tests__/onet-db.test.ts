import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../lib/db-sqlite";
import { getOnetOccupationSeeds, ONET_SEED_MARKER_KEY } from "../lib/onet";
import { ONET_DATASET_VERSION } from "../lib/onet-data";

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-onet-"));
  return path.join(dir, "test.db");
}

const SEED_COUNT = getOnetOccupationSeeds().length;

describe("onet_occupations 种子与查询（#226）", () => {
  it("首次 init 灌入全部职业，字段与快照一致", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const rows = adapter.getOnetOccupations();
    expect(rows).toHaveLength(SEED_COUNT);
    expect(SEED_COUNT).toBe(923);
    // 按 code 升序返回（快照本身也按 code 排序）
    expect(rows.map((row) => row.code)).toEqual([...rows.map((row) => row.code)].sort());

    const software = rows.find((row) => row.code === "15-1252.00")!;
    expect(software.name).toBe("Software Developers");
    expect(software.name_zh).toBe("软件开发工程师");
    expect(software.interest_code).toBe("IC");
    expect(software.job_zone).toBe(4);
    expect(software.education_level).toBe("本科");
    expect(software.cluster).toBe("计算机与数学");
    expect(software.dataset_version).toBe(ONET_DATASET_VERSION);
    expect(JSON.parse(software.interests_json)).toMatchObject({ R: 3.61, I: 6.05, C: 5.62 });

    // 未做首批译名的职业 name_zh 为 null（展示层回退英文名）
    const untranslated = rows.find((row) => row.name_zh === null)!;
    expect(untranslated).toBeDefined();
    expect(untranslated.name.trim()).not.toBe("");

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("种子幂等：重复 init 不重复灌入，标记写在 configs_profile", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    adapter.init();

    expect(adapter.getOnetOccupations()).toHaveLength(SEED_COUNT);
    expect(adapter.getProfileConfigs().find((c) => c.key === ONET_SEED_MARKER_KEY)?.value).toBe(ONET_DATASET_VERSION);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("行数缺失或快照版本变化时整表重灌", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    // 少一行 → 下次 init 重灌补齐
    const raw = new Database(dbPath);
    raw.prepare("DELETE FROM onet_occupations WHERE code = ?").run("15-1252.00");
    raw.prepare("UPDATE configs_profile SET value = ? WHERE key = ?").run("29.3", ONET_SEED_MARKER_KEY);
    raw.close();
    expect(adapter.getOnetOccupations().length).toBe(SEED_COUNT - 1);

    adapter.init();
    expect(adapter.getOnetOccupations()).toHaveLength(SEED_COUNT);
    expect(adapter.getProfileConfigs().find((c) => c.key === ONET_SEED_MARKER_KEY)?.value).toBe(ONET_DATASET_VERSION);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("职业库不纳入备份（离线可重灌，避免备份膨胀）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const backup = adapter.backup() as unknown as Record<string, unknown>;
    expect(backup.onet_occupations).toBeUndefined();

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});

describe("onet_occupations 两适配器 Schema 对账", () => {
  const read = (file: string) => readFileSync(path.resolve(process.cwd(), "src/lib", file), "utf8");

  function columns(file: string): string[] {
    const lines = read(file).split(/\r?\n/);
    const start = lines.findIndex((line) => line.includes("CREATE TABLE IF NOT EXISTS onet_occupations ("));
    expect(start, `${file} 缺少 onet_occupations 建表语句`).toBeGreaterThanOrEqual(0);
    const out: string[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line.startsWith(")")) break;
      if (!line) continue;
      if (/^(INDEX|UNIQUE|KEY|CONSTRAINT|PRIMARY|FOREIGN)\b/i.test(line)) continue;
      const match = /^([a-z_][a-z0-9_]*)\s/.exec(line);
      if (match) out.push(match[1]);
    }
    return out;
  }

  it("SQLite / MySQL 列名与顺序完全一致", () => {
    const sqlite = columns("db-sqlite.ts");
    const mysql = columns("db-mysql.ts");
    expect(sqlite.length).toBeGreaterThan(0);
    expect(mysql).toEqual(sqlite);
    expect(sqlite).toEqual([
      "id",
      "code",
      "name",
      "name_zh",
      "interest_code",
      "interests_json",
      "job_zone",
      "education_level",
      "cluster",
      "dataset_version",
      "created_at",
    ]);
  });
});
