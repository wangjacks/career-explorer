import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import JSZip from "jszip";

vi.mock("@/lib/db", () => ({
  getStudents: vi.fn(),
  getAllSubmitted: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { GET } from "@/app/api/manage/export/route";
import { getStudents, getAllSubmitted } from "@/lib/db";

const TINY_PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
  "base64"
);

function createGetRequest(path: string): NextRequest {
  return new NextRequest(new URL(path, "http://localhost:3000"));
}

const STUDENTS = [
  {
    id: 1,
    user_code: "S001",
    name: "学生甲",
    password_hash: "x",
    role: "student",
    class_id: 1,
    tags: null,
    avatar_url: null,
    evaluation_url: null,
    submitted_at: null,
    created_at: "2026-08-01 10:00:00",
  },
];

const SUBMITTED = [
  {
    id: 1,
    user_code: "S001",
    name: "学生甲",
    password_hash: "x",
    role: "student",
    class_id: 1,
    tags: JSON.stringify(["阅读", "编程"]),
    avatar_url: "/api/uploads/avatar_S001.jpg",
    evaluation_url: "/api/uploads/eval_S001.jpg",
    submitted_at: "2026-08-20 10:00:00",
    created_at: "2026-08-01 10:00:00",
  },
];

beforeEach(() => {
  vi.clearAllMocks();
  vi.stubGlobal("fetch", vi.fn());
  vi.mocked(getStudents).mockResolvedValue(STUDENTS as never);
  vi.mocked(getAllSubmitted).mockResolvedValue(SUBMITTED as never);
});

describe("GET /api/manage/export — 参数校验与安全（#97）", () => {
  it("非法 imagePlacement → 400", async () => {
    const res = await GET(createGetRequest("/api/manage/export?format=xlsx&imagePlacement=bogus"));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("图片放置方式");
  });

  it("CSV 携带 imagePlacement → 400", async () => {
    const res = await GET(createGetRequest("/api/manage/export?format=csv&imagePlacement=in-cell"));
    expect(res.status).toBe(400);
  });

  it("rowHeight 超出范围 → 400", async () => {
    for (const value of ["5", "201", "abc"]) {
      const res = await GET(createGetRequest(`/api/manage/export?format=xlsx&rowHeight=${value}`));
      expect(res.status).toBe(400);
    }
  });

  it("不支持的文件格式 → 400", async () => {
    const res = await GET(createGetRequest("/api/manage/export?format=pdf"));
    expect(res.status).toBe(400);
  });
});

describe("GET /api/manage/export — CSV", () => {
  it("CSV 继续输出图片 URL，且不含服务器路径或凭据", async () => {
    const res = await GET(createGetRequest("/api/manage/export?format=csv&scope=all"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/csv");
    const text = await res.text();
    expect(text).toContain("/api/uploads/avatar_S001.jpg");
    expect(text).toContain("/api/uploads/eval_S001.jpg");
    expect(text).toContain("学生头像URL");
    expect(text).not.toContain("uploads\\");
    expect(text).not.toContain("SecretKey");
    expect(text).not.toContain("AccessKey");
  });
});

describe("GET /api/manage/export — XLSX 双模式", () => {
  it("in-cell 为默认模式，生成单元格图片结构与数据行高度", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(TINY_PNG, { headers: { "content-type": "image/png" } }))
    );
    const res = await GET(createGetRequest("/api/manage/export?format=xlsx&scope=all"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("officedocument.spreadsheetml.sheet");
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("text");
    expect(sheet).toContain('t="e"');
    expect(sheet).toContain('vm="1"');
    expect(sheet).toContain('ht="45"');
    expect(zip.file("xl/metadata.xml")).toBeTruthy();
    expect(zip.file("xl/richData/rdrichvalue.xml")).toBeTruthy();
    expect(zip.file("xl/richData/_rels/richValueRel.xml.rels")).toBeTruthy();
  });

  it("floating 模式不生成单元格图片结构，返回有效 XLSX", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(TINY_PNG, { headers: { "content-type": "image/png" } }))
    );
    const res = await GET(createGetRequest("/api/manage/export?format=xlsx&scope=all&imagePlacement=floating"));
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("text");
    expect(sheet).not.toContain('t="e"');
    expect(sheet).toContain('ht="45"');
  });
});

describe("GET /api/manage/export — 异常容错", () => {
  it("图片缺失/读取失败时导出仍成功，不生成错误引用", async () => {
    vi.mocked(fetch).mockResolvedValue(new Response("", { status: 404 }));
    const res = await GET(createGetRequest("/api/manage/export?format=xlsx&scope=all"));
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("text");
    // 图片不可用时不把单元格写成 rich value，也不生成错误引用
    expect(sheet).not.toContain('t="e"');
    expect(sheet).not.toContain('vm=');
  });

  it("对象存储 URL（绝对地址）可正常参与导出", async () => {
    const withExternal = SUBMITTED.map((row) => ({
      ...row,
      avatar_url: "https://cdn.example.com/avatar_S001.png",
    }));
    vi.mocked(getAllSubmitted).mockResolvedValue(withExternal as never);
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(TINY_PNG, { headers: { "content-type": "image/png" } }))
    );
    const res = await GET(createGetRequest("/api/manage/export?format=xlsx&scope=all"));
    expect(res.status).toBe(200);
  });
});
