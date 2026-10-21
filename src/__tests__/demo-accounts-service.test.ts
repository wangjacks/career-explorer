import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { rmSync } from "fs";
import { runInDemoScope } from "@/lib/demo-scope";
import { resetDemo } from "@/lib/demo-lifecycle";
import {
  listVisitorAccounts,
  getVisitorAccount,
  createVisitorAccount,
  disableVisitorAccount,
  rotateVisitorAccountPassword,
  deleteVisitorAccount,
} from "@/lib/demo-accounts-service";
import { demoAccountCodes, DEMO_CLASS_NAME } from "@/lib/demo-accounts";
import {
  getUserByCode,
  getProfileSubmissions,
  getTeacherClassPairs,
  getClassByName,
  getDefaultStorageBackend,
  submitProfileWithVersion,
  deleteStudents,
  closeDemoDb,
  closeDb,
} from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { getThumbnailKey } from "@/lib/thumbnail-utils";
import { verifyPassword } from "@/lib/auth";

const DEMO_FILE = "./data/career-demo-accounts-service-test.db";
const UPLOADS_ROOT = "./data/uploads-accounts-service-test";
const DB_ABS = path.resolve(process.cwd(), DEMO_FILE);

function cleanup() {
  for (const s of ["", "-wal", "-shm"]) rmSync(DB_ABS + s, { force: true });
  rmSync(path.resolve(process.cwd(), UPLOADS_ROOT), { recursive: true, force: true });
}

describe("演示访客账户服务（#278）", () => {
  beforeAll(async () => {
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = DEMO_FILE;
    process.env.UPLOADS_DIR = UPLOADS_ROOT;
    cleanup();
    await resetDemo({ id: 1, name: "测试管理员", role: "admin" });
  }, 60_000);

  afterAll(async () => {
    await closeDemoDb();
    await closeDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    delete process.env.UPLOADS_DIR;
    cleanup();
  }, 60_000);

  it("未处于演示作用域时拒绝操作", async () => {
    await expect(listVisitorAccounts()).rejects.toThrow(/演示作用域/);
    await expect(createVisitorAccount()).rejects.toThrow(/演示作用域/);
  });

  it("初始列表为空；名册 seq<1000 不入列", async () => {
    const accounts = await runInDemoScope(() => listVisitorAccounts());
    expect(accounts).toEqual([]);
  });

  it("创建：seq=1000、三身份同名同 hash、教师配对演示班、学生入班", async () => {
    const created = await runInDemoScope(() => createVisitorAccount());
    expect(created.seq).toBe(1000);
    expect(created.codes).toEqual(demoAccountCodes(1000));
    expect(created.password.length).toBeGreaterThanOrEqual(8);

    const rows = await runInDemoScope(async () => {
      const a = await getUserByCode(created.codes.admin);
      const t = await getUserByCode(created.codes.teacher);
      const s = await getUserByCode(created.codes.student);
      const cls = await getClassByName(DEMO_CLASS_NAME);
      return { a, t, s, cls };
    });
    expect(rows.a?.role).toBe("admin");
    expect(rows.t?.role).toBe("teacher");
    expect(rows.s?.role).toBe("student");
    // 三身份同一姓名、同一密码 hash
    expect(rows.a?.name).toBe(created.name);
    expect(rows.t?.name).toBe(created.name);
    expect(rows.s?.name).toBe(created.name);
    expect(rows.a?.password_hash).toBe(rows.s?.password_hash);
    expect(rows.t?.password_hash).toBe(rows.s?.password_hash);
    for (const r of [rows.a, rows.t, rows.s]) {
      expect(await verifyPassword(created.password, r!.password_hash!)).toBe(true);
    }
    // 教师配对演示班；学生入班；admin 不绑班
    const pairs = await runInDemoScope(() => getTeacherClassPairs());
    expect(pairs.some((p) => p.teacher_id === rows.t!.id && p.class_id === rows.cls!.id)).toBe(true);
    expect(rows.s?.class_id).toBe(rows.cls?.id);
    expect(rows.a?.class_id).toBeNull();
  }, 30_000);

  it("自设密码 + 第二个账户 seq=1001；列表不泄露 hash", async () => {
    const custom = "visitor-pass-9";
    const second = await runInDemoScope(() => createVisitorAccount({ password: custom }));
    expect(second.seq).toBe(1001);
    const row = await runInDemoScope(() => getUserByCode(second.codes.student));
    expect(await verifyPassword(custom, row!.password_hash!)).toBe(true);

    const accounts = await runInDemoScope(() => listVisitorAccounts());
    expect(accounts.map((a) => a.seq)).toEqual([1000, 1001]);
    expect(JSON.stringify(accounts)).not.toContain("$2"); // 绝不含 bcrypt hash
  }, 30_000);

  it("并发创建被单飞锁串行化：seq 不重复", async () => {
    const [x, y] = await runInDemoScope(() => Promise.all([createVisitorAccount(), createVisitorAccount()]));
    expect(x.seq).not.toBe(y.seq);
    const accounts = await runInDemoScope(() => listVisitorAccounts());
    expect(accounts).toHaveLength(4);
  }, 30_000);

  it("禁用：三身份 hash 置空、disabled=true；重复禁用幂等", async () => {
    const disabled = await runInDemoScope(() => disableVisitorAccount(1000));
    expect(disabled?.disabled).toBe(true);
    const rows = await runInDemoScope(async () => [
      await getUserByCode(demoAccountCodes(1000).admin),
      await getUserByCode(demoAccountCodes(1000).teacher),
      await getUserByCode(demoAccountCodes(1000).student),
    ]);
    for (const r of rows) expect(r?.password_hash ?? null).toBeNull();
    const again = await runInDemoScope(() => disableVisitorAccount(1000));
    expect(again?.disabled).toBe(true);
  }, 30_000);

  it("重置密码：新密码三身份可验、旧密码失效、恢复启用", async () => {
    const rot = await runInDemoScope(() => rotateVisitorAccountPassword(1000));
    expect(rot).not.toBeNull();
    const rows = await runInDemoScope(async () => [
      await getUserByCode(demoAccountCodes(1000).admin),
      await getUserByCode(demoAccountCodes(1000).teacher),
      await getUserByCode(demoAccountCodes(1000).student),
    ]);
    for (const r of rows) {
      expect(await verifyPassword(rot!.password, r!.password_hash!)).toBe(true);
      expect(await verifyPassword("visitor-pass-9", r!.password_hash!)).toBe(false);
    }
    const account = await runInDemoScope(() => getVisitorAccount(1000));
    expect(account?.disabled).toBe(false);
  }, 30_000);

  it("删除：清三行 / 提交历史 / 教师关联 / 演示文件（含缩略图），他账户不受影响", async () => {
    const target = 1001;
    const codes = demoAccountCodes(target);

    // 给该学生上传一张图 + 缩略图，并写入档案版本（引用该图）
    await runInDemoScope(async () => {
      const backend = await getDefaultStorageBackend();
      const storage = await getStorage(backend!.id);
      const key = "avatar_900000001001_20260101000000_abcd.jpg";
      await storage.upload(key, Buffer.from("img"), "image/jpeg");
      await storage.upload(getThumbnailKey(key), Buffer.from("thumb"), "image/jpeg");
      await submitProfileWithVersion(codes.student, JSON.stringify(["阅读"]), `/api/uploads/${key}`, "", null, backend!.id);
    });

    const before = await runInDemoScope(() => getUserByCode(codes.student));
    const teacherBefore = await runInDemoScope(() => getUserByCode(codes.teacher));
    expect(await runInDemoScope(() => getProfileSubmissions(before!.id))).toHaveLength(1);

    const report = await runInDemoScope(() => deleteVisitorAccount(target));
    expect(report?.deleted).toEqual({ admin: true, teacher: true, student: true });
    expect(report?.files.failed).toBe(0);

    const rows = await runInDemoScope(async () => [
      await getUserByCode(codes.admin),
      await getUserByCode(codes.teacher),
      await getUserByCode(codes.student),
    ]);
    for (const r of rows) expect(r).toBeUndefined();

    const pairs = await runInDemoScope(() => getTeacherClassPairs());
    expect(pairs.some((p) => p.teacher_id === teacherBefore!.id)).toBe(false);

    const backend = await runInDemoScope(() => getDefaultStorageBackend());
    const storage = await runInDemoScope(() => getStorage(backend!.id));
    expect(await storage.exists("avatar_900000001001_20260101000000_abcd.jpg")).toBe(false);
    expect(await storage.exists(getThumbnailKey("avatar_900000001001_20260101000000_abcd.jpg"))).toBe(false);

    // 他账户仍在
    const accounts = await runInDemoScope(() => listVisitorAccounts());
    expect(accounts.map((a) => a.seq)).not.toContain(target);
    expect(accounts.length).toBeGreaterThanOrEqual(3);
  }, 40_000);

  it("删除重试容忍：学生行已被删的中断态仍能清干净教师/admin", async () => {
    const created = await runInDemoScope(() => createVisitorAccount());
    const codes = created.codes;
    // 模拟上次删除只完成了学生部分
    await runInDemoScope(() => deleteStudents([codes.student]));

    const report = await runInDemoScope(() => deleteVisitorAccount(created.seq));
    expect(report?.deleted).toEqual({ admin: true, teacher: true, student: false });
    const remaining = await runInDemoScope(async () => [
      await getUserByCode(codes.admin),
      await getUserByCode(codes.teacher),
    ]);
    expect(remaining.every((r) => r === undefined)).toBe(true);
  }, 30_000);

  it("删除不存在的 seq → null", async () => {
    expect(await runInDemoScope(() => deleteVisitorAccount(9999))).toBeNull();
    expect(await runInDemoScope(() => getVisitorAccount(9999))).toBeNull();
  });
});
