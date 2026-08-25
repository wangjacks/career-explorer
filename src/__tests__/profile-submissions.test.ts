import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";
import { DEFAULT_MAX_PROFILE_SUBMISSIONS, MAX_PROFILE_SUBMISSIONS_KEY } from "../lib/db";

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-test-"));
  return path.join(dir, "test.db");
}

function cleanup(dbPath: string): void {
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

/** 提交一次档案（走旧 upsertSubmission 模拟存量数据，不写版本表） */
function legacySubmit(adapter: SqliteAdapter, userCode: string, tagsJson: string): void {
  adapter.upsertSubmission(userCode, tagsJson, "/a.png", "/w.png", adapter.getDefaultStorageBackend()!.id);
}

describe("profile_submissions 迁移（#95）", () => {
  it("新装 init 后建表并写入默认版本上限配置", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const configs = adapter.getProfileConfigs();
    expect(configs.find((c) => c.key === MAX_PROFILE_SUBMISSIONS_KEY)?.value).toBe(String(DEFAULT_MAX_PROFILE_SUBMISSIONS));
    expect(adapter.getMaxProfileSubmissionVersion(1)).toBe(0);

    adapter.close();
    cleanup(dbPath);
  });

  it("存量已提交学生生成初始版本（version=1, is_current=1），未提交学生不生成", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四" });
    legacySubmit(adapter, "202505050101", "[1,2]");
    adapter.close();

    // 重新 init 模拟升级：存量已提交学生应生成初始版本记录
    const upgraded = new SqliteAdapter(dbPath);
    upgraded.init();
    const submitted = upgraded.getStudentByCode("202505050101")!;
    const unsubmitted = upgraded.getStudentByCode("202505050102")!;
    const rows = upgraded.getProfileSubmissions(submitted.id);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ version: 1, is_current: 1, tags: "[1,2]", avatar_url: "/a.png", evaluation_url: "/w.png" });
    expect(upgraded.getProfileSubmissions(unsubmitted.id)).toHaveLength(0);

    upgraded.close();
    cleanup(dbPath);
  });

  it("迁移幂等：重复 init 不重复生成初始版本", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    legacySubmit(adapter, "202505050101", "[1]");
    adapter.close();

    const upgraded = new SqliteAdapter(dbPath);
    upgraded.init();
    upgraded.init();
    const student = upgraded.getStudentByCode("202505050101")!;
    expect(upgraded.getProfileSubmissions(student.id)).toHaveLength(1);

    upgraded.close();
    cleanup(dbPath);
  });
});

describe("profile_submissions CRUD（#95）", () => {
  it("insertProfileSubmission / getMaxProfileSubmissionVersion / getProfileSubmissions / getProfileSubmission", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    const studentId = adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });

    const id1 = adapter.insertProfileSubmission(studentId, 1, {
      tags: "[1]",
      avatar_url: "/a1.png",
      evaluation_url: null,
      storage_id: 1,
      submitted_at: "2026-08-01 10:00:00",
      is_current: 0,
    });
    const id2 = adapter.insertProfileSubmission(studentId, 2, {
      tags: "[2]",
      avatar_url: "/a2.png",
      evaluation_url: "/w2.png",
      storage_id: 1,
      submitted_at: "2026-08-02 10:00:00",
      is_current: 1,
    });

    expect(adapter.getMaxProfileSubmissionVersion(studentId)).toBe(2);
    // 版本倒序返回（最新在前）
    const rows = adapter.getProfileSubmissions(studentId);
    expect(rows.map((r) => r.version)).toEqual([2, 1]);
    expect(rows[0].id).toBe(id2);
    expect(rows[1].id).toBe(id1);
    // 按 id 单查
    expect(adapter.getProfileSubmission(id1)).toMatchObject({ version: 1, is_current: 0 });
    expect(adapter.getProfileSubmission(99999)).toBeUndefined();
    // 其他用户互不可见
    const otherId = adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四" });
    expect(adapter.getProfileSubmissions(otherId)).toHaveLength(0);

    adapter.close();
    cleanup(dbPath);
  });

  it("deleteOldestProfileSubmissions 只删最旧版本（按 version 升序）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    const studentId = adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    for (let v = 1; v <= 4; v++) {
      adapter.insertProfileSubmission(studentId, v, {
        tags: `[${v}]`,
        avatar_url: null,
        evaluation_url: null,
        storage_id: 1,
        submitted_at: `2026-08-0${v} 10:00:00`,
        is_current: v === 4 ? 1 : 0,
      });
    }

    const deleted = adapter.deleteOldestProfileSubmissions(studentId, 2);
    expect(deleted).toBe(2);
    expect(adapter.getProfileSubmissions(studentId).map((r) => r.version)).toEqual([4, 3]);
    // count <= 0 无副作用
    expect(adapter.deleteOldestProfileSubmissions(studentId, 0)).toBe(0);
    expect(adapter.getProfileSubmissions(studentId)).toHaveLength(2);

    adapter.close();
    cleanup(dbPath);
  });

  it("setCurrentProfileSubmission 保证同用户仅一条当前版本", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    const studentId = adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    const id1 = adapter.insertProfileSubmission(studentId, 1, {
      tags: "[1]", avatar_url: null, evaluation_url: null, storage_id: 1,
      submitted_at: "2026-08-01 10:00:00", is_current: 1,
    });
    const id2 = adapter.insertProfileSubmission(studentId, 2, {
      tags: "[2]", avatar_url: null, evaluation_url: null, storage_id: 1,
      submitted_at: "2026-08-02 10:00:00", is_current: 0,
    });

    adapter.setCurrentProfileSubmission(id2, studentId);
    const rows = adapter.getProfileSubmissions(studentId);
    expect(rows.find((r) => r.id === id1)?.is_current).toBe(0);
    expect(rows.find((r) => r.id === id2)?.is_current).toBe(1);
    expect(rows.filter((r) => r.is_current === 1)).toHaveLength(1);

    adapter.close();
    cleanup(dbPath);
  });

  it("getProfileSubmissionOwnerByFileUrl：按快照文件反查归属（含班级与快照当时的后端）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    const classId = adapter.insertClass("一班", "AAAA1111");
    const studentId = adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三", class_id: classId });
    adapter.insertProfileSubmission(studentId, 1, {
      tags: "[1]", avatar_url: "/old-a.png", evaluation_url: "/old-w.png", storage_id: 2,
      submitted_at: "2026-08-01 10:00:00", is_current: 1,
    });

    expect(adapter.getProfileSubmissionOwnerByFileUrl("/old-a.png")).toMatchObject({
      user_id: studentId,
      class_id: classId,
      storage_id: 2,
    });
    expect(adapter.getProfileSubmissionOwnerByFileUrl("/old-w.png")).toMatchObject({ user_id: studentId });
    // 未命中返回 undefined
    expect(adapter.getProfileSubmissionOwnerByFileUrl("/nope.png")).toBeUndefined();

    adapter.close();
    cleanup(dbPath);
  });

  it("clearSubmissions 同步清除历史版本快照（管理端删除档案后不可再查看/恢复，review 修复）", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四" });
    const storageId = adapter.getDefaultStorageBackend()!.id;
    adapter.submitProfileWithVersion("202505050101", "[1]", "/a1.png", "/w1.png", storageId);
    adapter.submitProfileWithVersion("202505050101", "[2]", "/a2.png", "/w2.png", storageId);
    adapter.submitProfileWithVersion("202505050102", "[1]", "/b1.png", "/x1.png", storageId);

    const deleted = adapter.clearSubmissions(["202505050101"]);
    expect(deleted).toBe(1);
    // 目标学生：users 置未提交 + 快照清空
    expect(adapter.getStudentByCode("202505050101")?.submitted_at).toBeNull();
    expect(adapter.getProfileSubmissions(adapter.getStudentByCode("202505050101")!.id)).toHaveLength(0);
    // 其他学生不受影响
    expect(adapter.getStudentByCode("202505050102")?.submitted_at).toBeTruthy();
    expect(adapter.getProfileSubmissions(adapter.getStudentByCode("202505050102")!.id)).toHaveLength(1);

    adapter.close();
    cleanup(dbPath);
  });
});

describe("submitProfileWithVersion（#95）", () => {
  it("首次提交生成 version=1 并更新 users；再次提交 version=2 且旧版本 is_current 置 0", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    const storageId = adapter.getDefaultStorageBackend()!.id;

    const first = adapter.submitProfileWithVersion("202505050101", "[1]", "/a1.png", "/w1.png", storageId);
    expect(first.version).toBe(1);
    const second = adapter.submitProfileWithVersion("202505050101", "[2]", "/a2.png", "/w2.png", storageId);
    expect(second.version).toBe(2);

    // users 保留最新
    const student = adapter.getStudentByCode("202505050101")!;
    expect(student.tags).toBe("[2]");
    expect(student.avatar_url).toBe("/a2.png");
    expect(student.submitted_at).toBeTruthy();
    expect(student.storage_id).toBe(storageId);
    // 版本快照完整（倒序），仅最新为当前
    const rows = adapter.getProfileSubmissions(student.id);
    expect(rows.map((r) => r.version)).toEqual([2, 1]);
    expect(rows[0]).toMatchObject({ tags: "[2]", is_current: 1 });
    expect(rows[1]).toMatchObject({ tags: "[1]", avatar_url: "/a1.png", is_current: 0 });

    adapter.close();
    cleanup(dbPath);
  });

  it("超限时自动删除最旧版本（仅 DB 记录），文件 URL 不受影响", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    adapter.setProfileConfig(MAX_PROFILE_SUBMISSIONS_KEY, "2");
    const storageId = adapter.getDefaultStorageBackend()!.id;

    adapter.submitProfileWithVersion("202505050101", "[1]", "/a1.png", "/w1.png", storageId);
    adapter.submitProfileWithVersion("202505050101", "[2]", "/a2.png", "/w2.png", storageId);
    const third = adapter.submitProfileWithVersion("202505050101", "[3]", "/a3.png", "/w3.png", storageId);
    expect(third.version).toBe(3);

    const student = adapter.getStudentByCode("202505050101")!;
    const rows = adapter.getProfileSubmissions(student.id);
    // 上限 2：version 1 被清理，仅保留 2、3
    expect(rows.map((r) => r.version)).toEqual([3, 2]);
    expect(adapter.getMaxProfileSubmissionVersion(student.id)).toBe(3);
    // 最新 users 数据仍完整
    expect(student.tags).toBe("[3]");

    adapter.close();
    cleanup(dbPath);
  });

  it("学生不存在时事务回滚并抛错", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    expect(() =>
      adapter.submitProfileWithVersion("999999999999", "[]", "/a.png", "/w.png", 1)
    ).toThrow(/学生不存在/);
    // 无副作用
    expect(adapter.getProfileSubmissions(1)).toHaveLength(0);

    adapter.close();
    cleanup(dbPath);
  });
});

describe("备份恢复集成（#95）", () => {
  it("backup 导出版本记录，restore 后完整还原；旧备份无此字段时保留当前记录", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    const studentId = adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    const storageId = adapter.getDefaultStorageBackend()!.id;
    adapter.submitProfileWithVersion("202505050101", "[1]", "/a1.png", "/w1.png", storageId);
    adapter.submitProfileWithVersion("202505050101", "[2]", "/a2.png", "/w2.png", storageId);

    const data = adapter.backup();
    expect(data.version).toBe(4);
    expect(data.profile_submissions).toHaveLength(2);
    expect(data.profile_submissions![0]).toMatchObject({ user_id: studentId, version: 1, is_current: 0 });
    expect(data.profile_submissions![1]).toMatchObject({ user_id: studentId, version: 2, is_current: 1 });

    // 恢复后版本记录完整还原（替换而非累加）
    adapter.submitProfileWithVersion("202505050101", "[3]", "/a3.png", "/w3.png", storageId);
    expect(adapter.getProfileSubmissions(studentId)).toHaveLength(3);
    adapter.restore(data);
    const restored = adapter.getProfileSubmissions(studentId);
    expect(restored).toHaveLength(2);
    expect(restored.map((r) => r.version)).toEqual([2, 1]);
    expect(restored.find((r) => r.version === 2)?.is_current).toBe(1);

    // 旧备份（无 profile_submissions 字段）→ 保留当前记录不动（兼容）
    const legacy = { ...data, profile_submissions: undefined };
    adapter.restore(legacy);
    expect(adapter.getProfileSubmissions(studentId)).toHaveLength(2);

    adapter.close();
    cleanup(dbPath);
  });
});

describe("getStudentsExceedingSubmissionLimit（#95）", () => {
  it("仅返回版本数超过上限的学生，含学号/姓名/版本数", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    const aId = adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
    const bId = adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四" });
    adapter.insertProfileSubmission(aId, 1, { tags: null, avatar_url: null, evaluation_url: null, storage_id: 1, submitted_at: "2026-08-01 10:00:00", is_current: 1 });
    adapter.insertProfileSubmission(aId, 2, { tags: null, avatar_url: null, evaluation_url: null, storage_id: 1, submitted_at: "2026-08-02 10:00:00", is_current: 0 });
    adapter.insertProfileSubmission(aId, 3, { tags: null, avatar_url: null, evaluation_url: null, storage_id: 1, submitted_at: "2026-08-03 10:00:00", is_current: 0 });
    adapter.insertProfileSubmission(bId, 1, { tags: null, avatar_url: null, evaluation_url: null, storage_id: 1, submitted_at: "2026-08-01 10:00:00", is_current: 1 });

    const exceeding = adapter.getStudentsExceedingSubmissionLimit(2);
    expect(exceeding).toHaveLength(1);
    expect(exceeding[0]).toMatchObject({ user_id: aId, user_code: "202505050101", name: "张三", version_count: 3 });

    adapter.close();
    cleanup(dbPath);
  });
});
