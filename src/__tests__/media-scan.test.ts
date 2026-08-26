import { describe, it, expect, vi, beforeEach } from "vitest";

// 假存储（vi.hoisted 供 mock 工厂引用）：listObjects 按后端 mock
const fakeStorage = vi.hoisted(() => ({
  listObjects: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  getAllReferencedMedia: vi.fn(),
  listStorageBackends: vi.fn(),
  getMediaOrphanRetentionDays: vi.fn(),
}));

vi.mock("@/lib/storage", () => ({
  getStorage: vi.fn(async () => fakeStorage),
}));

import { scanMedia } from "../lib/media-scan";
import { getAllReferencedMedia, listStorageBackends, getMediaOrphanRetentionDays } from "../lib/db";

/** N 天前的 ISO 时间 */
function daysAgo(days: number): string {
  return new Date(Date.now() - days * 86400000).toISOString();
}

describe("scanMedia（#117）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fakeStorage.listObjects.mockReset();
  });

  it("被引用不孤儿；未引用孤儿；类型与缩略图 sourceKey 判定正确", async () => {
    vi.mocked(getMediaOrphanRetentionDays).mockResolvedValue(7);
    // 引用：本地代理路径（剥前缀）+ 裸 key（云）+ 查询参数（规范化）+ 关联学生
    vi.mocked(getAllReferencedMedia).mockResolvedValue([
      { url: "/api/uploads/avatar_used_1.jpg", storageId: 1, userCode: "202505050101", userName: "张三" },
      { url: "evaluation_used_2.jpg?t=1", storageId: 2, userCode: "202505050102", userName: "李四" },
    ]);
    vi.mocked(listStorageBackends).mockResolvedValue([
      { id: 1, type: "local", name: "本地", is_default: 1 } as never,
      { id: 2, type: "s3", name: "云", is_default: 0 } as never,
    ]);
    fakeStorage.listObjects
      .mockResolvedValueOnce([
        { key: "avatar_used_1.jpg", size: 10, lastModified: daysAgo(1) }, // 被引用 → 不孤儿
        { key: "avatar_orphan_3.jpg", size: 20, lastModified: daysAgo(30) }, // 孤儿 avatar
        { key: "avatar_orphan_3_thumb.jpg", size: 5, lastModified: daysAgo(30) }, // 派生缩略图：不进入列表/孤儿
        { key: "legacy_1234.gif", size: 99, lastModified: daysAgo(60) }, // 旧格式 → other
      ])
      .mockResolvedValueOnce([
        { key: "evaluation_used_2.jpg", size: 10, lastModified: daysAgo(1) }, // 被引用（含参数规范化）
        { key: "evaluation_orphan_4.jpg", size: 30, lastModified: daysAgo(40) }, // 孤儿 evaluation
      ]);

    const { status, files, orphans } = await scanMedia();

    // total 为存储总览（含缩略图）；孤儿统计/列表不含缩略图（派生附属，#118）
    expect(status).toMatchObject({ total: 6, totalSize: 174, orphanCount: 3, orphanSize: 149 });
    // 全量文件列表：引用状态与关联学生（#117 全量管理），缩略图不出现
    const fileByKey = new Map(files.map((f) => [f.key, f]));
    expect(fileByKey.get("avatar_used_1.jpg")).toMatchObject({ referenced: true, userCode: "202505050101", userName: "张三" });
    expect(fileByKey.get("evaluation_used_2.jpg")).toMatchObject({ referenced: true, userCode: "202505050102", userName: "李四" });
    expect(fileByKey.get("avatar_orphan_3.jpg")).toMatchObject({ referenced: false, userCode: null, userName: null });
    expect(fileByKey.has("avatar_orphan_3_thumb.jpg")).toBe(false);
    expect(files).toHaveLength(5);
    // 孤儿明细：类型判定；缩略图不作为独立孤儿
    const byKey = new Map(orphans.map((o) => [o.key, o]));
    expect(byKey.get("avatar_orphan_3.jpg")).toMatchObject({ type: "avatar", sourceKey: null, storageId: 1 });
    expect(byKey.has("avatar_orphan_3_thumb.jpg")).toBe(false);
    expect(byKey.get("legacy_1234.gif")).toMatchObject({ type: "other", storageId: 1 });
    expect(byKey.get("evaluation_orphan_4.jpg")).toMatchObject({ type: "evaluation", storageId: 2 });
    // 排序：orphanDays 降序
    expect(orphans[0].key).toBe("legacy_1234.gif");
  });

  it("保留期：孤儿未到期 deletable=false，到期 deletable=true；统计分别计数", async () => {
    vi.mocked(getMediaOrphanRetentionDays).mockResolvedValue(7);
    vi.mocked(getAllReferencedMedia).mockResolvedValue([]);
    vi.mocked(listStorageBackends).mockResolvedValue([{ id: 1, type: "local", name: "本地", is_default: 1 } as never]);
    fakeStorage.listObjects.mockResolvedValueOnce([
      { key: "avatar_new_1.jpg", size: 10, lastModified: daysAgo(2) }, // 未到期
      { key: "avatar_old_2.jpg", size: 20, lastModified: daysAgo(8) }, // 已到期
    ]);

    const { status, orphans } = await scanMedia();
    expect(status).toMatchObject({ orphanCount: 2, deletableCount: 1, deletableSize: 20, retentionDays: 7 });
    expect(orphans.find((o) => o.key === "avatar_new_1.jpg")).toMatchObject({ orphanDays: 2, deletable: false });
    expect(orphans.find((o) => o.key === "avatar_old_2.jpg")).toMatchObject({ orphanDays: 8, deletable: true });
  });

  it("多后端隔离：同一 key 在后端 2 未被引用仍判孤儿", async () => {
    vi.mocked(getMediaOrphanRetentionDays).mockResolvedValue(7);
    // 引用只属于后端 1
    vi.mocked(getAllReferencedMedia).mockResolvedValue([{ url: "avatar_same.jpg", storageId: 1 }]);
    vi.mocked(listStorageBackends).mockResolvedValue([
      { id: 1, type: "local", name: "本地", is_default: 1 } as never,
      { id: 2, type: "s3", name: "云", is_default: 0 } as never,
    ]);
    fakeStorage.listObjects
      .mockResolvedValueOnce([{ key: "avatar_same.jpg", size: 10, lastModified: daysAgo(30) }])
      .mockResolvedValueOnce([{ key: "avatar_same.jpg", size: 10, lastModified: daysAgo(30) }]);

    const { status, orphans } = await scanMedia();
    expect(status.orphanCount).toBe(1);
    expect(orphans[0]).toMatchObject({ key: "avatar_same.jpg", storageId: 2 });
  });
});
