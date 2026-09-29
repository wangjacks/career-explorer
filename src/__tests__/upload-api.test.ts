import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";

// 隔离数据库层与存储层：本用例只锁定「失败可诊断」的行为（#206）
vi.mock("@/lib/db", () => ({
  getDefaultStorageBackend: vi.fn(),
  getMaxAvatarSizeMb: vi.fn(),
  getMaxEvaluationSizeMb: vi.fn(),
  insertAuditLog: vi.fn(),
  getUserById: vi.fn(),
}));
vi.mock("@/lib/storage", () => ({
  generateObjectKey: vi.fn(() => "avatar_test.jpg"),
  getStorage: vi.fn(),
}));
// 缩略图会再走一遍 sharp，与本用例无关（且 s3 分支下不必真正上传）
vi.mock("@/lib/thumbnail", () => ({
  createThumbnail: vi.fn(async () => Buffer.from("thumb")),
}));

import { POST } from "@/app/api/upload/route";
import {
  getDefaultStorageBackend,
  getMaxAvatarSizeMb,
  getMaxEvaluationSizeMb,
  insertAuditLog,
} from "@/lib/db";
import { getStorage } from "@/lib/storage";
import { UPLOAD_UNSUPPORTED_FORMAT_MESSAGE } from "@/lib/upload-utils";
import type { StorageBackendRow } from "@/lib/db";
import type { StorageAdapter } from "@/lib/storage";

const MB = 1024 * 1024;

/** Node 的 Buffer 与 DOM 的 BlobPart 类型不完全对齐（Buffer 可是 SharedArrayBuffer 视图），运行期等价 */
function toFile(bytes: Buffer, name: string, type: string): File {
  return new File([bytes as unknown as BlobPart], name, { type });
}

function createUploadRequest(opts: {
  file?: File | null;
  prefix?: string | null;
  studentId?: string | null;
}): NextRequest {
  const fd = new FormData();
  if (opts.file) fd.append("file", opts.file);
  if (opts.prefix != null) fd.append("prefix", opts.prefix);
  if (opts.studentId != null) fd.append("studentId", opts.studentId);
  // 不手写 Content-Type：交给运行时生成带 boundary 的 multipart 头
  return new NextRequest(new URL("/api/upload", "http://localhost:3000"), {
    method: "POST",
    body: fd,
  });
}

/** 失败审计是 fire-and-forget（void + async IIFE），等一个宏任务让微任务链跑完 */
const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

/** 取本次请求写入的第一条审计记录（metadata 已被 recordAudit 序列化成字符串） */
function firstAudit() {
  const call = vi.mocked(insertAuditLog).mock.calls[0];
  expect(call, "未写入任何审计记录").toBeDefined();
  return { ...call[0], metadata: JSON.parse(String(call[0].metadata)) as Record<string, unknown> };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getMaxAvatarSizeMb).mockResolvedValue(5);
  vi.mocked(getMaxEvaluationSizeMb).mockResolvedValue(10);
});

describe("POST /api/upload — 体积与格式（#206）", () => {
  it("体积超限 → 400，审计含体积与当时的上限", async () => {
    vi.mocked(getMaxAvatarSizeMb).mockResolvedValue(1);
    const req = createUploadRequest({
      file: toFile(Buffer.alloc(MB + 1), "a.jpg", "image/jpeg"),
      prefix: "avatar",
      studentId: "202505050101",
    });

    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("图片大小不能超过 1MB");

    await flushAudit();
    const log = firstAudit();
    expect(log.action).toBe("upload:rejected");
    expect(log.resource_type).toBe("upload");
    expect(log.resource_id).toBe("202505050101");
    expect(log.status).toBe("failed");
    expect(log.error_message).toBe("图片大小不能超过 1MB");
    expect(log.method).toBe("POST");
    expect(log.path).toBe("/api/upload");
    expect(log.metadata).toEqual({
      prefix: "avatar",
      sizeBytes: MB + 1,
      mime: "image/jpeg",
      limitMb: 1,
      cause: null,
    });
  });

  it("无法解码的图片 → 500、文案指明格式，审计留下 sharp 原文", async () => {
    const junk = "definitely not an image";
    const req = createUploadRequest({
      file: toFile(Buffer.from(junk), "x.jpg", "image/jpeg"),
      prefix: "avatar",
      studentId: "202505050101",
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe(UPLOAD_UNSUPPORTED_FORMAT_MESSAGE);

    await flushAudit();
    const log = firstAudit();
    expect(log.action).toBe("upload:failed");
    expect(log.error_message).toBe(UPLOAD_UNSUPPORTED_FORMAT_MESSAGE);
    // 面向学生的文案与运维用的原文分开：根因靠 metadata.cause 定论
    expect(String(log.metadata.cause)).toMatch(/unsupported image format/i);
    expect(log.metadata.sizeBytes).toBe(Buffer.byteLength(junk));
    expect(log.metadata.mime).toBe("image/jpeg");
  });

  it("缺少文件 → 400，且不记文件名（只记体量与类型）", async () => {
    const req = createUploadRequest({ prefix: "avatar", studentId: "202505050101" });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("未选择文件");

    await flushAudit();
    const log = firstAudit();
    expect(log.action).toBe("upload:rejected");
    expect(log.metadata).toMatchObject({ sizeBytes: null, mime: null, prefix: "avatar" });
    expect(JSON.stringify(log)).not.toContain("未选择文件.jpg");
  });

  it("非图片类型 → 400；不可信的 studentId 不进 resource_id", async () => {
    const req = createUploadRequest({
      file: toFile(Buffer.from("x"), "a.txt", "text/plain"),
      prefix: "avatar",
      studentId: "../../etc/passwd",
    });
    const res = await POST(req);
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("仅支持图片文件");

    await flushAudit();
    const log = firstAudit();
    expect(log.resource_id).toBeNull();
    expect(JSON.stringify(log)).not.toContain("passwd");
  });

  it("存储后端未初始化 → 500，配置类故障同样留审计", async () => {
    vi.mocked(getDefaultStorageBackend).mockResolvedValue(undefined);
    // 必须是一张能被 sharp 解码的真图：否则会先落到解码失败的 catch 分支
    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    const req = createUploadRequest({
      file: toFile(jpeg, "a.jpg", "image/jpeg"),
      prefix: "avatar",
      studentId: "202505050101",
    });

    const res = await POST(req);
    expect(res.status).toBe(500);
    expect((await res.json()).error).toBe("存储后端未初始化");

    await flushAudit();
    const log = firstAudit();
    expect(log.action).toBe("upload:failed");
    expect(log.error_message).toBe("存储后端未初始化");
    expect(log.resource_id).toBe("202505050101");
    expect(log.metadata.prefix).toBe("avatar");
  });

  it("成功上传 → 200，不写失败审计", async () => {
    vi.mocked(getDefaultStorageBackend).mockResolvedValue({
      id: 2,
      type: "s3",
    } as unknown as StorageBackendRow);
    vi.mocked(getStorage).mockResolvedValue({
      upload: vi.fn(async () => undefined),
    } as unknown as StorageAdapter);

    const jpeg = await sharp({
      create: { width: 4, height: 4, channels: 3, background: { r: 1, g: 2, b: 3 } },
    })
      .jpeg()
      .toBuffer();
    const req = createUploadRequest({
      file: toFile(jpeg, "a.jpg", "image/jpeg"),
      prefix: "avatar",
      studentId: "202505050101",
    });

    const res = await POST(req);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ url: "avatar_test.jpg", storageId: 2 });

    await flushAudit();
    expect(insertAuditLog).not.toHaveBeenCalled();
  });
});
