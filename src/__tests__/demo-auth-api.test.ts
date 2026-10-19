import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { rmSync } from "node:fs";

// captcha 走通过（不干扰演示登录主逻辑），本组用例聚焦数据源作用域与签发口径
vi.mock("@/lib/captcha", () => ({
  CAPTCHA_REQUIRED_MESSAGE: "请先完成人机验证",
  verifyCaptchaTicket: vi.fn(async () => ({ outcome: "passed" })),
}));

import { POST } from "@/app/api/auth/demo/route";
import { GET } from "@/app/api/auth/route";
import { insertUser, closeDemoDb } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { runInDemoScope } from "@/lib/demo-scope";
import { verifyToken } from "@/lib/token";

const DEMO_FILE = "./data/career-demo-auth-test.db";
const CODE = "20000099"; // 演示教师编号形态（8 位）
const PWD = "demo-pass-123";

function req(opts: { method: "POST" | "GET"; body?: unknown; cookie?: string }): NextRequest {
  const url = new URL("/api/auth/demo", "http://localhost:3000");
  return new NextRequest(url, {
    method: opts.method,
    headers: {
      "Content-Type": "application/json",
      ...(opts.cookie ? { cookie: opts.cookie } : {}),
    },
    ...(opts.body !== undefined ? { body: JSON.stringify(opts.body) } : {}),
  });
}

function cleanup() {
  for (const s of ["", "-wal", "-shm"]) rmSync(DEMO_FILE + s, { force: true });
}

describe("POST /api/auth/demo 演示登录", () => {
  beforeAll(async () => {
    cleanup();
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = DEMO_FILE;
    // 在演示库内预置一个带密码的演示教师（触发 init 建表）
    await runInDemoScope(async () => {
      await insertUser({ user_code: CODE, password_hash: await hashPassword(PWD), role: "teacher", name: "演示教师" });
    });
  });

  afterAll(async () => {
    await closeDemoDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    cleanup();
  });

  it("正确口令 → 200，cookie 带 demo token，且非演示库账号无法命中", async () => {
    const res = await POST(req({ method: "POST", body: { userCode: CODE, password: PWD } }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.demo).toBe(true);

    const setCookie = res.headers.get("set-cookie") ?? "";
    const token = /auth_token=([^;]+)/.exec(setCookie)?.[1] ?? "";
    expect(token).not.toBe("");
    const payload = await verifyToken(token);
    expect(payload.valid).toBe(true);
    expect(payload.demo).toBe(true);
    expect(payload.role).toBe("teacher");
  });

  it("错误口令 → 401「编号或密码错误」（不泄露账号存在性）", async () => {
    const res = await POST(req({ method: "POST", body: { userCode: CODE, password: "wrong" } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("编号或密码错误");
  });

  it("演示库中不存在、但生产库存在的编号 → 401（证明只认演示库）", async () => {
    // 生产管理员编号 10001 只存在于生产库；演示库里应查不到
    const res = await POST(req({ method: "POST", body: { userCode: "10001", password: "whatever" } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("编号或密码错误");
  });

  it("DEMO_ENABLED 关闭 → 404", async () => {
    process.env.DEMO_ENABLED = "false";
    const res = await POST(req({ method: "POST", body: { userCode: CODE, password: PWD } }));
    expect(res.status).toBe(404);
    process.env.DEMO_ENABLED = "true";
  });

  it("会话检测 GET /api/auth 用 demo token 复读演示库", async () => {
    const login = await POST(req({ method: "POST", body: { userCode: CODE, password: PWD } }));
    const token = /auth_token=([^;]+)/.exec(login.headers.get("set-cookie") ?? "")?.[1] ?? "";
    const res = await GET(req({ method: "GET", cookie: `auth_token=${token}` }));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.role).toBe("teacher");
    expect(json.name).toBe("演示教师");
  });
});
