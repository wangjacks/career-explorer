import { describe, it, expect, beforeAll, afterAll } from "vitest";
import path from "path";
import { existsSync, rmSync } from "fs";
import { resetDemo, initDemoDb, readDemoStatus } from "@/lib/demo-lifecycle";
import { runInDemoScope, getDemoDbPath } from "@/lib/demo-scope";
import { getClasses, getStudents, closeDemoDb, closeDb } from "@/lib/db";

const DEMO_FILE = "./data/career-demo-lifecycle-test.db";
const DEMO_UPLOADS = path.resolve(process.cwd(), "uploads", "demo");

function cleanupDb() {
  for (const s of ["", "-wal", "-shm"]) rmSync(DEMO_FILE + s, { force: true });
}

describe("演示库生命周期：init / reset / status（#253，真临时演示库）", () => {
  beforeAll(() => {
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = DEMO_FILE;
    cleanupDb();
    rmSync(DEMO_UPLOADS, { recursive: true, force: true });
  });

  afterAll(async () => {
    await closeDemoDb();
    await closeDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    cleanupDb();
    rmSync(DEMO_UPLOADS, { recursive: true, force: true });
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
});
