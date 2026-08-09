import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-test-"));
  return path.join(dir, "test.db");
}

describe("新安装 Schema", () => {
  it("创建 4 张表并预填充 15 个标签", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const tags = adapter.getTags();
    expect(tags.length).toBe(15);
    const categories = new Set(tags.map((t) => t.category));
    expect(categories.size).toBe(3);

    // 重复 init 不应重复填充
    adapter.init();
    expect(adapter.getTags().length).toBe(15);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});

describe("旧数据迁移", () => {
  it("students + profiles 迁移到 users，标签名称转 ID，创建 admin，删除旧表", () => {
    const dbPath = makeTmpDb();

    // 构造旧数据库
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE students (
        student_id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        class_name TEXT DEFAULT '',
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    legacy.exec(`
      CREATE TABLE profiles (
        student_id TEXT PRIMARY KEY,
        tags TEXT NOT NULL,
        avatar_url TEXT,
        evaluation_url TEXT,
        created_at TEXT DEFAULT (datetime('now', 'localtime'))
      )
    `);
    legacy
      .prepare("INSERT INTO students (student_id, name, class_name) VALUES (?, ?, ?)")
      .run("202505050101", "张三", "2025级1班");
    legacy
      .prepare("INSERT INTO students (student_id, name, class_name) VALUES (?, ?, ?)")
      .run("202505050102", "李四", "");
    legacy
      .prepare("INSERT INTO profiles (student_id, tags, avatar_url, evaluation_url) VALUES (?, ?, ?, ?)")
      .run("202505050101", JSON.stringify(["阅读", "编程", "认真"]), "/a.png", "/w.png");
    legacy.close();

    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    // 旧表已删除
    const raw = new Database(dbPath, { readonly: true });
    const tables = raw
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all() as { name: string }[];
    const names = tables.map((t) => t.name);
    expect(names).not.toContain("students");
    expect(names).not.toContain("profiles");
    raw.close();

    // 学生已迁移，标签为 ID
    const student = adapter.getStudentByCode("202505050101");
    expect(student).toBeDefined();
    expect(student!.name).toBe("张三");
    expect(student!.submitted_at).toBeTruthy();
    const tagIds = JSON.parse(student!.tags!) as number[];
    expect(tagIds.length).toBe(3);
    const allTags = adapter.getTags();
    const idToName = new Map(allTags.map((t) => [t.id, t.name]));
    expect(tagIds.map((id) => idToName.get(id))).toEqual(["阅读", "编程", "认真"]);

    // 未提交学生：submitted_at 为空
    const s2 = adapter.getStudentByCode("202505050102");
    expect(s2).toBeDefined();
    expect(s2!.submitted_at).toBeNull();

    // admin 用户（若 admin-hash.txt 存在）
    if (existsSync(path.join(process.cwd(), "admin-hash.txt"))) {
      const admin = adapter.getAdminUser();
      expect(admin).toBeDefined();
      expect(admin!.user_code).toBe("10001");
      expect(admin!.password_hash).toBeTruthy();
    }

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});

describe("提交流程", () => {
  it("upsertSubmission / getSubmittedProfiles / getStats / clearSubmissions", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    const allTags = adapter.getTags();
    const ids = allTags.filter((t) => ["音乐", "设计"].includes(t.name)).map((t) => t.id);
    adapter.upsertSubmission("202505050101", JSON.stringify(ids), "/a.png", "/w.png");

    const { rows, total } = adapter.getSubmittedProfiles(1, 20);
    expect(total).toBe(1);
    expect(rows[0].user_code).toBe("202505050101");

    const stats = adapter.getStats();
    expect(stats.total).toBe(1);
    expect(stats.uniqueTags).toBe(2);
    expect(stats.topTags.map((t) => t.tag).sort()).toEqual(["设计", "音乐"]);

    const trends = adapter.getTrends(7);
    expect(trends.length).toBe(1);
    expect(trends[0].count).toBe(1);

    const byClass = adapter.getCompareBy("class");
    expect(byClass).toEqual([{ key: "未分班", count: 1 }]);

    // 备份 / 恢复
    const data = adapter.backup();
    expect(data.version).toBe(2);
    adapter.clearSubmissions(["202505050101"]);
    expect(adapter.getStats().total).toBe(0);
    adapter.restore(data);
    expect(adapter.getStats().total).toBe(1);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});
