import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// 隔离数据库层：本组用例只关注班级绑定口径（#160）
vi.mock("@/lib/db", () => ({
  getStudents: vi.fn(),
  insertUser: vi.fn(async () => 1),
  getUserByCode: vi.fn(),
  updateUser: vi.fn(async () => undefined),
  deleteStudents: vi.fn(),
  getClassByName: vi.fn(),
  insertAuditLog: vi.fn(async () => undefined),
}));

vi.mock("@/lib/auth", () => ({
  hashPassword: vi.fn(async () => "hashed"),
}));

vi.mock("@/lib/token", () => ({
  verifyToken: vi.fn(async () => ({ valid: false })),
  signToken: vi.fn(async () => "token"),
}));

import { POST } from "@/app/api/manage/students/route";
import { insertUser, updateUser, getUserByCode, getClassByName, insertAuditLog } from "@/lib/db";

const CLASS_ROW = { id: 7, name: "2025级1班", invitation_code: "abcd1234", created_at: "" };

function postRequest(body: unknown): NextRequest {
  return new NextRequest(new URL("/api/manage/students", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

/** 等待 void recordAudit(...) 的异步写入落到 mock 上 */
const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
});

describe("POST /api/manage/students — 单条添加绑定班级（#160）", () => {
  it("班级名命中 → 新建学生写入 class_id", async () => {
    vi.mocked(getClassByName).mockResolvedValue(CLASS_ROW as never);
    vi.mocked(getUserByCode).mockResolvedValue(undefined as never);

    const res = await POST(
      postRequest({ studentId: "202505050101", name: "张三", className: " 2025级1班 " })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unbound).toBe(false);
    expect(body.message).toBe("添加成功");
    expect(insertUser).toHaveBeenCalledWith(
      expect.objectContaining({
        user_code: "202505050101",
        role: "student",
        name: "张三",
        class_id: 7,
      })
    );
  });

  it("班级名未命中 → 仍创建学生但不绑定，响应与审计明确说明", async () => {
    vi.mocked(getClassByName).mockResolvedValue(undefined as never);
    vi.mocked(getUserByCode).mockResolvedValue(undefined as never);

    const res = await POST(
      postRequest({ studentId: "202505050102", name: "李四", className: "不存在的班级" })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.unbound).toBe(true);
    expect(body.message).toContain("未绑定班级");
    expect(vi.mocked(insertUser).mock.calls[0][0]).not.toHaveProperty("class_id");
    await flushAudit();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "student:create",
        metadata: expect.stringContaining('"unbound":true'),
      })
    );
  });

  it("学生已存在 + 班级名命中 → 同时更新姓名与班级", async () => {
    vi.mocked(getClassByName).mockResolvedValue(CLASS_ROW as never);
    vi.mocked(getUserByCode).mockResolvedValue({ id: 12, user_code: "202505050103" } as never);

    const res = await POST(
      postRequest({ studentId: "202505050103", name: "王五", className: "2025级1班" })
    );

    expect(res.status).toBe(200);
    expect(updateUser).toHaveBeenCalledWith(12, { name: "王五", class_id: 7 });
  });

  it("未提交班级名 → 不改动班级（保持既有行为）", async () => {
    vi.mocked(getUserByCode).mockResolvedValue(undefined as never);

    const res = await POST(
      postRequest({ studentId: "202505050104", name: "赵六", className: "" })
    );

    expect(res.status).toBe(200);
    expect(getClassByName).not.toHaveBeenCalled();
    expect(vi.mocked(insertUser).mock.calls[0][0]).not.toHaveProperty("class_id");
  });
});

describe("POST /api/manage/students — 批量导入口径回归（#160）", () => {
  it("命中与未命中混合 → 命中者写 class_id，未命中计数并提示", async () => {
    vi.mocked(getClassByName).mockImplementation(async (name: string) =>
      name === "2025级1班" ? (CLASS_ROW as never) : (undefined as never)
    );
    vi.mocked(getUserByCode).mockResolvedValue(undefined as never);

    const res = await POST(
      postRequest({
        students: [
          { studentId: "202505050201", name: "甲", className: "2025级1班" },
          { studentId: "202505050202", name: "乙", className: "幽灵班" },
        ],
      })
    );
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.message).toContain("导入 2 名学生");
    expect(body.message).toContain("1 条因班级不存在未绑定");
    expect(insertUser).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ user_code: "202505050201", class_id: 7 })
    );
    expect(vi.mocked(insertUser).mock.calls[1][0]).not.toHaveProperty("class_id");
  });
});
