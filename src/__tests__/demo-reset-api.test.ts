import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import path from "path";
import { rmSync, mkdirSync, writeFileSync, existsSync } from "fs";

// 三处全部隔离：演示库 / 生产库 / uploads 根各自临时，避免与并发集成用例互相污染
const FILES = vi.hoisted(() => ({
  demo: "./data/career-demo-reset-api-test.db",
  prod: "./data/career-prod-reset-api-test.db",
  uploadsRoot: "./data/uploads-reset-api-test",
}));

// CI 无 db-config.json 会回落 MySQL → 把「生产侧」钉成独立临时 SQLite，使路由内生产作用域查询可跑
vi.mock("@/lib/db-config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db-config")>();
  const base = mod.getConfig();
  return { ...mod, getConfig: () => ({ ...base, installed: true, type: "sqlite", sqlite: { path: FILES.prod } }) };
});

import { POST } from "@/app/api/manage/demo/reset/route";
import { GET } from "@/app/api/manage/demo/status/route";
import { signToken } from "@/lib/token";
import { insertUser, getStudents, queryAuditLogs, closeDb, closeDemoDb } from "@/lib/db";
import { runInDemoScope } from "@/lib/demo-scope";

const UPLOADS_ABS = path.resolve(process.cwd(), FILES.uploadsRoot);
const DEMO_UPLOADS_ABS = path.join(UPLOADS_ABS, "demo");
const PROD_PROBE = path.join(UPLOADS_ABS, "prod-probe.jpg");
const PROD_STUDENT = "202501010001"; // 非演示号段（不以 9 开头）

function req(method: "POST" | "GET", cookie?: string, body?: unknown): NextRequest {
  const url = new URL(
    method === "POST" ? "/api/manage/demo/reset" : "/api/manage/demo/status",
    "http://localhost:3000"
  );
  return new NextRequest(url, {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function rmDb(f: string) {
  for (const s of ["", "-wal", "-shm"]) rmSync(f + s, { force: true });
}

describe("POST /api/manage/demo/reset 与 GET /api/manage/demo/status（#253）", () => {
  beforeAll(async () => {
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = FILES.demo;
    process.env.UPLOADS_DIR = FILES.uploadsRoot;
    rmDb(FILES.demo);
    rmDb(FILES.prod);
    rmSync(UPLOADS_ABS, { recursive: true, force: true });

    // 生产库预置 1 名学生；生产 uploads 预置 1 个探针文件——重置后须原样存在
    await insertUser({ user_code: PROD_STUDENT, role: "student", name: "生产学生" });
    mkdirSync(UPLOADS_ABS, { recursive: true });
    writeFileSync(PROD_PROBE, "prod-bytes");
  }, 60_000);

  afterAll(async () => {
    await closeDemoDb();
    await closeDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    delete process.env.UPLOADS_DIR;
    rmDb(FILES.demo);
    rmDb(FILES.prod);
    rmSync(UPLOADS_ABS, { recursive: true, force: true });
  });

  it("DEMO_ENABLED 关闭 → 两端点均 404", async () => {
    const prev = process.env.DEMO_ENABLED;
    delete process.env.DEMO_ENABLED;
    const t = await signToken({ role: "admin", uid: 1, name: "A" });
    expect((await POST(req("POST", `auth_token=${t}`))).status).toBe(404);
    expect((await GET(req("GET", `auth_token=${t}`))).status).toBe(404);
    if (prev) process.env.DEMO_ENABLED = prev;
  });

  it("演示会话（demo token）→ 403，且越权拒绝落演示库审计、不污染生产审计", async () => {
    const t = await signToken({ role: "admin", uid: 1, name: "D", demo: true });
    expect((await POST(req("POST", `auth_token=${t}`))).status).toBe(403);
    expect((await GET(req("GET", `auth_token=${t}`))).status).toBe(403);
    await new Promise((r) => setTimeout(r, 50)); // 冲刷 fire-and-forget recordAudit（含演示库首建）

    // 拒绝事件写进了演示库审计流（请求处演示作用域）
    const demoReset = await runInDemoScope(() => queryAuditLogs({ page: 1, pageSize: 50, action: "demo:reset" }));
    const demoStatus = await runInDemoScope(() => queryAuditLogs({ page: 1, pageSize: 50, action: "demo:status" }));
    expect(demoReset.total).toBeGreaterThanOrEqual(1);
    expect(demoStatus.total).toBeGreaterThanOrEqual(1);
    // 隔离不变量：演示会话的拒绝不得写进生产审计
    expect((await queryAuditLogs({ page: 1, pageSize: 50, action: "demo:reset" })).total).toBe(0);
    expect((await queryAuditLogs({ page: 1, pageSize: 50, action: "demo:status" })).total).toBe(0);
  }, 60_000);

  it("非 admin（teacher）→ 403；无 token → 403；生产越权拒绝落生产审计", async () => {
    const t = await signToken({ role: "teacher", uid: 2, name: "T" });
    expect((await POST(req("POST", `auth_token=${t}`))).status).toBe(403);
    expect((await POST(req("POST"))).status).toBe(403);
    await new Promise((r) => setTimeout(r, 50));
    // 生产会话的越权拒绝记在生产审计流
    expect((await queryAuditLogs({ page: 1, pageSize: 50, action: "demo:reset" })).total).toBeGreaterThanOrEqual(1);
  });

  it("scope 非 all → 400", async () => {
    const t = await signToken({ role: "admin", uid: 1, name: "A" });
    expect((await POST(req("POST", `auth_token=${t}`, { scope: "data" }))).status).toBe(400);
  });

  it("admin 全量重置 → 200：演示库播种、生产库与生产 uploads 零改动、审计只落生产、status 反映", async () => {
    const t = await signToken({ role: "admin", uid: 1, name: "生产管理员" });
    const res = await POST(req("POST", `auth_token=${t}`));
    expect(res.status).toBe(200);
    const json = await res.json();
    expect(json.ok).toBe(true);
    expect(json.report.students).toBe(20);

    // 演示库确有 20 名 9 号段学生
    const demoStudents = await runInDemoScope(() => getStudents());
    expect(demoStudents).toHaveLength(20);
    expect(demoStudents.every((s) => /^9\d{11}$/.test(s.user_code))).toBe(true);

    // 生产库未被污染：仍只有那 1 名生产学生
    const prodStudents = await getStudents();
    expect(prodStudents).toHaveLength(1);
    expect(prodStudents[0].user_code).toBe(PROD_STUDENT);

    // 生产 uploads 探针仍在；演示文件落在 uploads/demo
    expect(existsSync(PROD_PROBE)).toBe(true);
    expect(existsSync(DEMO_UPLOADS_ABS)).toBe(true);

    // 重置审计落生产库；演示库内不应出现 demo:reset（recordAudit 在 runInDemoScope 之外执行）
    await new Promise((r) => setImmediate(r));
    expect((await queryAuditLogs({ page: 1, pageSize: 50, action: "demo:reset" })).total).toBeGreaterThanOrEqual(1);
    const demoAudit = await runInDemoScope(() => queryAuditLogs({ page: 1, pageSize: 50, action: "demo:reset" }));
    expect(demoAudit.total).toBe(0);

    // status 反映重置结果
    const s = await GET(req("GET", `auth_token=${t}`));
    expect(s.status).toBe(200);
    const sj = await s.json();
    expect(sj.initialized).toBe(true);
    expect(sj.counts.students).toBe(20);
    expect(sj.counts.teachers).toBe(1);
  }, 60_000);
});
