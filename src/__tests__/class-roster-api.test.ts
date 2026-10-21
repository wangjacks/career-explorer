import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// 隔离数据层：锁定 #217/#260 名册接口的分组键解析、响应形状与审计契约
vi.mock("@/lib/db", () => ({
  getClassByName: vi.fn(),
  getClassRoster: vi.fn(),
  // @/lib/audit 经 getUserById / insertAuditLog 使用
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { GET } from "@/app/api/manage/stats/class-roster/route";
import { getClassByName, getClassRoster, getUserById, insertAuditLog } from "@/lib/db";
import type { ClassRosterRow } from "@/lib/db";

function createGetRequest(
  classKey?: string,
  cookies?: Record<string, string>
): NextRequest {
  const url = new URL("/api/manage/stats/class-roster", "http://localhost:3000");
  if (classKey !== undefined) url.searchParams.set("class", classKey);
  const cookieHeader = cookies
    ? Object.entries(cookies).map(([k, v]) => `${k}=${v}`).join("; ")
    : "";
  return new NextRequest(url, {
    method: "GET",
    headers: cookieHeader ? { cookie: cookieHeader } : {},
  });
}

const ROWS: ClassRosterRow[] = [
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
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserById).mockResolvedValue(undefined);
  vi.mocked(insertAuditLog).mockResolvedValue(undefined);
});

describe("GET /api/manage/stats/class-roster — 班级名册（#217/#260）", () => {
  it("缺 class 参数返回 400 并记失败审计", async () => {
    const res = await GET(createGetRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "请指定要查看的班级" });
    expect(getClassByName).not.toHaveBeenCalled();
    expect(getClassRoster).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class:roster", status: "failed" })
    );
  });

  it("班名先解析成 class_id，再按班级身份取名册", async () => {
    vi.mocked(getClassByName).mockResolvedValue({ id: 7, name: "2025级1班" } as never);
    vi.mocked(getClassRoster).mockResolvedValue(ROWS);

    const res = await GET(createGetRequest("2025级1班"));
    expect(res.status).toBe(200);
    expect(getClassByName).toHaveBeenCalledWith("2025级1班");
    expect(getClassRoster).toHaveBeenCalledWith(7);

    const body = await res.json();
    expect(body).toEqual({
      classKey: "2025级1班",
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
        resource_id: "2025级1班",
        metadata: JSON.stringify({
          classKey: "2025级1班",
          className: "2025级1班",
          classId: 7,
          total: 2,
          submitted: 1,
        }),
      })
    );
  });

  it("哨兵键直接取未分班名册，不查班级表", async () => {
    vi.mocked(getClassRoster).mockResolvedValue([ROWS[0]]);

    const res = await GET(createGetRequest("__unassigned__"));
    expect(res.status).toBe(200);
    expect(getClassByName).not.toHaveBeenCalled();
    expect(getClassRoster).toHaveBeenCalledWith(null);

    const body = await res.json();
    expect(body.classKey).toBe("__unassigned__");
    expect(body.className).toBe("未分班");
    expect(body.total).toBe(1);
  });

  it("真实班名「未分班」按班级 id 取名册，不被当成未分班哨兵", async () => {
    vi.mocked(getClassByName).mockResolvedValue({ id: 3, name: "未分班" } as never);
    vi.mocked(getClassRoster).mockResolvedValue([ROWS[1]]);

    const res = await GET(createGetRequest("未分班"));
    expect(res.status).toBe(200);
    expect(getClassByName).toHaveBeenCalledWith("未分班");
    expect(getClassRoster).toHaveBeenCalledWith(3);

    const body = await res.json();
    expect(body).toMatchObject({ classKey: "未分班", className: "未分班", total: 1 });
  });

  it("未知或已改名的班级返回 404，不查名册", async () => {
    vi.mocked(getClassByName).mockResolvedValue(undefined as never);

    const res = await GET(createGetRequest("不存在的班"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "班级不存在或已改名" });
    expect(getClassRoster).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "failed",
        resource_id: "不存在的班",
        error_message: "班级不存在或已改名",
      })
    );
  });

  it("超过 80 字符返回 400，不查班级表", async () => {
    const res = await GET(createGetRequest("班".repeat(81)));
    expect(res.status).toBe(400);
    expect(getClassByName).not.toHaveBeenCalled();
    expect(getClassRoster).not.toHaveBeenCalled();
  });

  it("数据层失败返回 500 并记失败审计", async () => {
    vi.mocked(getClassByName).mockResolvedValue({ id: 1, name: "一班" } as never);
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
