import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// 隔离数据层：锁定 #217 名册接口的筛选、响应形状与审计契约
vi.mock("@/lib/db", () => ({
  getClassRoster: vi.fn(),
  // @/lib/audit 经 getUserById / insertAuditLog 使用
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { GET } from "@/app/api/manage/stats/class-roster/route";
import { getClassRoster, getUserById, insertAuditLog } from "@/lib/db";
import type { ClassRosterRow } from "@/lib/db";

function createGetRequest(
  className?: string,
  cookies?: Record<string, string>
): NextRequest {
  const url = new URL("/api/manage/stats/class-roster", "http://localhost:3000");
  if (className !== undefined) url.searchParams.set("class", className);
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method: "GET",
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserById).mockResolvedValue(undefined);
  vi.mocked(insertAuditLog).mockResolvedValue(undefined);
});

describe("GET /api/manage/stats/class-roster — 班级名册（#217）", () => {
  it("缺 class 参数返回 400 并记失败审计", async () => {
    const res = await GET(createGetRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "请指定要查看的班级" });
    expect(getClassRoster).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class:roster", status: "failed" })
    );
  });

  it("按班名过滤并返回姓名/完整学号/状态/提交时间/标签数", async () => {
    vi.mocked(getClassRoster).mockResolvedValue([
      {
        name: "张三",
        user_code: "202301230156",
        submitted_at: "2026-10-18 09:30:00",
        tags: '["阅读","编程"]',
      },
      {
        name: "李四",
        user_code: "202301230157",
        submitted_at: null,
        tags: "not-json",
      },
    ] as ClassRosterRow[]);

    const res = await GET(createGetRequest("2025级1班"));
    expect(res.status).toBe(200);
    expect(getClassRoster).toHaveBeenCalledWith("2025级1班");

    const body = await res.json();
    expect(body).toEqual({
      className: "2025级1班",
      total: 2,
      submitted: 1,
      students: [
        {
          name: "张三",
          userCode: "202301230156",
          submitted: true,
          submittedAt: "2026-10-18 09:30:00",
          tagCount: 2,
        },
        {
          name: "李四",
          userCode: "202301230157",
          submitted: false,
          submittedAt: null,
          tagCount: 0,
        },
      ],
    });
    expect(JSON.stringify(body)).not.toContain("password_hash");
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "success",
        metadata: JSON.stringify({ className: "2025级1班", total: 2, submitted: 1 }),
      })
    );
  });

  it("数据层失败返回 500 并记失败审计", async () => {
    vi.mocked(getClassRoster).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(createGetRequest("一班"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "获取班级名册失败" });
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "failed",
        error_message: "db down",
      })
    );
  });
});
