import { describe, it, expect } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";
import { isDemoScope, runInDemoScope, withDemoScope } from "@/lib/demo-scope";

function reqWithToken(token?: string): NextRequest {
  const url = new URL("/api/x", "http://localhost:3000");
  return new NextRequest(url, {
    method: "GET",
    headers: token ? { cookie: `auth_token=${token}` } : {},
  });
}

describe("demo-scope", () => {
  it("isDemoScope 默认 false；runInDemoScope 内为 true 且跨 await 传播；出作用域后复位", async () => {
    expect(isDemoScope()).toBe(false);
    const inner = await runInDemoScope(async () => {
      await Promise.resolve();
      return isDemoScope();
    });
    expect(inner).toBe(true);
    expect(isDemoScope()).toBe(false);
  });

  it("withDemoScope：演示 token 时 handler 运行在演示作用域", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "演示", demo: true });
    const handler = withDemoScope(async (request: NextRequest) => (request ? isDemoScope() : false));
    expect(await handler(reqWithToken(token))).toBe(true);
  });

  it("withDemoScope：生产 token 时不进入演示作用域", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "生产" });
    const handler = withDemoScope(async (request: NextRequest) => (request ? isDemoScope() : false));
    expect(await handler(reqWithToken(token))).toBe(false);
  });

  it("withDemoScope：透传动态路由的第二个入参（ctx）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "生产" });
    const seen: unknown[] = [];
    const handler = withDemoScope(async (request: NextRequest, ctx: { params: Promise<{ id: string }> }) => {
      seen.push(request, ctx);
      return new Response("ok");
    });
    const ctx = { params: Promise.resolve({ id: "7" }) };
    await handler(reqWithToken(token), ctx);
    expect(seen[1]).toBe(ctx);
  });

  it("withDemoScope：无 request（公开路由 0 参调用）也不报错、不进演示作用域", async () => {
    const handler = withDemoScope(async () => isDemoScope());
    expect(await handler()).toBe(false);
  });
});
