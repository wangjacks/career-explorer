import { describe, it, expect, vi, beforeEach } from "vitest";

// 隔离数据库层：本用例只锁定开放端点的响应契约（标签树 + 各项上限与截止状态）
vi.mock("@/lib/db", () => ({
  getActiveTags: vi.fn(),
  getMaxCustomTags: vi.fn(),
  getSubmissionDeadline: vi.fn(),
  isSubmissionClosed: vi.fn(),
  getMaxAvatarSizeMb: vi.fn(),
  getMaxEvaluationSizeMb: vi.fn(),
}));

import { GET } from "@/app/api/tags/route";
import {
  getActiveTags,
  getMaxAvatarSizeMb,
  getMaxCustomTags,
  getMaxEvaluationSizeMb,
  getSubmissionDeadline,
  isSubmissionClosed,
} from "@/lib/db";
import type { TagRow } from "@/lib/db";

/** 分类 + 其下两个标签，用于确认响应仍是「分类嵌套标签」的树形结构 */
const TAG_ROWS = [
  { id: 1, name: "兴趣", type: "category", parent_id: null, class_id: 0, category_order: 0, sort_order: 0, active: 1 },
  { id: 2, name: "音乐", type: "tag", parent_id: 1, class_id: 0, category_order: 0, sort_order: 1, active: 1 },
  { id: 3, name: "摄影", type: "tag", parent_id: 1, class_id: 0, category_order: 0, sort_order: 2, active: 1 },
] as unknown as TagRow[];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getActiveTags).mockResolvedValue(TAG_ROWS);
  vi.mocked(getMaxCustomTags).mockResolvedValue(6);
  vi.mocked(getSubmissionDeadline).mockResolvedValue(null);
  vi.mocked(isSubmissionClosed).mockResolvedValue(false);
  vi.mocked(getMaxAvatarSizeMb).mockResolvedValue(5);
  vi.mocked(getMaxEvaluationSizeMb).mockResolvedValue(10);
});

describe("GET /api/tags", () => {
  it("返回分类树与各项配置上限（#206 起含图片体积上限）", async () => {
    const res = await GET();
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.categories).toEqual([
      {
        id: 1,
        name: "兴趣",
        sortOrder: 0,
        tags: [
          { id: 2, name: "音乐", sortOrder: 1 },
          { id: 3, name: "摄影", sortOrder: 2 },
        ],
      },
    ]);
    expect(body.maxCustomTags).toBe(6);
    expect(body.submissionDeadline).toBeNull();
    expect(body.submissionClosed).toBe(false);
    // 选图前体积预检的配置来源：字段名与 configs_profile 的键（max_avatar_size_mb / max_evaluation_size_mb）一一对应
    expect(body.maxAvatarSizeMb).toBe(5);
    expect(body.maxEvaluationSizeMb).toBe(10);
  });

  it("配置读取失败时返回 500 且不泄露内部错误", async () => {
    vi.mocked(getMaxEvaluationSizeMb).mockRejectedValue(new Error("db down"));
    const res = await GET();
    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body.error).toBe("获取标签失败");
    expect(JSON.stringify(body)).not.toContain("db down");
  });
});
