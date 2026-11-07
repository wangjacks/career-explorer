import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("演示库 adapter 进程级单例（#354）", () => {
  it("模块重新加载后仍共享同一份状态（模拟不同 route bundle）", async () => {
    vi.resetModules();
    const firstModule = await import("@/lib/demo-db-state");
    const first = firstModule.getDemoDbState();

    vi.resetModules();
    const secondModule = await import("@/lib/demo-db-state");
    const second = secondModule.getDemoDbState();

    expect(second).toBe(first);
    // 不把测试状态留给后续用例
    first.adapter = null;
    first.type = "";
    first.init = null;
  });

  it("db.ts 通过全局状态读取演示 adapter，不再使用模块级 memo 变量", () => {
    const DB = readFileSync(join(process.cwd(), "src/lib/db.ts"), "utf8");
    expect(DB).toContain('from "./demo-db-state"');
    expect(DB).toContain("getDemoDbState()");
    expect(DB).not.toMatch(/let\s+demoAdapter\s*:/);
    expect(DB).not.toMatch(/let\s+demoInitPromise\s*:/);
  });
});
