import { describe, it, expect, vi } from "vitest";

// 路由链会加载 audit 的 DB 依赖；一并 mock，避免新增引用时测试意外失败
vi.mock("@/lib/db", () => ({
  getTeachers: vi.fn(),
  getUserByCode: vi.fn(),
  insertUser: vi.fn(),
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { GET } from "@/app/api/manage/teachers/route";
import { getTeachers } from "@/lib/db";
import type { UserRow } from "@/lib/db";

const TEACHER: UserRow = {
  id: 8,
  user_code: "20250001",
  password_hash: "bcrypt-hash-should-never-leak",
  role: "teacher",
  name: "测试教师",
  class_id: null,
  tags: null,
  avatar_url: null,
  evaluation_url: null,
  evaluation_text: null,
  submitted_at: null,
  created_at: "2026-09-01 09:00:00",
  storage_id: 1,
};

describe("GET /api/manage/teachers — 用户列表投影（#358）", () => {
  it("只返回编号/姓名/创建时间，不泄露 password_hash", async () => {
    vi.mocked(getTeachers).mockResolvedValue([TEACHER]);

    const res = await GET();
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body).toStrictEqual({
      data: [
        {
          id: 8,
          user_code: "20250001",
          name: "测试教师",
          created_at: "2026-09-01 09:00:00",
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("password_hash");
  });
});
