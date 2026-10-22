import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AUTH = readFileSync(join(process.cwd(), "src/app/api/auth/route.ts"), "utf8");
const DEMO = readFileSync(join(process.cwd(), "src/app/api/auth/demo/route.ts"), "utf8");
const CONTRACT = readFileSync(join(process.cwd(), "src/lib/login-contract.ts"), "utf8");

// 这些文案/参数必须只在 login-contract.ts 出现一次；两个登录端点都从这里取。
// 目的：生产登录与演示登录的安全性口径要求同步演进，防止其中一端静默漂移
// （将来加限流 / 失败锁定 / 改文案时，若某一端内联就会悄悄落后且无测试报警）。
const MESSAGE_LITERALS = ["编号或密码错误", "请输入编号和密码", "该账户尚未设置密码"];

describe("登录契约单一来源守卫", () => {
  it("契约模块定义了三段错误文案与 cookie 参数", () => {
    for (const m of MESSAGE_LITERALS) {
      expect(CONTRACT, `契约应定义文案: ${m}`).toContain(m);
    }
    expect(CONTRACT).toContain("AUTH_COOKIE_OPTIONS");
  });

  it("两个登录端点都引用 login-contract", () => {
    for (const [name, src] of [["auth", AUTH], ["demo", DEMO]] as const) {
      expect(src, `${name} 应引用 login-contract`).toContain('from "@/lib/login-contract"');
    }
  });

  it("两个登录端点都不内联错误文案、不自建 cookie 参数对象", () => {
    for (const [name, src] of [["auth", AUTH], ["demo", DEMO]] as const) {
      for (const m of MESSAGE_LITERALS) {
        expect(src, `${name} 不应内联文案「${m}」`).not.toContain(m);
      }
      expect(src, `${name} 不应自建 COOKIE_OPTIONS`).not.toMatch(/const\s+COOKIE_OPTIONS\s*=/);
    }
  });
});
