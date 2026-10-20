import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { existsSync, rmSync } from "fs";
import { resetDemo, initDemoDb, readDemoStatus } from "@/lib/demo-lifecycle";
import { runInDemoScope, getDemoDbPath } from "@/lib/demo-scope";
import { getClasses, getStudents, closeDemoDb, closeDb } from "@/lib/db";

const DEMO_FILE = "./data/career-demo-lifecycle-test.db";
const UPLOADS_ROOT = "./data/uploads-lifecycle-test";
const DEMO_UPLOADS = path.resolve(process.cwd(), UPLOADS_ROOT, "demo");

function cleanupDb() {
  for (const s of ["", "-wal", "-shm"]) rmSync(DEMO_FILE + s, { force: true });
}

describe("演示库生命周期：init / reset / status（#253，真临时演示库）", () => {
  beforeAll(() => {
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = DEMO_FILE;
    process.env.UPLOADS_DIR = UPLOADS_ROOT; // 隔离 uploads 根，避免与并发集成用例互清 uploads/demo
    cleanupDb();
    rmSync(path.resolve(process.cwd(), UPLOADS_ROOT), { recursive: true, force: true });
  });

  afterAll(async () => {
    await closeDemoDb();
    await closeDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    delete process.env.UPLOADS_DIR;
    cleanupDb();
    rmSync(path.resolve(process.cwd(), UPLOADS_ROOT), { recursive: true, force: true });
  });

  it("未初始化时读 status 无副作用：不开 adapter、库文件仍不存在", async () => {
    const s = await readDemoStatus();
    expect(s.initialized).toBe(false);
    expect(s.counts.students).toBe(0);
    // 关键：GET status 不得建库（此前 getClasses→ensureInit 会 mkdir+打开文件+灌种子）
    expect(existsSync(path.resolve(process.cwd(), getDemoDbPath()))).toBe(false);
  });

  it("initDemoDb 建表演过（空库，无班级）", async () => {
    await initDemoDb();
    expect(existsSync(path.resolve(process.cwd(), getDemoDbPath()))).toBe(true);
    const classes = await runInDemoScope(() => getClasses());
    expect(classes.length).toBe(0);
    const status = await readDemoStatus();
    expect(status.initialized).toBe(false);
    expect(status.counts.students).toBe(0);
  }, 60_000);

  it("resetDemo 全量重播：账户+提交+分组+占位图落演示库，状态自洽", async () => {
    const report = await resetDemo({ id: 1, name: "测试管理员", role: "admin" });

    expect(report.classId).toBeGreaterThan(0);
    expect(report.students).toBe(20);
    expect(report.submitted).toBeGreaterThan(10);
    expect(report.groups).toBeGreaterThan(0);
    expect(report.images).toBeGreaterThan(0);
    // 测评含完成与草稿两类，均只落在提交者中
    expect(report.assessed).toBeGreaterThan(0);
    expect(report.drafts).toBeGreaterThanOrEqual(0);
    expect(report.assessed + report.drafts).toBeLessThanOrEqual(report.submitted);

    // 数据确实落库（演示作用域内查询）
    const students = await runInDemoScope(() => getStudents());
    expect(students).toHaveLength(20);
    expect(students.every((s) => /^9\d{11}$/.test(s.user_code))).toBe(true);

    const status = await readDemoStatus();
    expect(status.enabled).toBe(true);
    expect(status.initialized).toBe(true);
    expect(status.counts.students).toBe(20);
    expect(status.counts.teachers).toBe(1);
    expect(status.counts.submittedProfiles).toBe(report.submitted);
    expect(status.counts.classes).toBe(1);
    expect(status.counts.demoFiles).toBeGreaterThanOrEqual(report.images);

    // 占位图物理落在 uploads/demo/
    expect(existsSync(DEMO_UPLOADS)).toBe(true);
  }, 60_000);

  it("再次 resetDemo 是全新随机且仍隔离（重置不残留旧库结构问题）", async () => {
    const second = await resetDemo({ id: 1, name: "测试管理员", role: "admin" });
    expect(second.students).toBe(20);
    const status = await readDemoStatus();
    expect(status.counts.students).toBe(20); // 未累加（重置为干净态）
  }, 60_000);

  it("并发 resetDemo 单飞：Promise.all 只重播一次、库不损坏", async () => {
    const [a, b] = await Promise.all([
      resetDemo({ id: 1, name: "管理员", role: "admin" }),
      resetDemo({ id: 1, name: "管理员", role: "admin" }),
    ]);
    expect(a).toBe(b); // 第二次共享第一次的 in-flight promise
    expect(a.students).toBe(20);
    const status = await readDemoStatus();
    expect(status.counts.students).toBe(20); // 未被双播种（40）
    expect(status.counts.teachers).toBe(1);
  }, 60_000);
});
