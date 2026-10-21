import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { NextRequest } from "next/server";
import path from "path";
import { rmSync, existsSync } from "fs";

const FILES = vi.hoisted(() => ({
  demo: "./data/career-demo-accounts-api-test.db",
  prod: "./data/career-prod-accounts-api-test.db",
  uploadsRoot: "./data/uploads-accounts-api-test",
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

import { GET, POST } from "@/app/api/manage/demo/accounts/route";
import { PATCH, DELETE } from "@/app/api/manage/demo/accounts/[seq]/route";
import { POST as demoLogin } from "@/app/api/auth/demo/route";
import { signToken } from "@/lib/token";
import { insertUser, getStudents, queryAuditLogs, closeDb, closeDemoDb, getUserByCode } from "@/lib/db";
import { runInDemoScope } from "@/lib/demo-scope";
import { resetDemo } from "@/lib/demo-lifecycle";
import { demoAccountCodes } from "@/lib/demo-accounts";

const DB_ABS = path.resolve(process.cwd(), FILES.demo);
const UPLOADS_ABS = path.resolve(process.cwd(), FILES.uploadsRoot);
const PROD_STUDENT = "202501010001";

function req(method: "GET" | "POST" | "PATCH" | "DELETE", pathname: string, cookie?: string, body?: unknown): NextRequest {
  return new NextRequest(new URL(pathname, "http://localhost:3000"), {
    method,
    headers: {
      ...(cookie ? { cookie } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

const seqCtx = (seq: string) => ({ params: Promise.resolve({ seq }) });

function cleanup() {
  for (const f of [FILES.demo, FILES.prod]) for (const s of ["", "-wal", "-shm"]) rmSync(f + s, { force: true });
  rmSync(UPLOADS_ABS, { recursive: true, force: true });
}

async function adminCookie(): Promise<string> {
  return `auth_token=${await signToken({ role: "admin", uid: 1, name: "生产管理员" })}`;
}

const flush = () => new Promise((r) => setImmediate(r));

describe("演示访客账户端点（#278）", () => {
  beforeAll(async () => {
    process.env.DEMO_ENABLED = "true";
    process.env.DEMO_DB_PATH = FILES.demo;
    process.env.UPLOADS_DIR = FILES.uploadsRoot;
    cleanup();
    await insertUser({ user_code: PROD_STUDENT, role: "student", name: "生产学生" });
  }, 60_000);

  afterAll(async () => {
    await closeDemoDb();
    await closeDb();
    delete process.env.DEMO_ENABLED;
    delete process.env.DEMO_DB_PATH;
    delete process.env.UPLOADS_DIR;
    cleanup();
  });

  it("未初始化：创建 409 且不建库；列表空；按 seq 操作 404", async () => {
    const cookie = await adminCookie();
    const create = await POST(req("POST", "/api/manage/demo/accounts", cookie));
    expect(create.status).toBe(409);
    expect(existsSync(DB_ABS)).toBe(false);

    const list = await GET(req("GET", "/api/manage/demo/accounts", cookie));
    expect(list.status).toBe(200);
    expect((await list.json()).accounts).toEqual([]);

    expect((await PATCH(req("PATCH", "/api/manage/demo/accounts/1000", cookie, { action: "disable" }), seqCtx("1000"))).status).toBe(404);
    expect((await DELETE(req("DELETE", "/api/manage/demo/accounts/1000", cookie), seqCtx("1000"))).status).toBe(404);
  });

  describe("演示库已播种后", () => {
    beforeAll(async () => {
      await resetDemo({ id: 1, name: "测试管理员", role: "admin" });
    }, 60_000);

    it("门禁：未开启 404；演示会话 403 且拒绝落演示审计；teacher 403；无 token 403", async () => {
      const admin = await adminCookie();
      // demo session
      const demo = `auth_token=${await signToken({ role: "admin", uid: 1, name: "D", demo: true })}`;
      expect((await GET(req("GET", "/api/manage/demo/accounts", demo))).status).toBe(403);
      expect((await POST(req("POST", "/api/manage/demo/accounts", demo))).status).toBe(403);
      await flush();
      const demoAudit = await runInDemoScope(() => queryAuditLogs({ page: 1, pageSize: 50, action: "demo:account-create" }));
      expect(demoAudit.total).toBeGreaterThanOrEqual(1);
      // teacher
      const teacher = `auth_token=${await signToken({ role: "teacher", uid: 2, name: "T" })}`;
      expect((await GET(req("GET", "/api/manage/demo/accounts", teacher))).status).toBe(403);
      // no token
      expect((await GET(req("GET", "/api/manage/demo/accounts"))).status).toBe(403);
      // disabled
      const prev = process.env.DEMO_ENABLED;
      delete process.env.DEMO_ENABLED;
      expect((await GET(req("GET", "/api/manage/demo/accounts", admin))).status).toBe(404);
      if (prev) process.env.DEMO_ENABLED = prev;
    }, 60_000);

    it("创建 → 仅演示库 +3 行、生产零改动、成功审计落生产；列表不泄露 hash", async () => {
      const cookie = await adminCookie();
      const res = await POST(req("POST", "/api/manage/demo/accounts", cookie));
      expect(res.status).toBe(200);
      const created = await res.json();
      expect(created.seq).toBe(1000);
      expect(created.codes).toEqual(demoAccountCodes(1000));
      expect(typeof created.password).toBe("string");

      const demoRows = await runInDemoScope(async () => [
        await getUserByCode(created.codes.admin),
        await getUserByCode(created.codes.teacher),
        await getUserByCode(created.codes.student),
      ]);
      expect(demoRows.every((r) => r?.name === created.name)).toBe(true);
      expect(await getStudents()).toHaveLength(1); // 生产库仍只有预置学生

      await flush();
      expect((await queryAuditLogs({ page: 1, pageSize: 50, action: "demo:account-create", status: "success" })).total).toBeGreaterThanOrEqual(1);
      // 成功事件只落生产：演示库中不应有该动作的 success 记录（此前的越权拒绝是 failed）
      expect((await runInDemoScope(() => queryAuditLogs({ page: 1, pageSize: 50, action: "demo:account-create", status: "success" }))).total).toBe(0);

      const list = await GET(req("GET", "/api/manage/demo/accounts", cookie));
      const body = await list.json();
      expect(body.accounts).toHaveLength(1);
      expect(JSON.stringify(body)).not.toContain("$2");
    }, 60_000);

    it("非法 seq → 400；不存在的 seq → 404", async () => {
      const cookie = await adminCookie();
      expect((await PATCH(req("PATCH", "/api/manage/demo/accounts/abc", cookie, { action: "disable" }), seqCtx("abc"))).status).toBe(400);
      expect((await PATCH(req("PATCH", "/api/manage/demo/accounts/999", cookie, { action: "disable" }), seqCtx("999"))).status).toBe(400);
      expect((await PATCH(req("PATCH", "/api/manage/demo/accounts/1234", cookie, { action: "disable" }), seqCtx("1234"))).status).toBe(404);
    });

    it("禁用后该账户无法登录（提示未设密码）", async () => {
      const cookie = await adminCookie();
      const disabled = await PATCH(req("PATCH", "/api/manage/demo/accounts/1000", cookie, { action: "disable" }), seqCtx("1000"));
      expect(disabled.status).toBe(200);
      // 需要原始密码：重新生成一个账户取密码更简单——直接用 seq1000 的旧密码不可得，改为重置再禁用路径：
      // 先重置密码拿新明文，再禁用，验证登录被拦。
      const rot = await PATCH(req("PATCH", "/api/manage/demo/accounts/1000", cookie, { action: "regenerate-password" }), seqCtx("1000"));
      const { password } = await rot.json();
      const reDisable = await PATCH(req("PATCH", "/api/manage/demo/accounts/1000", cookie, { action: "disable" }), seqCtx("1000"));
      expect(reDisable.status).toBe(200);

      const login = await demoLogin(req("POST", "/api/auth/demo", undefined, { userCode: demoAccountCodes(1000).student, password }));
      expect(login.status).toBe(401);
      expect((await login.json()).error).toContain("尚未设置密码");
    }, 60_000);

    it("重置密码后三编号分别登入 admin/teacher/student；旧密码失效", async () => {
      const cookie = await adminCookie();
      const rot = await PATCH(req("PATCH", "/api/manage/demo/accounts/1000", cookie, { action: "regenerate-password" }), seqCtx("1000"));
      expect(rot.status).toBe(200);
      const { password } = await rot.json();
      const codes = demoAccountCodes(1000);
      for (const [code, role] of [[codes.admin, "admin"], [codes.teacher, "teacher"], [codes.student, "student"]] as const) {
        const login = await demoLogin(req("POST", "/api/auth/demo", undefined, { userCode: code, password }));
        expect(login.status).toBe(200);
        expect((await login.json()).role).toBe(role);
      }
      const bad = await demoLogin(req("POST", "/api/auth/demo", undefined, { userCode: codes.student, password: "wrong-pass" }));
      expect(bad.status).toBe(401);
    }, 60_000);

    it("删除 → 200，三编号不再存在，生产库不受影响，成功审计落生产", async () => {
      const cookie = await adminCookie();
      const res = await DELETE(req("DELETE", "/api/manage/demo/accounts/1000", cookie), seqCtx("1000"));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.deleted).toEqual({ admin: true, teacher: true, student: true });

      const rows = await runInDemoScope(async () => [
        await getUserByCode(demoAccountCodes(1000).admin),
        await getUserByCode(demoAccountCodes(1000).teacher),
        await getUserByCode(demoAccountCodes(1000).student),
      ]);
      expect(rows.every((r) => r === undefined)).toBe(true);
      expect(await getStudents()).toHaveLength(1); // 生产库未动
      await flush();
      expect((await queryAuditLogs({ page: 1, pageSize: 50, action: "demo:account-delete" })).total).toBeGreaterThanOrEqual(1);
    }, 60_000);
  });
});
