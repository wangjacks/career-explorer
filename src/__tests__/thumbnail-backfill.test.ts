import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import sharp from "sharp";
import { signToken } from "@/lib/token";

// 假存储适配器（vi.hoisted 供 mock 工厂引用）
const fakeStorage = vi.hoisted(() => ({
  exists: vi.fn(),
  read: vi.fn(),
  upload: vi.fn(),
}));

// 隔离数据库与存储层：补生成端点只关注鉴权与扫描/生成流程
vi.mock("@/lib/db", () => ({
  getAllReferencedMedia: vi.fn(),
  insertAuditLog: vi.fn(),
  // getAuditActor 内部经 getUserById 取操作者快照，补齐避免审计路径被静默吞掉（review 修复）
  getUserById: vi.fn(async () => ({ user_code: "10001", name: "管理员", role: "admin" })),
}));

vi.mock("@/lib/storage", () => ({
  getStorage: vi.fn(async () => fakeStorage),
}));

import { POST } from "@/app/api/manage/media/generate-thumbnails/route";
import { GET as STATUS_GET } from "@/app/api/manage/media/generate-thumbnails/status/route";
import { getAllReferencedMedia, insertAuditLog } from "@/lib/db";
import { getStorage } from "@/lib/storage";

function createGetRequest(cookies?: Record<string, string>): NextRequest {
  const url = new URL("/api/manage/media/generate-thumbnails/status", "http://localhost:3000");
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method: "GET",
    headers: { "Content-Type": "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
  });
}
function createPostRequest(cookies?: Record<string, string>): NextRequest {
  const url = new URL("/api/manage/media/generate-thumbnails", "http://localhost:3000");
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    body: "{}",
  });
}

/** 真实 JPEG 原图 buffer（sharp 在测试环境可用） */
async function makeJpeg(): Promise<Buffer> {
  return sharp({ create: { width: 400, height: 300, channels: 3, background: { r: 100, g: 150, b: 200 } } })
    .jpeg()
    .toBuffer();
}

describe("缩略图存量补生成端点（#118）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeStorage.exists.mockReset();
    fakeStorage.read.mockReset();
    fakeStorage.upload.mockReset();
  });

  it("非 admin → 403", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "学生" });
    const res = await POST(createPostRequest({ auth_token: token }));
    expect(res.status).toBe(403);
    expect(getAllReferencedMedia).not.toHaveBeenCalled();
  });

  it("扫描全部被引用文件：已存在跳过、缺失补生成、去重、统计正确", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    // users 头像（本地代理路径）+ 快照词云（裸 key，且被两行引用 → 去重）
    vi.mocked(getAllReferencedMedia).mockResolvedValue([
      { url: "/api/uploads/avatar_202505050101_20260826120000_ab12.jpg", storageId: 1 },
      { url: "evaluation_202505050101_20260826120000_cd34.jpg", storageId: 2 },
      { url: "evaluation_202505050101_20260826120000_cd34.jpg", storageId: 2 },
    ]);
    const jpg = await makeJpeg();
    fakeStorage.exists.mockResolvedValue(false);
    fakeStorage.read.mockResolvedValue(jpg);
    fakeStorage.upload.mockResolvedValue(undefined);

    const res = await POST(createPostRequest({ auth_token: token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    // 本地值剥前缀 + 云值裸 key；重复引用去重 → total 2，全部生成
    expect(body).toMatchObject({ ok: true, total: 2, generated: 2, skipped: 0, failed: 0 });
    expect(getStorage).toHaveBeenCalledTimes(2);
    expect(fakeStorage.upload).toHaveBeenCalledWith(
      "avatar_202505050101_20260826120000_ab12_thumb.jpg",
      expect.any(Buffer),
      "image/jpeg"
    );
    expect(fakeStorage.upload).toHaveBeenCalledWith(
      "evaluation_202505050101_20260826120000_cd34_thumb.jpg",
      expect.any(Buffer),
      "image/jpeg"
    );
    // 成功路径必须记录审计（review 修复：此前审计路径未被断言守护）
    expect(insertAuditLog).toHaveBeenCalled();
  });

  it("缩略图已存在 → 跳过；单文件失败 → failed 计数且不中断", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getAllReferencedMedia).mockResolvedValue([
      { url: "avatar_a.jpg", storageId: 1 },
      { url: "avatar_b.jpg", storageId: 1 },
      { url: "avatar_c.jpg", storageId: 1 },
    ]);
    const jpg = await makeJpeg();
    // a：缩略图已存在 → skip；b：read 失败 → failed；c：正常生成
    fakeStorage.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false).mockResolvedValueOnce(false);
    fakeStorage.read.mockRejectedValueOnce(new Error("read fail")).mockResolvedValue(jpg);
    fakeStorage.upload.mockResolvedValue(undefined);

    const res = await POST(createPostRequest({ auth_token: token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ total: 3, generated: 1, skipped: 1, failed: 1 });
  });

  it("检测端点（GET status）：只读统计已有/缺失，非 admin 拒绝", async () => {
    // 非 admin → 403
    const studentToken = await signToken({ role: "student", uid: 7, name: "学生" });
    let res = await STATUS_GET(createGetRequest({ auth_token: studentToken }));
    expect(res.status).toBe(403);

    // admin：2 个文件，1 个已有缩略图、1 个缺失
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getAllReferencedMedia).mockResolvedValue([
      { url: "avatar_a.jpg", storageId: 1 },
      { url: "evaluation_b.jpg", storageId: 1 },
    ]);
    fakeStorage.exists.mockResolvedValueOnce(true).mockResolvedValueOnce(false);
    res = await STATUS_GET(createGetRequest({ auth_token: token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, total: 2, existing: 1, missing: 1 });
    // 只读：不触发 upload
    expect(fakeStorage.upload).not.toHaveBeenCalled();
  });
});
