import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import { rmSync } from "node:fs";

// 两库物理分离：演示库经 DEMO_DB_PATH；「生产库」经下方 db-config mock 指向另一临时文件，
// 使隔离断言不依赖运行环境里是否存在 db-config.json（CI 无此文件会回落 MySQL → 连不上）
const FILES = vi.hoisted(() => ({
  demo: "./data/career-demo-auth-test.db",
  prod: "./data/career-prod-mock-auth-test.db",
}));

// captcha 走通过（不干扰演示登录主逻辑），本组用例聚焦数据源作用域与签发口径
vi.mock("@/lib/captcha", () => ({
  CAPTCHA_REQUIRED_MESSAGE: "请先完成人机验证",
  verifyCaptchaTicket: vi.fn(async () => ({ outcome: "passed" })),
}));

// 把「非演示作用域」的默认数据源钉成独立 SQLite 文件：保留真实模块其余导出，仅改 getConfig 的落库目标
vi.mock("@/lib/db-config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db-config")>();
  const base = mod.getConfig(); // 无 db-config.json 时为内置默认（含完整 mysql 形状），仅作基底
  return {
    ...mod,
    getConfig: () => ({ ...base, installed: true, type: "sqlite", sqlite: { path: FILES.prod } }),
  };
});

import { POST } from "@/app/api/auth/demo/route";
import { GET } from "@/app/api/auth/route";
import { insertUser, closeDemoDb, closeDb, getUserByCode, queryAuditLogs } from "@/lib/db";
import { hashPassword } from "@/lib/auth";
import { runInDemoScope } from "@/lib/demo-scope";
import { verifyToken } from "@/lib/token";

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
  for (const file of [FILES.demo, FILES.prod]) {
    for (const s of ["", "-wal", "-shm"]) rmSync(file + s, { force: true });
  }
}

describe("POST /api/auth/demo 演示登录", () => {
  beforeAll(async () => {
    cleanup();
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = FILES.demo;
    const password_hash = await hashPassword(PWD);
    // 演示库：预置带密码的演示教师
    await runInDemoScope(() =>
      insertUser({ user_code: CODE, password_hash, role: "teacher", name: "演示教师" })
    );
    // 「生产库」：同一编号、不同姓名——用于证明登录只认演示库、两库互不串
    await insertUser({ user_code: CODE, password_hash, role: "teacher", name: "生产同名教师" });
  });

  afterAll(async () => {
    await closeDemoDb();
    await closeDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    cleanup();
  });

  it("正确口令 → 200，cookie 带 demo token", async () => {
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

  it("未知编号 → 401（与错误口令同口径，不泄露账号存在性）", async () => {
    const res = await POST(req({ method: "POST", body: { userCode: "00000000", password: "whatever" } }));
    expect(res.status).toBe(401);
    expect((await res.json()).error).toBe("编号或密码错误");
  });

  it("演示账号只存在于演示库（真隔离：同一编号在两库分别落不同姓名，登录取演示库）", async () => {
    const inDemo = await runInDemoScope(() => getUserByCode(CODE));
    const inProd = await getUserByCode(CODE);
    expect(inDemo?.name).toBe("演示教师");
    expect(inProd?.name).toBe("生产同名教师"); // 两库确有该编号，但内容不同
    // 登录响应必须取自演示库，而非「生产同名教师」
    const res = await POST(req({ method: "POST", body: { userCode: CODE, password: PWD } }));
    expect((await res.json()).name).toBe("演示教师");
  });

  it("演示登录失败只写演示库审计，不污染生产审计", async () => {
    await POST(req({ method: "POST", body: { userCode: CODE, password: "bad" } }));
    await new Promise((r) => setImmediate(r)); // 冲刷 fire-and-forget 的 recordAudit
    const demoFilters = { page: 1, pageSize: 50, action: "auth:login-failed", actorQuery: CODE };
    const demo = await runInDemoScope(() => queryAuditLogs(demoFilters));
    const prod = await queryAuditLogs(demoFilters);
    expect(demo.total).toBeGreaterThanOrEqual(1);
    expect(prod.total).toBe(0);
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
    expect(json.name).toBe("演示教师"); // 会话回查同样落演示库，而非生产同名账号
  });
});
