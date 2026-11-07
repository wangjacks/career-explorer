import { describe, it, expect, afterAll, vi } from "vitest";
import path from "path";
import { existsSync, rmSync } from "fs";

// 用可控开关替换 isDemoScope，保留 demo-scope 其余真实导出（db.ts 会 import 它们）
const state = vi.hoisted(() => ({ value: false }));

vi.mock("@/lib/demo-scope", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/demo-scope")>();
  return { ...mod, isDemoScope: () => state.value };
});

import { getUploadsBaseDir, LocalStorageAdapter } from "@/lib/storage-local";

describe("本地存储作用域基目录（#253 S1）", () => {
  afterAll(() => {
    for (const p of [
      path.resolve(process.cwd(), "uploads", "demo-scope-probe.jpg"),
      path.resolve(process.cwd(), "uploads", "demo", "demo-scope-probe.jpg"),
    ]) {
      rmSync(p, { force: true });
    }
  });

  it("非演示作用域基目录为 uploads/", () => {
    state.value = false;
    expect(getUploadsBaseDir()).toBe(path.resolve(process.cwd(), "uploads"));
  });

  it("演示作用域基目录为 uploads/demo/", () => {
    state.value = true;
    expect(getUploadsBaseDir()).toBe(path.resolve(process.cwd(), "uploads", "demo"));
  });

  it("演示作用域写入落 uploads/demo/，生产目录不含该文件", async () => {
    const key = "demo-scope-probe.jpg";
    const adapter = new LocalStorageAdapter();

    state.value = true;
    await adapter.upload(key, Buffer.from("demo-bytes"), "image/jpeg");

    const demoPath = path.resolve(process.cwd(), "uploads", "demo", key);
    const prodPath = path.resolve(process.cwd(), "uploads", key);
    expect(existsSync(demoPath)).toBe(true);
    expect(existsSync(prodPath)).toBe(false);
    expect(await adapter.exists(key)).toBe(true);

    // 退出演示作用域后，同一 key 在生产基目录下不存在（物理隔离）
    state.value = false;
    expect(await adapter.exists(key)).toBe(false);
  });
});
