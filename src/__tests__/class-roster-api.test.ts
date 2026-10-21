import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// 隔离数据层：锁定 #217 / #313 名册接口的筛选、响应形状与审计契约
vi.mock("@/lib/db", () => ({
  getClassRoster: vi.fn(),
  getClassRosterById: vi.fn(),
  getClassById: vi.fn(),
  // @/lib/audit 经 getUserById / insertAuditLog 使用
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { GET } from "@/app/api/manage/stats/class-roster/route";
import {
  getClassById,
  getClassRoster,
  getClassRosterById,
  getUserById,
  insertAuditLog,
} from "@/lib/db";
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

/** #313：按原始查询串构造请求（同时带 class / classId 时用来验证优先级） */
function createSearchRequest(search: string): NextRequest {
  return new NextRequest(new URL(`/api/manage/stats/class-roster${search}`, "http://localhost:3000"), {
    method: "GET",
  });
}

const ROWS: ClassRosterRow[] = [
  {
    name: "张三",
    user_code: "202301230156",
    submitted_at: "2026-10-18 09:30:00",
    tags: '["阅读","编程"]',
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserById).mockResolvedValue(undefined);
  vi.mocked(insertAuditLog).mockResolvedValue(undefined);
  vi.mocked(getClassById).mockResolvedValue({
    id: 5,
    name: "2025级3班",
    invitation_code: "INV-003",
    created_at: "2026-09-01 08:00:00",
  });
  vi.mocked(getClassRosterById).mockResolvedValue(ROWS);
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
        metadata: JSON.stringify({ className: "2025级1班", total: 2, submitted: 1, classId: null }),
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

describe("GET /api/manage/stats/class-roster — classId（#313）", () => {
  it("按 id 取名册：响应回显库里的真实班名，审计带 classId", async () => {
    const res = await GET(createSearchRequest("?classId=5"));
    expect(res.status).toBe(200);
    expect(getClassById).toHaveBeenCalledWith(5);
    expect(getClassRosterById).toHaveBeenCalledWith(5);
    expect(getClassRoster).not.toHaveBeenCalled();

    const body = await res.json();
    expect(body).toEqual({
      className: "2025级3班",
      total: 1,
      submitted: 1,
      students: [
        {
          name: "张三",
          userCode: "202301230156",
          submitted: true,
          submittedAt: "2026-10-18 09:30:00",
          tagCount: 2,
        },
      ],
    });
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "success",
        resource_id: "2025级3班",
        metadata: JSON.stringify({ className: "2025级3班", total: 1, submitted: 1, classId: 5 }),
      })
    );
  });

  it("classId 优先于 class：同时给出时忽略班名，不改名匹配", async () => {
    const res = await GET(createSearchRequest("?classId=5&class=" + encodeURIComponent("2025级1班")));
    expect(res.status).toBe(200);
    expect(getClassRosterById).toHaveBeenCalledWith(5);
    expect(getClassRoster).not.toHaveBeenCalled();
    expect((await res.json()).className).toBe("2025级3班");
  });

  it("非法 classId → 400 且不查库", async () => {
    for (const bad of ["0", "-1", "abc", "1.5"]) {
      const res = await GET(createSearchRequest(`?classId=${bad}`));
      expect(res.status, `classId=${bad} 应被拒`).toBe(400);
      expect(await res.json()).toEqual({ error: "classId 必须是正整数" });
    }
    expect(getClassById).not.toHaveBeenCalled();
    expect(getClassRosterById).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class:roster", status: "failed" })
    );
  });

  it("班级不存在 → 404（与参数非法区分）并记失败审计", async () => {
    vi.mocked(getClassById).mockResolvedValue(undefined);
    const res = await GET(createSearchRequest("?classId=404"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "班级不存在" });
    expect(getClassRosterById).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "failed",
        error_message: "班级不存在",
      })
    );
  });
});
