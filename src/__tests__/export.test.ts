import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import JSZip from "jszip";

vi.mock("@/lib/db", () => ({
  getStudents: vi.fn(),
  getAllSubmitted: vi.fn(),
  getClasses: vi.fn(async () => []),
  getAssessmentByCode: vi.fn(async () => undefined),
  getCurrentAssessmentResultsByUserCodes: vi.fn(async () => []),
  getOnetOccupations: vi.fn(async () => []),
  insertAuditLog: vi.fn(),
}));

import { GET, POST } from "@/app/api/manage/export/route";
import {
  getStudents,
  getAllSubmitted,
  getClasses,
  getAssessmentByCode,
  getCurrentAssessmentResultsByUserCodes,
  getOnetOccupations,
} from "@/lib/db";

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
    evaluation_text: null,
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
    evaluation_text: null,
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
  it("三条他人评价按列输出，单行化并防公式注入（#162）", async () => {
    const withText = [
      {
        ...SUBMITTED[0],
        evaluation_text: JSON.stringify(["=SUM(1,1)\n第二行", "普通评价", ""]),
      },
    ];
    vi.mocked(getAllSubmitted).mockResolvedValue(withText as never);

    const res = await GET(
      createGetRequest(
        "/api/manage/export?format=csv&scope=all&columns=evaluation_text_1,evaluation_text_2,evaluation_text_3"
      )
    );
    const text = await res.text();
    expect(text).toContain('"他人评价1","他人评价2","他人评价3"');
    expect(text).toContain("\"'=SUM(1,1) 第二行\"");
    expect(text).toContain('"普通评价"');
  });

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

describe("GET /api/manage/export — 新增列（#233）", () => {
  /** 两个学生：一个分到班、一个未分班；一个已完测、一个未测 */
  const TWO_STUDENTS = [
    {
      id: 1, user_code: "S001", name: "学生甲", password_hash: "x", role: "student", class_id: 1,
      tags: JSON.stringify(["阅读"]), avatar_url: "/api/uploads/avatar_S001.jpg", evaluation_url: null,
      evaluation_text: null,
      submitted_at: "2026-08-20 10:00:00", created_at: "2026-08-01 10:00:00", storage_id: 1,
    },
    {
      id: 2, user_code: "S002", name: "学生乙", password_hash: "x", role: "student", class_id: null,
      tags: JSON.stringify(["编程"]), avatar_url: null, evaluation_url: null, evaluation_text: null, submitted_at: "2026-08-21 10:00:00",
      created_at: "2026-08-02 10:00:00", storage_id: 1,
    },
  ];

  const SCORES_JSON = JSON.stringify([
    { key: "R", label: "现实型", standard: 42.4 },
    { key: "I", label: "研究型", standard: 38 },
    { key: "A", label: "艺术型", standard: 20 },
    { key: "S", label: "社会型", standard: 74 },
    { key: "E", label: "企业型", standard: 31 },
    { key: "C", label: "常规型", standard: 25 },
  ]);

  beforeEach(() => {
    vi.mocked(getAllSubmitted).mockResolvedValue(TWO_STUDENTS as never);
    vi.mocked(getClasses).mockResolvedValue([{ id: 1, name: "2025级1班" }] as never);
    vi.mocked(getAssessmentByCode).mockResolvedValue({ id: 9, code: "riasec" } as never);
    vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([
      { user_code: "S002", type_code: "SIA", scores_json: SCORES_JSON, completed_at: "2026-09-01 10:00:00" },
    ] as never);
    vi.mocked(getOnetOccupations).mockResolvedValue([] as never);
  });

  it("班级列正确输出，未分班学生该格为空", async () => {
    const res = await GET(
      createGetRequest("/api/manage/export?format=csv&scope=all&columns=student_id,class_name,name")
    );
    const text = await res.text();
    // 列顺序按列定义（班级在基础组首位），与请求参数顺序无关
    expect(text.split("\n")[0]).toBe('"班级","学号","姓名"');
    expect(text).toContain('"2025级1班","S001","学生甲"');
    expect(text).toContain('"","S002","学生乙"');
  });

  it("未测评学生测评列留空（不出现 0 / undefined），已测学生输出状态与三字码", async () => {
    const res = await GET(
      createGetRequest(
        "/api/manage/export?format=csv&scope=all&columns=student_id,assessment_status,assessment_completed_at,assessment_code,assessment_scores"
      )
    );
    const text = await res.text();
    expect(text).toContain('"S001","未测","","",""');
    expect(text).toContain('"S002","已测","2026-09-01 10:00:00","SIA","R42 I38 A20 S74 E31 C25"');
    expect(text).not.toContain("undefined");
    expect(text).not.toContain('"S001","未测","0"');
  });

  it("六型得分「拆成六列」时表头与数据对齐", async () => {
    const res = await GET(
      createGetRequest(
        "/api/manage/export?format=csv&scope=all&columns=student_id,score_R,score_I,score_A,score_S,score_E,score_C"
      )
    );
    const text = await res.text();
    expect(text.split("\n")[0]).toBe('"学号","R 型得分","I 型得分","A 型得分","S 型得分","E 型得分","C 型得分"');
    expect(text).toContain('"S002","42","38","20","74","31","25"');
    expect(text).toContain('"S001","","","","","",""');
  });

  it("推荐职业 Top3 输出中文名并以分号分隔（职业库就绪时）", async () => {
    vi.mocked(getOnetOccupations).mockResolvedValue([
      {
        id: 1, code: "15-1252.00", name: "Software Developers", name_zh: "软件开发工程师",
        interest_code: "IC", interests_json: JSON.stringify({ R: 1, I: 7, A: 1, S: 1, E: 1, C: 5 }),
        job_zone: 4, education_level: "本科", cluster: "计算机与数学", dataset_version: "30.2", created_at: "",
      },
      {
        id: 2, code: "29-1141.00", name: "Registered Nurses", name_zh: "注册护士",
        interest_code: "SCI", interests_json: JSON.stringify({ R: 1, I: 4, A: 1, S: 7, E: 1, C: 4 }),
        job_zone: 4, education_level: "本科", cluster: "医疗健康", dataset_version: "30.2", created_at: "",
      },
    ] as never);
    const res = await GET(createGetRequest("/api/manage/export?format=csv&scope=all&columns=student_id,careers"));
    const text = await res.text();
    // S002 的画像 S 最高（74）→ 注册护士排第一
    expect(text).toContain('"S002","注册护士;软件开发工程师"');
    expect(text).toContain('"S001",""');
  });

  it("能力探测：职业库为空 → recommendations=false；有数据 → true", async () => {
    let res = await GET(createGetRequest("/api/manage/export?capabilities=1"));
    await expect(res.json()).resolves.toEqual({ recommendations: false });

    vi.mocked(getOnetOccupations).mockResolvedValue([{ id: 1, code: "15-1252.00" }] as never);
    res = await GET(createGetRequest("/api/manage/export?capabilities=1"));
    await expect(res.json()).resolves.toEqual({ recommendations: true });
  });

  it("能力探测：职业库读取失败按「未就绪」降级（200 + false，不用 500 打断面板）", async () => {
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.mocked(getOnetOccupations).mockRejectedValue(new Error("table missing") as never);
    const res = await GET(createGetRequest("/api/manage/export?capabilities=1"));
    expect(res.status).toBe(200);
    await expect(res.json()).resolves.toEqual({ recommendations: false });
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("CSV 单元格做引号转义（值里的双引号翻倍，不破坏列对齐）", async () => {
    vi.mocked(getAllSubmitted).mockResolvedValue([
      {
        ...TWO_STUDENTS[0],
        name: '他说"你好"',
      },
    ] as never);
    const res = await GET(
      createGetRequest("/api/manage/export?format=csv&scope=all&columns=student_id,name,class_name")
    );
    const text = await res.text();
    expect(text).toContain('"2025级1班","S001","他说""你好"""');
  });

  it("非「学生名单」范围不做整表名单读取（避免多余全表查询）", async () => {
    await GET(createGetRequest("/api/manage/export?format=csv&scope=all&columns=student_id"));
    expect(getStudents).not.toHaveBeenCalled();
  });

  it("默认列集合与 #233 之前一致（不因新增列改变默认导出）", async () => {
    const res = await GET(createGetRequest("/api/manage/export?format=csv&scope=all"));
    const header = (await res.text()).split("\n")[0];
    expect(header).toBe('"学号","姓名","标签","学生头像URL","评价词云图片URL（历史）","他人评价1","他人评价2","他人评价3","提交时间"');
    expect(header).not.toContain("班级");
    expect(header).not.toContain("测评");
  });

  it("xlsx 中班级名与测评列同样正确输出（班级 / 状态 / 三字码）", async () => {
    const res = await GET(
      createGetRequest(
        "/api/manage/export?format=xlsx&scope=all&columns=class_name,assessment_status,assessment_code"
      )
    );
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const shared = await zip.file("xl/sharedStrings.xml")?.async("text");
    expect(shared).toContain("班级");
    expect(shared).toContain("2025级1班");
    expect(shared).toContain("未测");
    expect(shared).toContain("已测");
    expect(shared).toContain("SIA");
  });

  it("插入班级列后，xlsx 内嵌图片仍锚定在头像列（in-cell 写成 B2 单元格图片）", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(TINY_PNG, { headers: { "content-type": "image/png" } }))
    );
    const res = await GET(
      createGetRequest("/api/manage/export?format=xlsx&scope=all&columns=class_name,avatar_url")
    );
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const sheet = await zip.file("xl/worksheets/sheet1.xml")?.async("text");
    expect(sheet).toMatch(/<c r="B2"[^>]*t="e"/);
  });

  it("插入班级列后，浮动图片锚点列下标随列变化（头像在第 2 列 → col=1）", async () => {
    vi.mocked(fetch).mockImplementation(() =>
      Promise.resolve(new Response(TINY_PNG, { headers: { "content-type": "image/png" } }))
    );
    const res = await GET(
      createGetRequest(
        "/api/manage/export?format=xlsx&scope=all&columns=class_name,avatar_url&imagePlacement=floating"
      )
    );
    expect(res.status).toBe(200);
    const zip = await JSZip.loadAsync(Buffer.from(await res.arrayBuffer()));
    const drawing = await zip.file("xl/drawings/drawing1.xml")?.async("text");
    expect(drawing).toContain("<xdr:col>1</xdr:col>");
  });

  it("预览接口按列定义返回表头与格式化值", async () => {
    const res = await POST(
      new NextRequest(new URL("/api/manage/export", "http://localhost:3000"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope: "all", columns: "student_id,class_name,assessment_status,score_S" }),
      })
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.columns).toEqual([
      { key: "class_name", header: "班级" },
      { key: "student_id", header: "学号" },
      { key: "assessment_status", header: "测评状态" },
      { key: "score_S", header: "S 型得分" },
    ]);
    expect(body.preview[0]).toEqual({ class_name: "2025级1班", student_id: "S001", assessment_status: "未测", score_S: "" });
    expect(body.preview[1]).toEqual({ class_name: "", student_id: "S002", assessment_status: "已测", score_S: "74" });
  });
});
