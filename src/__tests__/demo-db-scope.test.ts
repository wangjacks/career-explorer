import { describe, it, expect, afterAll } from "vitest";
import { existsSync, rmSync } from "node:fs";
import { runInDemoScope } from "@/lib/demo-scope";
import { getClasses, closeDemoDb } from "@/lib/db";

const DEMO_FILE = "./data/career-demo-test.db";

function cleanupDemo() {
  // force:true 忽略不存在；一并清 WAL/SHM 侧文件
  for (const suffix of ["", "-wal", "-shm"]) rmSync(DEMO_FILE + suffix, { force: true });
}

describe("演示库请求级数据源隔离（集成）", () => {
  afterAll(async () => {
    await closeDemoDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    cleanupDemo();
  });

  it("未启用演示模式时，演示作用域内访问 DB 抛错——fail-safe，绝不回落生产库", async () => {
    delete process.env.DEMO_ENABLED;
    await expect(runInDemoScope(() => getClasses())).rejects.toThrow(/演示模式未启用/);
  });

  it("启用后演示作用域内的 DB 调用落在独立演示库文件（而非生产库）", async () => {
    cleanupDemo();
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = DEMO_FILE;

    const classes = await runInDemoScope(() => getClasses());
    expect(Array.isArray(classes)).toBe(true); // 全新演示库：无班级
    expect(existsSync(DEMO_FILE)).toBe(true); // 证明改道并自建了演示库文件

    // 二次调用命中 memo，不重复建库
    const again = await runInDemoScope(() => getClasses());
    expect(Array.isArray(again)).toBe(true);
  }, 30000);
});
