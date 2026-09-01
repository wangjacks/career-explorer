import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库与海报渲染：本测试只关注路由层的权限、参数、缓存和审计行为
vi.mock("@/lib/db", () => ({
  getClasses: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

vi.mock("@/lib/invite-poster", () => ({
  generateInvitePoster: vi.fn(),
}));

import { GET } from "@/app/api/manage/classes/[id]/poster/route";
import { getClasses, getTeacherClassPairs, getUserById, insertAuditLog } from "@/lib/db";
import { generateInvitePoster } from "@/lib/invite-poster";
import type { ClassRow, TeacherClassRow, UserRow } from "@/lib/db";

const PNG_SIGNATURE = "89504e470d0a1a0a";
const PNG_BUFFER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

const ADMIN_USER: UserRow = {
  id: 1,
  user_code: "10001",
  password_hash: "hash",
  role: "admin",
  name: "管理员",
  class_id: null,
  tags: null,
  avatar_url: null,
  evaluation_url: null,
  submitted_at: null,
  created_at: "",
  storage_id: 1,
};

const TEACHER_USER: UserRow = {
  ...ADMIN_USER,
  id: 3,
  user_code: "20260001",
  role: "teacher",
  name: "测试教师",
};

function classRow(overrides: Partial<ClassRow> = {}): ClassRow {
  return {
    id: 1,
    name: "2026级1班",
    invitation_code: "AB23XYZ9",
    created_at: "",
    ...overrides,
  };
}

function pairRow(overrides: Partial<TeacherClassRow> = {}): TeacherClassRow {
  return {
    id: 1,
    teacher_id: 3,
    class_id: 1,
    created_at: "",
    ...overrides,
  };
}

function createGetRequest(id: string, token?: string, download = false): NextRequest {
  const url = new URL(`/api/manage/classes/${id}/poster`, "http://localhost:3000");
  if (download) url.searchParams.set("download", "1");
  return new NextRequest(url, {
    method: "GET",
    headers: token ? { cookie: `auth_token=${token}` } : {},
  });
}

function createContext(id: string) {
  return { params: Promise.resolve({ id }) };
}

async function tokens() {
  return {
    admin: await signToken({ role: "admin", uid: 1, name: "管理员" }),
    teacher: await signToken({ role: "teacher", uid: 3, name: "测试教师" }),
    student: await signToken({ role: "student", uid: 7, name: "测试学生" }),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://career.example.com");
  vi.mocked(generateInvitePoster).mockResolvedValue(PNG_BUFFER);
  vi.mocked(getClasses).mockResolvedValue([classRow()]);
  vi.mocked(getTeacherClassPairs).mockResolvedValue([pairRow()]);
  vi.mocked(getUserById).mockResolvedValue(ADMIN_USER);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("GET /api/manage/classes/[id]/poster — 权限与参数", () => {
  it("未登录 → 401，且不生成海报", async () => {
    const res = await GET(createGetRequest("1"), createContext("1"));
    expect(res.status).toBe(401);
    expect(generateInvitePoster).not.toHaveBeenCalled();
  });

  it("学生 → 403，且不生成海报", async () => {
    const t = await tokens();
    vi.mocked(getUserById).mockResolvedValue({ ...ADMIN_USER, id: 7, role: "student", name: "测试学生" });
    const res = await GET(createGetRequest("1", t.student), createContext("1"));
    expect(res.status).toBe(403);
    expect(generateInvitePoster).not.toHaveBeenCalled();
  });

  it("教师访问非自己创建的班级 → 403，且不生成海报", async () => {
    const t = await tokens();
    vi.mocked(getUserById).mockResolvedValue(TEACHER_USER);
    vi.mocked(getTeacherClassPairs).mockResolvedValue([pairRow({ class_id: 2 })]);
    const res = await GET(createGetRequest("1", t.teacher), createContext("1"));
    expect(res.status).toBe(403);
    expect(generateInvitePoster).not.toHaveBeenCalled();
  });

  it("班级不存在 → 404", async () => {
    const t = await tokens();
    vi.mocked(getClasses).mockResolvedValue([]);
    const res = await GET(createGetRequest("99", t.admin), createContext("99"));
    expect(res.status).toBe(404);
    expect(generateInvitePoster).not.toHaveBeenCalled();
  });

  it("非法班级 ID → 400", async () => {
    const t = await tokens();
    const res = await GET(createGetRequest("abc", t.admin), createContext("abc"));
    expect(res.status).toBe(400);
    expect(generateInvitePoster).not.toHaveBeenCalled();
  });
});

describe("GET /api/manage/classes/[id]/poster — 生成与缓存", () => {
  it("admin 生成成功 → 200 PNG，并使用当前班级邀请码", async () => {
    const t = await tokens();
    const res = await GET(createGetRequest("1", t.admin), createContext("1"));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
    expect(res.headers.get("Content-Type")).toBe("image/png");
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(res.headers.get("Content-Disposition")).toBe("inline");
    expect(generateInvitePoster).toHaveBeenCalledWith({
      className: "2026级1班",
      inviteCode: "AB23XYZ9",
      baseUrl: "https://career.example.com",
    });
  });

  it("教师访问自己创建的班级 → 200 PNG", async () => {
    const t = await tokens();
    vi.mocked(getUserById).mockResolvedValue(TEACHER_USER);
    const res = await GET(createGetRequest("1", t.teacher), createContext("1"));
    expect(res.status).toBe(200);
    expect(Buffer.from(await res.arrayBuffer()).subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
  });

  it("邀请码更新后 → 后续海报使用新邀请码，且响应禁止缓存", async () => {
    const t = await tokens();
    vi.mocked(getClasses).mockResolvedValueOnce([classRow({ invitation_code: "OLD12345" })]);
    await GET(createGetRequest("1", t.admin), createContext("1"));

    vi.mocked(getClasses).mockResolvedValueOnce([classRow({ invitation_code: "NEW67890" })]);
    const res = await GET(createGetRequest("1", t.admin), createContext("1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("no-store");
    expect(vi.mocked(generateInvitePoster).mock.calls[1][0]).toMatchObject({
      inviteCode: "NEW67890",
    });
  });

  it("download=1 → 返回附件下载头", async () => {
    const t = await tokens();
    const res = await GET(createGetRequest("1", t.admin, true), createContext("1"));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Disposition")).toBe(
      `attachment; filename*=UTF-8''${encodeURIComponent("邀请海报-2026级1班.png")}`
    );
  });
});

describe("GET /api/manage/classes/[id]/poster — 审计", () => {
  it("成功生成 → 记录 class:poster 审计", async () => {
    const t = await tokens();
    await GET(createGetRequest("1", t.admin), createContext("1"));
    expect(insertAuditLog).toHaveBeenCalled();
    const log = vi.mocked(insertAuditLog).mock.calls[0][0];
    expect(log.action).toBe("class:poster");
    expect(log.status).toBe("success");
    expect(log.resource_type).toBe("class");
    expect(log.resource_id).toBe("1");
  });

  it("下载请求 → 审计 metadata 记录 download=true", async () => {
    const t = await tokens();
    await GET(createGetRequest("1", t.admin, true), createContext("1"));
    const log = vi.mocked(insertAuditLog).mock.calls[0][0];
    expect(log.metadata).toBe(JSON.stringify({ download: true }));
  });
});