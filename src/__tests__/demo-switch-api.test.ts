import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import path from "path";
import { rmSync } from "fs";

const FILES = vi.hoisted(() => ({
  demo: "./data/career-demo-switch-api-test.db",
  prod: "./data/career-prod-switch-api-test.db",
  uploadsRoot: "./data/uploads-switch-api-test",
}));

vi.mock("@/lib/db-config", async (importOriginal) => {
  const mod = await importOriginal<typeof import("@/lib/db-config")>();
  const base = mod.getConfig();
  return { ...mod, getConfig: () => ({ ...base, installed: true, type: "sqlite", sqlite: { path: FILES.prod } }) };
});
vi.mock("@/lib/captcha", () => ({
  CAPTCHA_REQUIRED_MESSAGE: "请先完成人机验证",
  verifyCaptchaTicket: vi.fn(async () => ({ outcome: "passed" })),
}));

import { POST as switchPOST } from "@/app/api/auth/demo-switch/route";
import { GET as sessionGET } from "@/app/api/auth/route";
import { signToken } from "@/lib/token";
import { insertUser, getUserByCode, deleteTeacher, queryAuditLogs, closeDb, closeDemoDb } from "@/lib/db";
import { runInDemoScope } from "@/lib/demo-scope";
import { resetDemo } from "@/lib/demo-lifecycle";
import { createVisitorAccount, disableVisitorAccount } from "@/lib/demo-accounts-service";
import { demoAccountCodes, nextDemoStudentCode } from "@/lib/demo-accounts";

const PWD = "switch-pass-1";
const PROD_STUDENT = "202501010001";

function req(pathname: string, cookie?: string, body?: unknown, method: "POST" | "GET" = "POST"): NextRequest {
  return new NextRequest(new URL(pathname, "http://localhost:3000"), {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const flush = () => new Promise((r) => setTimeout(r, 50));

function cookieOf(res: Response): string {
  return /auth_token=([^;]+)/.exec(res.headers.get("set-cookie") ?? "")?.[1] ?? "";
}

function cleanup() {
  for (const f of [FILES.demo, FILES.prod]) for (const s of ["", "-wal", "-shm"]) rmSync(f + s, { force: true });
  rmSync(path.resolve(process.cwd(), FILES.uploadsRoot), { recursive: true, force: true });
}

describe("POST /api/auth/demo-switch（#255）", () => {
  beforeAll(async () => {
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = FILES.demo;
    process.env.UPLOADS_DIR = FILES.uploadsRoot;
    cleanup();
    await insertUser({ user_code: PROD_STUDENT, role: "student", name: "生产学生" });
    await resetDemo({ id: 1, name: "测试管理员", role: "admin" });
    await runInDemoScope(() => createVisitorAccount({ password: PWD }));
  }, 60_000);

  afterAll(async () => {
    await closeDemoDb();
    await closeDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    delete process.env.UPLOADS_DIR;
    cleanup();
  });

  it("未开启 → 404", async () => {
    const prev = process.env.DEMO_ENABLED;
    delete process.env.DEMO_ENABLED;
    expect((await switchPOST(req("/api/auth/demo-switch", undefined, { role: "teacher" }))).status).toBe(404);
    if (prev) process.env.DEMO_ENABLED = prev;
  });

  it("无 token / 非 demo token → 403，且拒绝落生产审计", async () => {
    expect((await switchPOST(req("/api/auth/demo-switch", undefined, { role: "teacher" }))).status).toBe(403);

    const prodToken = await signToken({ role: "admin", uid: 1, name: "生产管理员" });
    expect(
      (await switchPOST(req("/api/auth/demo-switch", `auth_token=${prodToken}`, { role: "teacher" }))).status
    ).toBe(403);

    await flush();
    expect(
      (await queryAuditLogs({ page: 1, pageSize: 50, action: "auth:demo-switch", status: "failed" })).total
    ).toBeGreaterThanOrEqual(1);
    // 拒绝未写入演示库
    expect(
      (await runInDemoScope(() => queryAuditLogs({ page: 1, pageSize: 50, action: "auth:demo-switch" }))).total
    ).toBe(0);
  }, 60_000);

  it("名册学生的演示会话（seq<1000）→ 403 非访客账户", async () => {
    const roster = await runInDemoScope(() => getUserByCode(nextDemoStudentCode(1)));
    const token = await signToken({ role: "student", uid: roster!.id, name: roster!.name, demo: true });
    const res = await switchPOST(req("/api/auth/demo-switch", `auth_token=${token}`, { role: "teacher" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("不属于访客账户");
  }, 60_000);

  it("访客账户：student → teacher → admin → student，cookie 更新且 GET /api/auth 复读正确", async () => {
    const codes = demoAccountCodes(1000);
    const rows = await runInDemoScope(async () => ({
      admin: await getUserByCode(codes.admin),
      teacher: await getUserByCode(codes.teacher),
      student: await getUserByCode(codes.student),
    }));

    // 以 student demo token 起步
    let token = await signToken({ role: "student", uid: rows.student!.id, name: rows.student!.name, demo: true });

    const toTeacher = await switchPOST(req("/api/auth/demo-switch", `auth_token=${token}`, { role: "teacher" }));
    expect(toTeacher.status).toBe(200);
    const tj = await toTeacher.json();
    expect(tj).toMatchObject({ ok: true, role: "teacher", uid: rows.teacher!.id, name: rows.student!.name, demo: true });
    token = cookieOf(toTeacher);
    expect(token).not.toBe("");

    const session = await sessionGET(req("/api/auth", `auth_token=${token}`, undefined, "GET"));
    expect(session.status).toBe(200);
    const sj = await session.json();
    expect(sj.role).toBe("teacher");
    expect(sj.demo).toBe(true);

    const toAdmin = await switchPOST(req("/api/auth/demo-switch", `auth_token=${token}`, { role: "admin" }));
    expect(toAdmin.status).toBe(200);
    expect((await toAdmin.json()).uid).toBe(rows.admin!.id);
    token = cookieOf(toAdmin);

    const toStudent = await switchPOST(req("/api/auth/demo-switch", `auth_token=${token}`, { role: "student" }));
    expect(toStudent.status).toBe(200);
    expect((await toStudent.json()).uid).toBe(rows.student!.id);

    // 切到当前角色幂等：仍成功重签
    const sameAgain = await switchPOST(
      req("/api/auth/demo-switch", `auth_token=${cookieOf(toStudent)}`, { role: "student" })
    );
    expect(sameAgain.status).toBe(200);
    expect((await sameAgain.json()).uid).toBe(rows.student!.id);
  }, 60_000);

  it("目标角色身份缺失 → 404", async () => {
    const second = await runInDemoScope(() => createVisitorAccount());
    const codes = demoAccountCodes(second.seq);
    const teacher = await runInDemoScope(() => getUserByCode(codes.teacher));
    await runInDemoScope(() => deleteTeacher(teacher!.id)); // 人为删掉教师身份
    const student = await runInDemoScope(() => getUserByCode(codes.student));
    const token = await signToken({ role: "student", uid: student!.id, name: student!.name, demo: true });
    const res = await switchPOST(req("/api/auth/demo-switch", `auth_token=${token}`, { role: "teacher" }));
    expect(res.status).toBe(404);
  }, 60_000);

  it("非法角色 → 400", async () => {
    const codes = demoAccountCodes(1000);
    const student = await runInDemoScope(() => getUserByCode(codes.student));
    const token = await signToken({ role: "student", uid: student!.id, name: student!.name, demo: true });
    expect(
      (await switchPOST(req("/api/auth/demo-switch", `auth_token=${token}`, { role: "superadmin" }))).status
    ).toBe(400);
    expect((await switchPOST(req("/api/auth/demo-switch", `auth_token=${token}`, {}))).status).toBe(400);
  });

  it("生产会话的 GET /api/auth 返回 demo=false（前端据此不渲染横幅）", async () => {
    const prod = await getUserByCode(PROD_STUDENT); // 非演示作用域 → 生产库
    const token = await signToken({ role: "student", uid: prod!.id, name: prod!.name });
    const session = await sessionGET(req("/api/auth", `auth_token=${token}`, undefined, "GET"));
    expect(session.status).toBe(200);
    const body = await session.json();
    expect(body.role).toBe("student");
    expect(body.demo).toBe(false);
  });

  it("禁用账户后切换 → 403 已禁用", async () => {
    const codes = demoAccountCodes(1000);
    const student = await runInDemoScope(() => getUserByCode(codes.student));
    const token = await signToken({ role: "student", uid: student!.id, name: student!.name, demo: true });
    await runInDemoScope(() => disableVisitorAccount(1000));
    const res = await switchPOST(req("/api/auth/demo-switch", `auth_token=${token}`, { role: "teacher" }));
    expect(res.status).toBe(403);
    expect((await res.json()).error).toContain("已禁用");
  }, 60_000);

  it("成功切换只落演示审计；生产库无成功记录", async () => {
    await flush();
    expect(
      (await runInDemoScope(() => queryAuditLogs({ page: 1, pageSize: 50, action: "auth:demo-switch", status: "success" }))).total
    ).toBeGreaterThanOrEqual(1);
    expect(
      (await queryAuditLogs({ page: 1, pageSize: 50, action: "auth:demo-switch", status: "success" })).total
    ).toBe(0);
  });
});
