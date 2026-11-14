import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";

// 隔离数据层：锁定 #217/#260/#374 名册接口的分组键解析、响应形状与审计契约，#313 的 classId 通道
vi.mock("@/lib/db", () => ({
  getClassById: vi.fn(),
  getClassRoster: vi.fn(),
  // @/lib/audit 经 getUserById / insertAuditLog 使用
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { GET } from "@/app/api/manage/stats/class-roster/route";
import { getClassById, getClassRoster, getUserById, insertAuditLog } from "@/lib/db";
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
  {
    name: "李四",
    user_code: "202301230157",
    submitted_at: null,
    tags: "not-json",
  },
];

const CLASS_5 = {
  id: 5,
  name: "2025级3班",
  invitation_code: "INV-003",
  created_at: "2026-09-01 08:00:00",
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getUserById).mockResolvedValue(undefined);
  vi.mocked(insertAuditLog).mockResolvedValue(undefined);
  vi.mocked(getClassById).mockResolvedValue(CLASS_5);
  vi.mocked(getClassRoster).mockResolvedValue([]);
});

describe("GET /api/manage/stats/class-roster — 班级名册（#217/#260/#374）", () => {
  it("缺 class 参数返回 400 并记失败审计", async () => {
    const res = await GET(createGetRequest());
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "请指定要查看的班级" });
    expect(getClassById).not.toHaveBeenCalled();
    expect(getClassRoster).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class:roster", status: "failed" })
    );
  });

  it("class 传内部 id 键：按 class_id 取名册，响应回显 classKey 与班名", async () => {
    vi.mocked(getClassRoster).mockResolvedValue(ROWS);

    const res = await GET(createGetRequest("5"));
    expect(res.status).toBe(200);
    expect(getClassById).toHaveBeenCalledWith(5);
    expect(getClassRoster).toHaveBeenCalledWith(5);

    const body = await res.json();
    expect(body).toEqual({
      classKey: "5",
      className: "2025级3班",
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
        resource_id: "5",
        metadata: JSON.stringify({
          classKey: "5",
          className: "2025级3班",
          classId: 5,
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
    expect(getClassById).not.toHaveBeenCalled();
    expect(getClassRoster).toHaveBeenCalledWith(null);

    const body = await res.json();
    expect(body.classKey).toBe("__unassigned__");
    expect(body.className).toBe("未分班");
    expect(body.total).toBe(1);
  });

  it("旧班名不再是身份：400 且不查库，并记失败审计", async () => {
    const res = await GET(createGetRequest("2025级1班"));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "class 必须是班级 id 或 __unassigned__" });
    expect(getClassById).not.toHaveBeenCalled();
    expect(getClassRoster).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "failed",
        resource_id: "2025级1班",
        error_message: "class 必须是班级 id 或 __unassigned__",
      })
    );
  });

  it("非规范 id 串一律 400，且不查库", async () => {
    for (const bad of ["0", "-1", "abc", "1.5", "007", "1e3"]) {
      const res = await GET(createGetRequest(bad));
      expect(res.status, `class=${bad} 应被拒`).toBe(400);
      expect(await res.json()).toEqual({ error: "class 必须是班级 id 或 __unassigned__" });
    }
    expect(getClassById).not.toHaveBeenCalled();
    expect(getClassRoster).not.toHaveBeenCalled();
  });

  it("超长 class 键是畸形请求：400 且审计里不落原始长串", async () => {
    const longKey = "9".repeat(40);
    const res = await GET(createGetRequest(longKey));
    expect(res.status).toBe(400);

    const calls = vi.mocked(insertAuditLog).mock.calls;
    const audit = calls[calls.length - 1]?.[0];
    expect(String(audit?.resource_id ?? "")).not.toContain(longKey);
    expect(String(audit?.metadata ?? "")).not.toContain(longKey);
  });

  it("class 指向不存在的班级：404 且不查名册", async () => {
    vi.mocked(getClassById).mockResolvedValue(undefined);

    const res = await GET(createGetRequest("999"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "班级不存在" });
    expect(getClassRoster).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "failed",
        resource_id: "999",
        error_message: "班级不存在",
        metadata: JSON.stringify({ classId: 999, classKey: "999" }),
      })
    );
  });

  it("真实班名「未分班」不再有身份特殊性：仍按 class_id 取名册", async () => {
    vi.mocked(getClassById).mockResolvedValue({
      id: 3,
      name: "未分班",
      invitation_code: "INV-003",
      created_at: "2026-09-01 08:00:00",
    });
    vi.mocked(getClassRoster).mockResolvedValue([ROWS[1]]);

    const res = await GET(createGetRequest("3"));
    expect(res.status).toBe(200);
    expect(getClassById).toHaveBeenCalledWith(3);
    expect(getClassRoster).toHaveBeenCalledWith(3);
    expect(await res.json()).toMatchObject({
      classKey: "3",
      className: "未分班",
      total: 1,
    });
  });

  it("两个同名班可由 class 键区分，分别取各自名册", async () => {
    vi.mocked(getClassById).mockImplementation(async (id) => ({
      id,
      name: "同名班",
      invitation_code: `INV-${id}`,
      created_at: "2026-09-01 08:00:00",
    }));
    vi.mocked(getClassRoster).mockImplementation(async (classId) =>
      classId === 3 ? [ROWS[0]] : [ROWS[1]]
    );

    const first = await GET(createGetRequest("3"));
    const second = await GET(createGetRequest("4"));
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await first.json()).toMatchObject({ classKey: "3", className: "同名班", total: 1 });
    expect(await second.json()).toMatchObject({ classKey: "4", className: "同名班", total: 1 });
    expect(getClassRoster).toHaveBeenNthCalledWith(1, 3);
    expect(getClassRoster).toHaveBeenNthCalledWith(2, 4);
  });

  it("数据层失败返回 500 并记失败审计", async () => {
    vi.mocked(getClassRoster).mockRejectedValue(new Error("db down"));
    vi.spyOn(console, "error").mockImplementation(() => {});

    const res = await GET(createGetRequest("5"));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: "获取班级名册失败" });
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "failed",
        resource_id: "5",
        error_message: "db down",
        metadata: JSON.stringify({ classKey: "5", classId: 5 }),
      })
    );
  });
});

describe("GET /api/manage/stats/class-roster — classId（#313）", () => {
  it("按 id 取名册：响应 classKey 是 id 串，className 回显班名", async () => {
    vi.mocked(getClassRoster).mockResolvedValue(ROWS);

    const res = await GET(createSearchRequest("?classId=5"));
    expect(res.status).toBe(200);
    expect(getClassById).toHaveBeenCalledWith(5);
    expect(getClassRoster).toHaveBeenCalledWith(5);

    const body = await res.json();
    expect(body).toMatchObject({
      classKey: "5",
      className: "2025级3班",
      total: 2,
      submitted: 1,
    });
    expect(body.students[1]).toEqual({
      name: "李四",
      userCode: "202301230157",
      submitted: false,
      submittedAt: null,
      tagCount: 0,
    });
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "success",
        resource_id: "5",
        metadata: JSON.stringify({
          classKey: "5",
          className: "2025级3班",
          classId: 5,
          total: 2,
          submitted: 1,
        }),
      })
    );
  });

  it("classId 优先于 class：同时给出时忽略 class，不按班名解析", async () => {
    vi.mocked(getClassRoster).mockResolvedValue([ROWS[0]]);

    const res = await GET(createSearchRequest("?classId=5&class=" + encodeURIComponent("2025级1班")));
    expect(res.status).toBe(200);
    expect(getClassById).toHaveBeenCalledWith(5);
    expect(getClassRoster).toHaveBeenCalledWith(5);
    expect((await res.json()).className).toBe("2025级3班");
  });

  it("classId 为空串时回落到 class 键", async () => {
    const res = await GET(createSearchRequest("?classId=&class=5"));
    expect(res.status).toBe(200);
    expect(getClassById).toHaveBeenCalledWith(5);
  });

  it("非法 classId → 400 且不查库", async () => {
    for (const bad of ["0", "-1", "abc", "1.5", "007", "1e3"]) {
      const res = await GET(createSearchRequest(`?classId=${bad}`));
      expect(res.status, `classId=${bad} 应被拒`).toBe(400);
      expect(await res.json()).toEqual({ error: "classId 必须是正整数" });
    }
    expect(getClassById).not.toHaveBeenCalled();
    expect(getClassRoster).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "class:roster", status: "failed" })
    );
  });

  it("超长 classId 是畸形请求：400 且审计里不落原始长串", async () => {
    const longId = "9".repeat(40);
    const res = await GET(createSearchRequest(`?classId=${longId}`));
    expect(res.status).toBe(400);

    const calls = vi.mocked(insertAuditLog).mock.calls;
    const audit = calls[calls.length - 1]?.[0];
    expect(String(audit?.resource_id ?? "")).not.toContain(longId);
    expect(String(audit?.metadata ?? "")).not.toContain(longId);
  });

  it("班级不存在 → 404（与参数非法区分）并记失败审计", async () => {
    vi.mocked(getClassById).mockResolvedValue(undefined);

    const res = await GET(createSearchRequest("?classId=404"));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: "班级不存在" });
    expect(getClassRoster).not.toHaveBeenCalled();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "class:roster",
        status: "failed",
        resource_id: "404",
        error_message: "班级不存在",
        metadata: JSON.stringify({ classId: 404, classKey: "404" }),
      })
    );
  });
});
