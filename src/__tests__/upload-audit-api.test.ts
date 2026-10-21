import { describe, it, expect, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { NextRequest } from "next/server";
import sharp from "sharp";

/** 真实数据层 + 临时 SQLite：本文件断言 audit_logs 的实际写入，而非 mock 调用 */
const state = vi.hoisted(() => ({ dbPath: "" }));

vi.mock("@/lib/db-config", () => ({
  getConfig: () => ({
    installed: true,
    type: "sqlite",
    sqlite: { path: state.dbPath },
    mysql: { host: "127.0.0.1", port: 3306, user: "root", password: "", database: "unused" },
  }),
  isInstalled: () => true,
  setConfig: () => {},
}));

vi.mock("@/lib/storage", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/storage")>();
  return { ...actual, getStorage: vi.fn() };
});

import { POST } from "@/app/api/upload/route";
import { closeDb, getDefaultStorageBackend, insertUser, queryAuditLogs } from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { signToken } from "@/lib/token";
import { UPLOAD_UNSUPPORTED_FORMAT_MESSAGE } from "@/lib/upload-utils";
import type { StorageAdapter } from "@/lib/storage";

const BASE = "http://localhost:3000";
const STUDENT_CODE = "202505050101";
const STUDENT_NAME = "张三";
const ANONYMOUS_WARN_PREFIX = "[upload] anonymous upload failure (audit skipped):";

let tempDir = "";
let studentId = 0;
let studentToken = "";
let defaultBackendId = 1;
let uploadMock: ReturnType<typeof vi.fn>;
let warnSpy: ReturnType<typeof vi.spyOn>;
let errorSpy: ReturnType<typeof vi.spyOn> | null = null;

function toFile(bytes: Buffer, name: string, type: string): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

function createUploadRequest(opts: {
  file?: File | null;
  prefix?: string | null;
  studentId?: string | null;
  token?: string | null;
}): NextRequest {
  const fd = new FormData();
  if (opts.file) fd.append("file", opts.file);
  if (opts.prefix != null) fd.append("prefix", opts.prefix);
  if (opts.studentId != null) fd.append("studentId", opts.studentId);
  const headers: Record<string, string> = {};
  if (opts.token) headers.cookie = `auth_token=${opts.token}`;
  // 不手写 Content-Type：交给运行时生成带 boundary 的 multipart 头
  return new NextRequest(new URL("/api/upload", BASE), { method: "POST", body: fd, headers });
}

/** 审计只追加，各用例以请求前的总数为基线；不按 action 过滤，避免错误分类的 upload:failed 漏检 */
async function auditTotal(): Promise<number> {
  const { total } = await queryAuditLogs({ page: 1, pageSize: 1 });
  return total;
}

async function waitForAuditCount(expected: number): Promise<void> {
  await vi.waitFor(
    async () => {
      expect(await auditTotal()).toBe(expected);
    },
    { timeout: 2000 }
  );
}

/** 等到匿名分支自己的 warn（recordAudit 失败也会 warn，不能只看调用次数） */
async function waitForAnonymousWarn(): Promise<unknown[]> {
  return vi.waitFor(
    () => {
      const call = warnSpy.mock.calls.find((args: unknown[]) =>
        String(args[0]).includes(ANONYMOUS_WARN_PREFIX)
      );
      if (!call) throw new Error("未等到匿名上传失败的 warn");
      return call;
    },
    { timeout: 2000 }
  ) as Promise<unknown[]>;
}

function warnPayload(call: unknown[]): Record<string, unknown> {
  expect(typeof call[1]).toBe("string");
  return JSON.parse(String(call[1])) as Record<string, unknown>;
}

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "career-upload-audit-"));
  state.dbPath = path.join(tempDir, "test.db");

  studentId = await insertUser({ user_code: STUDENT_CODE, role: "student", name: STUDENT_NAME });
  studentToken = await signToken({ role: "student", uid: studentId, name: STUDENT_NAME });

  const backend = await getDefaultStorageBackend();
  expect(backend, "DB init 应种下内置本地存储后端").toBeDefined();
  defaultBackendId = backend!.id;
}, 30_000);

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

beforeEach(() => {
  vi.clearAllMocks();
  warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
  uploadMock = vi.fn(async () => undefined);
  vi.mocked(getStorage).mockResolvedValue({ upload: uploadMock } as unknown as StorageAdapter);
});

afterEach(() => {
  warnSpy.mockRestore();
  errorSpy?.mockRestore();
  errorSpy = null;
});

describe("POST /api/upload — 匿名失败不落审计（#259）", () => {
  it("无会话 400 拒绝：仅 stdout 告警，audit_logs 不新增", async () => {
    const before = await auditTotal();
    const res = await POST(createUploadRequest({ prefix: "avatar", studentId: STUDENT_CODE }));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("未选择文件");

    const payload = warnPayload(await waitForAnonymousWarn());
    expect(payload).toMatchObject({
      action: "upload:rejected",
      message: "未选择文件",
      resourceId: STUDENT_CODE,
      metadata: { prefix: "avatar", sizeBytes: null, mime: null, limitMb: null, cause: null },
    });

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await auditTotal()).toBe(before);
  });

  it("无会话解码失败 500：仅 stdout 告警，不写审计且不泄露文件名", async () => {
    errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const before = await auditTotal();
    const res = await POST(
      createUploadRequest({
        file: toFile(Buffer.from("definitely not an image"), "private-name.jpg", "image/jpeg"),
        prefix: "avatar",
        studentId: STUDENT_CODE,
      })
    );
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(UPLOAD_UNSUPPORTED_FORMAT_MESSAGE);

    const payload = warnPayload(await waitForAnonymousWarn());
    expect(payload.action).toBe("upload:failed");
    expect(payload.message).toBe(UPLOAD_UNSUPPORTED_FORMAT_MESSAGE);
    expect(String((payload.metadata as Record<string, unknown>).cause)).toMatch(/unsupported image format/i);
    expect(JSON.stringify(payload)).not.toContain("private-name");

    await new Promise((resolve) => setTimeout(resolve, 25));
    expect(await auditTotal()).toBe(before);
  });
});

describe("POST /api/upload — 已认证失败仍落审计（#259）", () => {
  it("学生会话下 400 拒绝：actor 快照与 metadata 保持原口径", async () => {
    const before = await auditTotal();
    const res = await POST(
      createUploadRequest({
        file: toFile(Buffer.from("x"), "a.txt", "text/plain"),
        prefix: "avatar",
        studentId: STUDENT_CODE,
        token: studentToken,
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("仅支持图片文件");

    await waitForAuditCount(before + 1);
    const { rows } = await queryAuditLogs({ page: 1, pageSize: 20, action: "upload:rejected" });
    const log = rows.find((row) => row.actor_id === studentId);
    expect(log).toBeDefined();
    expect(log).toMatchObject({
      actor_id: studentId,
      actor_user_code: STUDENT_CODE,
      actor_name: STUDENT_NAME,
      actor_role: "student",
      action: "upload:rejected",
      method: "POST",
      path: "/api/upload",
      resource_type: "upload",
      resource_id: STUDENT_CODE,
      status: "failed",
      error_message: "仅支持图片文件",
    });
    expect(JSON.parse(String(log!.metadata))).toEqual({
      prefix: "avatar",
      sizeBytes: 1,
      mime: "text/plain",
      limitMb: null,
      cause: null,
    });
  });
});

describe("POST /api/upload — 正常上传不变", () => {
  it("已认证上传成功：200 + 存储写入，不写失败审计", async () => {
    const before = await auditTotal();
    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();

    const res = await POST(
      createUploadRequest({
        file: toFile(jpeg, "a.jpg", "image/jpeg"),
        prefix: "avatar",
        studentId: STUDENT_CODE,
        token: studentToken,
      })
    );
    expect(res.status).toBe(200);

    const body = (await res.json()) as { url: string; storageId: number };
    expect(body.url).toMatch(
      new RegExp(`^/api/uploads/avatar_${STUDENT_CODE}_\\d{14}_[a-z0-9]{4}\\.jpg$`)
    );
    expect(body.storageId).toBe(defaultBackendId);
    expect(uploadMock).toHaveBeenCalledTimes(2); // 缩略图 + 原图
    expect(await auditTotal()).toBe(before);
  });
});
