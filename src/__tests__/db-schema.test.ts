import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync, existsSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";
import { normalizeBackupTags } from "../lib/db";

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-test-"));
  return path.join(dir, "test.db");
}

describe("新安装 Schema", () => {
  it("创建 4 张表并预填充 5 个分类和 56 个标签（仅安装时种子一次）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const tags = adapter.getTags();
    expect(tags.filter((tag) => tag.type === "category").length).toBe(5);
    expect(tags.filter((tag) => tag.type === "tag").length).toBe(56);
    expect(tags.filter((tag) => tag.parent_id === null).length).toBe(5);
    expect(adapter.getActiveTags().length).toBe(61);

    // 重复 init 不会重复填充（种子标记已写入）
    adapter.init();
    expect(adapter.getTags().length).toBe(61);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("种子仅在首次安装执行：手动清空后重启不会自动回填（#94 补充）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    expect(adapter.getTags().length).toBe(61);

    // 模拟运营手动清空标签（如重新导入前的准备）
    adapter.deleteTags(adapter.getTags().map((t) => t.id));
    expect(adapter.getTags().length).toBe(0);

    // 再次 init（模拟重启）：种子标记已存在，不再自动回填污染环境
    adapter.init();
    expect(adapter.getTags().length).toBe(0);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("恢复默认预设：清空后重插默认预设（#94 补充）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    // 自定义改动后重置：应回到 5 分类 + 56 标签
    adapter.insertTag({ name: "自定义分类", type: "category", category_order: 9 });
    adapter.resetTagsToDefaults();
    const tags = adapter.getTags();
    expect(tags.filter((tag) => tag.type === "category").length).toBe(5);
    expect(tags.filter((tag) => tag.type === "tag").length).toBe(56);
    expect(tags.some((tag) => tag.name === "自定义分类")).toBe(false);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("支持标签层级 CRUD 与物理删除（#94：停用机制下线，删除分类级联删除其下标签）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const categoryId = adapter.insertTag({ name: "能力", type: "category", category_order: 3 });
    const tagId = adapter.insertTag({ name: "分析", type: "tag", parent_id: categoryId, sort_order: 0 });
    adapter.updateTag(tagId, { name: "分析能力" });
    expect(adapter.getTags().find((tag) => tag.id === tagId)?.name).toBe("分析能力");

    // 删除分类：其下标签一并物理删除（含重复分类下的标签）
    const otherTagId = adapter.insertTag({ name: "协作", type: "tag", parent_id: categoryId, sort_order: 1 });
    adapter.deleteTags([categoryId]);
    const afterDelete = adapter.getTags();
    expect(afterDelete.some((tag) => tag.id === categoryId)).toBe(false);
    expect(afterDelete.some((tag) => tag.id === tagId)).toBe(false);
    expect(afterDelete.some((tag) => tag.id === otherTagId)).toBe(false);

    // 单个二级标签删除不影响分类本身；空数组无副作用；学生已提交数据（文本直存）不受影响——此处仅验证标签表行为
    const keepCatId = adapter.insertTag({ name: "临时分类", type: "category", category_order: 4 });
    const singleTagId = adapter.insertTag({ name: "临时标签", type: "tag", parent_id: keepCatId, sort_order: 0 });
    adapter.deleteTags([singleTagId]);
    expect(adapter.getTags().some((tag) => tag.id === singleTagId)).toBe(false);
    expect(adapter.getTags().some((tag) => tag.id === keepCatId)).toBe(true);
    adapter.deleteTags([]);
    expect(adapter.getTags().some((tag) => tag.id === keepCatId)).toBe(true);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});

describe("按邀请码查班级", () => {
  it("insertClass 后按邀请码命中 / 无效码返回 undefined", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    adapter.insertClass("测试班级", "TEST123");

    const found = adapter.getClassByInviteCode("TEST123");
    expect(found).toBeDefined();
    expect(found!.name).toBe("测试班级");
    expect(found!.invitation_code).toBe("TEST123");

    expect(adapter.getClassByInviteCode("NOPE")).toBeUndefined();

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});

describe("旧标签 Schema 迁移", () => {
  it("将 category 文本迁移为分类记录和 parent_id，保留原标签 ID", () => {
    const dbPath = makeTmpDb();
    const legacy = new Database(dbPath);
    legacy.exec(`
      CREATE TABLE tags (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        category TEXT NOT NULL,
        class_id INTEGER,
        category_order INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        UNIQUE(name, class_id)
      )
    `);
    legacy.prepare(
      "INSERT INTO tags (id, name, category, class_id, category_order, sort_order) VALUES (?, ?, ?, 0, ?, ?)"
    ).run(10, "阅读", "兴趣", 0, 0);
    legacy.prepare(
      "INSERT INTO tags (id, name, category, class_id, category_order, sort_order) VALUES (?, ?, ?, 0, ?, ?)"
    ).run(11, "音乐", "兴趣", 0, 1);
    legacy.close();

    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    const tags = adapter.getTags();
    const category = tags.find((tag) => tag.type === "category" && tag.name === "兴趣");
    expect(category).toBeDefined();
    expect(tags.find((tag) => tag.id === 10)).toMatchObject({ type: "tag", parent_id: category!.id });
    expect(tags.find((tag) => tag.id === 11)).toMatchObject({ type: "tag", parent_id: category!.id });

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("兼容 v2 备份中的 category 标签结构", () => {
    const tags = normalizeBackupTags([
      { id: 10, name: "阅读", category: "兴趣", class_id: 0, category_order: 0, sort_order: 0 },
    ]);
    const category = tags.find((tag) => tag.type === "category");
    expect(category?.name).toBe("兴趣");
    expect(tags.find((tag) => tag.id === 10)).toMatchObject({ type: "tag", parent_id: category?.id });
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

    // 学生已迁移，标签为名称
    const student = adapter.getStudentByCode("202505050101");
    expect(student).toBeDefined();
    expect(student!.name).toBe("张三");
    expect(student!.submitted_at).toBeTruthy();
    const tagNames = JSON.parse(student!.tags!) as string[];
    expect(tagNames.sort()).toEqual(["编程", "认真", "阅读"]);

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
    const localBackendId = adapter.getDefaultStorageBackend()!.id;
    adapter.upsertSubmission("202505050101", JSON.stringify(["音乐", "设计"]), "/a.png", "/w.png", localBackendId);

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
    expect(data.version).toBe(4);
    adapter.clearSubmissions(["202505050101"]);
    expect(adapter.getStats().total).toBe(0);
    adapter.restore(data);
    expect(adapter.getStats().total).toBe(1);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});

describe("班级管理与教师账户", () => {
  it("班级 CRUD：改名/删除，删除后学生 class_id 置 NULL（显式清理）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const classId = adapter.insertClass("一班", "AAAA1111");
    adapter.updateClass(classId, { name: "一班（改）" });
    expect(adapter.getClassByName("一班（改）")?.id).toBe(classId);

    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三", class_id: classId });
    adapter.deleteClass(classId);

    expect(adapter.getClasses()).toHaveLength(0);
    expect(adapter.getStudentByCode("202505050101")?.class_id).toBeNull();

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("删班后统计 compare 归入「未分班」分组", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const classId = adapter.insertClass("一班", "BBBB2222");
    adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四", class_id: classId });
    adapter.upsertSubmission("202505050102", "[]", "/a.png", "/w.png", adapter.getDefaultStorageBackend()!.id);
    expect(adapter.getCompareBy("class")).toEqual([{ key: "一班", count: 1 }]);

    adapter.deleteClass(classId);
    expect(adapter.getCompareBy("class")).toEqual([{ key: "未分班", count: 1 }]);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("邀请码：唯一约束，重置后旧码失效新码可查", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const id1 = adapter.insertClass("一班", "CCCC3333");
    adapter.insertClass("二班", "DDDD4444");
    expect(() => adapter.insertClass("三班", "CCCC3333")).toThrow();

    adapter.updateClass(id1, { invitation_code: "EEEE5555" });
    expect(adapter.getClassByInviteCode("CCCC3333")).toBeUndefined();
    expect(adapter.getClassByInviteCode("EEEE5555")?.id).toBe(id1);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("teacher_classes 写入与查询，删班/删教师时连带清理", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const teacherId = adapter.insertUser({ user_code: "10000001", role: "teacher", name: "王老师" });
    const c1 = adapter.insertClass("一班", "FFFF6666");
    const c2 = adapter.insertClass("二班", "GGGG7777");
    adapter.insertTeacherClass(teacherId, c1);
    adapter.insertTeacherClass(teacherId, c2);
    expect(adapter.getTeacherClassPairs()).toHaveLength(2);

    adapter.deleteClass(c1);
    expect(adapter.getTeacherClassPairs()).toHaveLength(1);

    adapter.deleteTeacher(teacherId);
    expect(adapter.getTeacherClassPairs()).toHaveLength(0);
    expect(adapter.getTeachers()).toHaveLength(0);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("教师账户：getTeachers 过滤角色，编号唯一约束", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    adapter.insertUser({ user_code: "10000001", role: "teacher", name: "王老师" });
    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });

    const teachers = adapter.getTeachers();
    expect(teachers).toHaveLength(1);
    expect(teachers[0].user_code).toBe("10000001");

    // 按 id 回查（会话检测实时姓名依赖此方法）
    const byId = adapter.getUserById(teachers[0].id);
    expect(byId?.name).toBe("王老师");
    adapter.updateUser(teachers[0].id, { name: "王老师（改）" });
    expect(adapter.getUserById(teachers[0].id)?.name).toBe("王老师（改）");

    expect(() => adapter.insertUser({ user_code: "10000001", role: "teacher", name: "重复" })).toThrow();

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});

describe("审计日志（#110）", () => {
  const sampleLog = (overrides: Partial<Parameters<SqliteAdapter["insertAuditLog"]>[0]> = {}) => ({
    actor_id: 1,
    actor_user_code: "10001",
    actor_name: "管理员",
    actor_role: "admin",
    action: "student:create",
    method: "POST",
    path: "/api/manage/students",
    resource_type: "student",
    resource_id: "202505050101",
    status: "success",
    error_message: null,
    ip: "127.0.0.1",
    user_agent: "vitest",
    metadata: JSON.stringify({ name: "张三" }),
    ...overrides,
  });

  it("insertAuditLog + queryAuditLogs 分页与筛选", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    adapter.insertAuditLog(sampleLog());
    adapter.insertAuditLog(sampleLog({ actor_id: 2, actor_user_code: "10000001", actor_name: "王老师", actor_role: "teacher", action: "class:create", resource_type: "class", resource_id: "1" }));
    adapter.insertAuditLog(sampleLog({ status: "failed", error_message: "学号不存在", action: "student:update" }));

    // 全量：倒序返回（最新在前）
    const all = adapter.queryAuditLogs({ page: 1, pageSize: 20 });
    expect(all.total).toBe(3);
    expect(all.rows[0].action).toBe("student:update");

    // action 筛选
    const byAction = adapter.queryAuditLogs({ page: 1, pageSize: 20, action: "student:create" });
    expect(byAction.total).toBe(1);

    // 操作者强制筛选（教师越权防护的数据层支撑）
    const byActor = adapter.queryAuditLogs({ page: 1, pageSize: 20, actorId: 2 });
    expect(byActor.total).toBe(1);
    expect(byActor.rows[0].actor_name).toBe("王老师");

    // 结果筛选 + 模糊搜索 + 分页
    expect(adapter.queryAuditLogs({ page: 1, pageSize: 20, status: "failed" }).total).toBe(1);
    expect(adapter.queryAuditLogs({ page: 1, pageSize: 20, actorQuery: "王" }).total).toBe(1);
    // 按对象编号搜索（#117 补强）：resource_id 命中「关于该学生」的记录（样例 1、3 的 resource_id 均为该学号）
    expect(adapter.queryAuditLogs({ page: 1, pageSize: 20, actorQuery: "202505050101" }).total).toBe(2);
    expect(adapter.queryAuditLogs({ page: 1, pageSize: 2 }).rows).toHaveLength(2);
    expect(adapter.queryAuditLogs({ page: 2, pageSize: 2 }).rows).toHaveLength(1);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });

  it("备份含 audit_logs 且恢复后保留；旧备份无此字段时保留当前记录", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    adapter.insertAuditLog(sampleLog());
    const data = adapter.backup();
    expect(Array.isArray(data.audit_logs)).toBe(true);
    expect(data.audit_logs).toHaveLength(1);

    // 恢复后审计记录保留（新增一条验证替换而非累加）
    adapter.insertAuditLog(sampleLog({ action: "audit:query" }));
    expect(adapter.queryAuditLogs({ page: 1, pageSize: 20 }).total).toBe(2);
    adapter.restore(data);
    expect(adapter.queryAuditLogs({ page: 1, pageSize: 20 }).total).toBe(1);

    // 旧备份无 audit_logs 字段 → 保留当前审计记录不动（兼容）
    const legacy = { ...data, audit_logs: undefined };
    adapter.insertAuditLog(sampleLog({ action: "auth:login" }));
    adapter.restore(legacy);
    expect(adapter.queryAuditLogs({ page: 1, pageSize: 20 }).total).toBe(2);

    adapter.close();
    rmSync(path.dirname(dbPath), { recursive: true, force: true });
  });
});
