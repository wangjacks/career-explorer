import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 假存储（vi.hoisted 供 mock 工厂引用）
const fakeStorage = vi.hoisted(() => ({
  listObjects: vi.fn(),
  delete: vi.fn(),
  exists: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getAllReferencedMedia: vi.fn(),
  listStorageBackends: vi.fn(),
  getMediaOrphanRetentionDays: vi.fn(),
  setProfileConfig: vi.fn(),
  insertAuditLog: vi.fn(),
  getUserById: vi.fn(async () => ({ user_code: "10001", name: "管理员", role: "admin" })),
  MEDIA_ORPHAN_RETENTION_KEY: "media_orphan_retention_days",
}));

vi.mock("@/lib/storage", () => ({
  getStorage: vi.fn(async () => fakeStorage),
}));

import { GET as STATUS_GET, PUT as STATUS_PUT } from "@/app/api/manage/media/status/route";
import { GET as ORPHANS_GET } from "@/app/api/manage/media/orphans/route";
import { POST as CLEANUP_POST } from "@/app/api/manage/media/orphans/cleanup/route";
import { getAllReferencedMedia, listStorageBackends, getMediaOrphanRetentionDays, setProfileConfig, insertAuditLog } from "@/lib/db";

function makeRequest(method: "GET" | "POST" | "PUT", path: string, cookies?: Record<string, string>, body?: unknown): NextRequest {
  const url = new URL(path, "http://localhost:3000");
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method,
    headers: { "Content-Type": "application/json", ...(cookieHeader ? { cookie: cookieHeader } : {}) },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

/** 默认扫描数据：1 个可删孤儿（带缩略图）+ 1 个未到期 + 1 个被引用 */
function mockScanData() {
  vi.mocked(getMediaOrphanRetentionDays).mockResolvedValue(7);
  vi.mocked(getAllReferencedMedia).mockResolvedValue([{ url: "avatar_used.jpg", storageId: 1 }]);
  vi.mocked(listStorageBackends).mockResolvedValue([{ id: 1, type: "local", name: "本地", is_default: 1 } as never]);
  fakeStorage.listObjects.mockResolvedValueOnce([
    { key: "avatar_orphan_a.jpg", size: 100, lastModified: daysAgo(30) }, // 可删
    { key: "avatar_orphan_a_thumb.jpg", size: 10, lastModified: daysAgo(30) }, // 缩略图（随源）
    { key: "avatar_new_b.jpg", size: 50, lastModified: daysAgo(2) }, // 未到期
    { key: "avatar_used.jpg", size: 80, lastModified: daysAgo(1) }, // 被引用
  ]);
}

describe("媒体管理端点（#117）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeStorage.listObjects.mockReset();
    fakeStorage.delete.mockReset();
    fakeStorage.exists.mockReset();
  });

  it("非 admin → 403（status GET / orphans GET / cleanup POST）", async () => {
    const token = await signToken({ role: "student", uid: 7, name: "学生" });
    let res = await STATUS_GET(makeRequest("GET", "/api/manage/media/status", { auth_token: token }));
    expect(res.status).toBe(403);
    res = await ORPHANS_GET(makeRequest("GET", "/api/manage/media/orphans", { auth_token: token }));
    expect(res.status).toBe(403);
    res = await CLEANUP_POST(makeRequest("POST", "/api/manage/media/orphans/cleanup", { auth_token: token }, { items: [] }));
    expect(res.status).toBe(403);
  });

  it("status GET：返回扫描统计与保留期", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    mockScanData();
    const res = await STATUS_GET(makeRequest("GET", "/api/manage/media/status", { auth_token: token }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      total: 4,
      orphanCount: 3,
      deletableCount: 2, // orphan_a + 其缩略图
      retentionDays: 7,
    });
  });

  it("status PUT：非法值 400；合法保存并审计 media:config-update", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    for (const bad of [0, 366, "abc", 1.5]) {
      const res = await STATUS_PUT(makeRequest("PUT", "/api/manage/media/status", { auth_token: token }, { retentionDays: bad }));
      expect(res.status).toBe(400);
      expect(setProfileConfig).not.toHaveBeenCalled();
    }
    const res = await STATUS_PUT(makeRequest("PUT", "/api/manage/media/status", { auth_token: token }, { retentionDays: 30 }));
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, retentionDays: 30 });
    expect(setProfileConfig).toHaveBeenCalledWith("media_orphan_retention_days", "30");
    expect(insertAuditLog).toHaveBeenCalled();
  });

  it("orphans GET：分页切片与参数校验", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    // 分页参数非法
    let res = await ORPHANS_GET(makeRequest("GET", "/api/manage/media/orphans?page=0&pageSize=20", { auth_token: token }));
    expect(res.status).toBe(400);

    mockScanData();
    res = await ORPHANS_GET(makeRequest("GET", "/api/manage/media/orphans?page=1&pageSize=2", { auth_token: token }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.total).toBe(3);
    expect(body.items).toHaveLength(2);
    expect(body.retentionDays).toBe(7);
    // 排序：orphanDays 降序（30 天在前）
    expect(body.items[0].key).toBe("avatar_orphan_a.jpg");
    expect(body.items[0]).toMatchObject({ deletable: true, type: "avatar" });
    expect(body.items[1].key).toBe("avatar_orphan_a_thumb.jpg");
  });

  it("cleanup POST：items 校验、仅删可删孤儿、源图连带缩略图、审计", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    // items 为空 / 超 500
    let res = await CLEANUP_POST(makeRequest("POST", "/api/manage/media/orphans/cleanup", { auth_token: token }, { items: [] }));
    expect(res.status).toBe(400);
    res = await CLEANUP_POST(
      makeRequest("POST", "/api/manage/media/orphans/cleanup", { auth_token: token }, { items: Array.from({ length: 501 }, (_, i) => ({ key: `k${i}.jpg`, storageId: 1 })) })
    );
    expect(res.status).toBe(400);

    mockScanData();
    // 缩略图存在（连坐删除路径）
    fakeStorage.exists.mockResolvedValue(true);
    fakeStorage.delete.mockResolvedValue(undefined);
    res = await CLEANUP_POST(
      makeRequest("POST", "/api/manage/media/orphans/cleanup", { auth_token: token }, {
        items: [
          { key: "avatar_orphan_a.jpg", storageId: 1 }, // 可删 → 连带缩略图
          { key: "avatar_new_b.jpg", storageId: 1 }, // 未到期 → skip
          { key: "avatar_used.jpg", storageId: 1 }, // 被引用 → skip
          { key: "nope.jpg", storageId: 99 }, // 后端不符 → skip
        ],
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body).toMatchObject({ ok: true, deleted: 1, skipped: 3, deletedSizeBytes: 100 });
    // 连坐：源图删除 + 缩略图 exists 检查 + 缩略图删除
    expect(fakeStorage.delete).toHaveBeenCalledWith("avatar_orphan_a.jpg");
    expect(fakeStorage.exists).toHaveBeenCalledWith("avatar_orphan_a_thumb.jpg");
    expect(fakeStorage.delete).toHaveBeenCalledWith("avatar_orphan_a_thumb.jpg");
    // 审计 media:cleanup
    expect(insertAuditLog).toHaveBeenCalled();
  });
});
