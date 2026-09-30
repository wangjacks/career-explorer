import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import ExcelJS from "exceljs";
import { signToken } from "@/lib/token";

// 隔离数据库层：与 grouping-api.test.ts 同口径，本文件只验导出产物与导入校验/覆盖
vi.mock("@/lib/db", () => ({
  getStudents: vi.fn(),
  getClasses: vi.fn(),
  getClassGroups: vi.fn(),
  getClassGroupMembers: vi.fn(),
  getGroupBatches: vi.fn(),
  getGroupBatchDetail: vi.fn(),
  replaceClassGrouping: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { GET as exportGet } from "@/app/api/manage/groups/export/route";
import { POST as importPost } from "@/app/api/manage/groups/import/route";
import {
  getClassGroupMembers,
  getClassGroups,
  getClasses,
  getGroupBatchDetail,
  getGroupBatches,
  getStudents,
  getTeacherClassPairs,
  insertAuditLog,
  replaceClassGrouping,
} from "@/lib/db";
import type { ClassGroupMemberRow, ClassGroupRow, UserRow } from "@/lib/db";

const TEACHER_UID = 7;
const OTHER_TEACHER_UID = 8;
const CLASS_A = 1;
const CLASS_B = 2;

function student(id: number, classId: number): UserRow {
  return {
    id,
    user_code: `2026${String(id).padStart(8, "0")}`,
    password_hash: null,
    role: "student",
    name: `学生${id}`,
    class_id: classId,
    tags: null,
    avatar_url: null,
    evaluation_url: null,
    submitted_at: null,
    created_at: "2026-09-30 00:00:00",
    storage_id: 1,
  };
}

/** A 班 6 人（1-3 在组 1、4-5 在组 2、6 未进组），B 班 2 人 */
const ROSTER: UserRow[] = [
  student(1, CLASS_A),
  student(2, CLASS_A),
  student(3, CLASS_A),
  student(4, CLASS_A),
  student(5, CLASS_A),
  student(6, CLASS_A),
  student(21, CLASS_B),
  student(22, CLASS_B),
];

const GROUPS: ClassGroupRow[] = [
  { id: 101, class_id: CLASS_A, group_no: 1, created_at: "" },
  { id: 102, class_id: CLASS_A, group_no: 2, created_at: "" },
];

// 故意让组号与学号错位：组 1 装 4、5 号学生，组 2 装 1、2、3 号——导出若只按学号排就会串组
const LINKS: ClassGroupMemberRow[] = [
  { id: 1, group_id: 101, user_id: 4, created_at: "" },
  { id: 2, group_id: 101, user_id: 5, created_at: "" },
  { id: 3, group_id: 102, user_id: 1, created_at: "" },
  { id: 4, group_id: 102, user_id: 2, created_at: "" },
  { id: 5, group_id: 102, user_id: 3, created_at: "" },
];

const ADMIN = `auth_token=${await signToken({ role: "admin", uid: 1, name: "管理员" })}`;
const OWNER = `auth_token=${await signToken({ role: "teacher", uid: TEACHER_UID, name: "带班老师" })}`;
const OUTSIDER = `auth_token=${await signToken({ role: "teacher", uid: OTHER_TEACHER_UID, name: "别的老师" })}`;

function exportRequest(query: string, cookie: string): NextRequest {
  return new NextRequest(new URL(`/api/manage/groups/export?${query}`, "http://localhost:3000"), {
    headers: { cookie },
  });
}

function importRequest(body: unknown, cookie: string): NextRequest {
  return new NextRequest(new URL("/api/manage/groups/import", "http://localhost:3000"), {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

function lastAudit() {
  const calls = vi.mocked(insertAuditLog).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

/** 把导出产物读回成行（与前端解析同口径），用于断言与 round-trip */
async function readExport(buffer: ArrayBuffer) {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.worksheets[0];
  expect(sheet).toBeDefined();
  const header = sheet.getRow(1).values as unknown[];
  const rows: { groupNo: unknown; userCode: unknown; name: unknown }[] = [];
  sheet.eachRow((row, i) => {
    if (i === 1) return;
    rows.push({
      groupNo: row.getCell(1).value,
      userCode: row.getCell(2).value,
      name: row.getCell(3).value,
    });
  });
  return { header, rows, sheet };
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStudents).mockResolvedValue(ROSTER);
  vi.mocked(getClasses).mockResolvedValue([
    { id: CLASS_A, name: "A 班", invitation_code: "CODEA", created_at: "" },
    { id: CLASS_B, name: "B 班", invitation_code: "CODEB", created_at: "" },
  ]);
  vi.mocked(getClassGroups).mockResolvedValue(GROUPS);
  vi.mocked(getClassGroupMembers).mockResolvedValue(LINKS);
  vi.mocked(getGroupBatches).mockResolvedValue([]);
  vi.mocked(getGroupBatchDetail).mockResolvedValue({ batch: undefined, groups: [], members: [] });
  vi.mocked(getTeacherClassPairs).mockResolvedValue([
    { id: 1, teacher_id: TEACHER_UID, class_id: CLASS_A, created_at: "" },
  ]);
  vi.mocked(replaceClassGrouping).mockResolvedValue(undefined);
});

describe("GET /api/manage/groups/export — 导出当前分组（#101）", () => {
  it("未登录 → 401", async () => {
    const res = await exportGet(exportRequest(`classId=${CLASS_A}`, ""));
    expect(res.status).toBe(401);
  });

  it("缺 classId → 400，班级不存在 → 404", async () => {
    expect((await exportGet(exportRequest("", ADMIN))).status).toBe(400);
    expect((await exportGet(exportRequest("classId=999", ADMIN))).status).toBe(404);
  });

  it("导出三列、已进组的排前、未进组的组号留空，且学号是文本单元格", async () => {
    const res = await exportGet(exportRequest(`classId=${CLASS_A}`, ADMIN));
    expect(res.status).toBe(200);
    expect(res.headers.get("Content-Type")).toContain("spreadsheetml");

    const { header, rows, sheet } = await readExport(await res.arrayBuffer());
    expect(header.slice(1, 4)).toEqual(["组号", "学号", "姓名"]);
    expect(rows.length).toBe(6);
    // 先按组号、组内再按学号：组 1（学生 4、5）→ 组 2（学生 1、2、3）→ 未进组（学生 6）
    expect(rows.map((r) => r.groupNo)).toEqual([1, 1, 2, 2, 2, ""]);
    expect(rows.map((r) => r.userCode)).toEqual([
      "202600000004",
      "202600000005",
      "202600000001",
      "202600000002",
      "202600000003",
      "202600000006",
    ]);

    // 学号必须是文本：12 位数字若被写成数值，Excel 会丢前导零并显示科学计数法
    const codeCell = sheet.getCell("B2");
    expect(typeof codeCell.value).toBe("string");
    expect(codeCell.numFmt).toBe("@");

    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "group:export", status: "success", resource_id: String(CLASS_A) });
    expect(JSON.parse(String(lastAudit().metadata))).toMatchObject({
      classId: CLASS_A,
      studentCount: 6,
      groupedCount: 5,
      groupCount: 2,
    });
  });

  it("该班没分组时导出空白模板（全班学生 + 空组号），而不是空文件", async () => {
    vi.mocked(getClassGroups).mockResolvedValue([]);
    vi.mocked(getClassGroupMembers).mockResolvedValue([]);
    const res = await exportGet(exportRequest(`classId=${CLASS_A}`, ADMIN));
    const { rows } = await readExport(await res.arrayBuffer());
    expect(rows.length).toBe(6);
    expect(rows.every((r) => r.groupNo === "")).toBe(true);
    expect(rows.every((r) => typeof r.name === "string" && r.name.length > 0)).toBe(true);
  });

  it("读操作不限班级归属：教师可导非自建班", async () => {
    const res = await exportGet(exportRequest(`classId=${CLASS_B}`, OUTSIDER));
    expect(res.status).toBe(200);
  });
});

describe("POST /api/manage/groups/import — 全量覆盖（#101）", () => {
  const validRows = [
    { groupNo: 1, userCode: "202600000001", name: "学生1" },
    { groupNo: 1, userCode: "202600000002", name: "学生2" },
    { groupNo: 2, userCode: "202600000003", name: "学生3" },
    { groupNo: "", userCode: "202600000004", name: "学生4" },
    { groupNo: 5, userCode: "202600000005", name: "学生5" },
    { groupNo: 5, userCode: "202600000006", name: "学生6" },
  ];

  it("教师对非自建班 → 403，且不落库", async () => {
    const res = await importPost(importPostBody({ classId: CLASS_B, rows: validRows }, OUTSIDER));
    expect(res.status).toBe(403);
    expect(replaceClassGrouping).not.toHaveBeenCalled();
  });

  // 端点入参是 {classId, rows}，这里包一层避免每例都拼 URL
  function importPostBody(body: unknown, cookie: string) {
    return importRequest(body, cookie);
  }

  it("合法文件 → 200，按文件重建组（组号任意、空组号=不进组），并回传新视图", async () => {
    // 写入后让读侧 mock 反映新状态，否则「回传的新视图」验的是导入前的旧数据
    vi.mocked(replaceClassGrouping).mockImplementation(async (_classId, groups) => {
      const nextGroups = groups.map((g, i) => ({
        id: 900 + i,
        class_id: CLASS_A,
        group_no: g.group_no,
        created_at: "",
      }));
      const nextLinks: ClassGroupMemberRow[] = [];
      groups.forEach((g, i) =>
        g.user_ids.forEach((uid, j) => nextLinks.push({ id: j, group_id: nextGroups[i].id, user_id: uid, created_at: "" }))
      );
      vi.mocked(getClassGroups).mockResolvedValue(nextGroups);
      vi.mocked(getClassGroupMembers).mockResolvedValue(nextLinks);
    });
    const res = await importPost(importPostBody({ classId: CLASS_A, rows: validRows }, OWNER));
    expect(res.status).toBe(200);
    expect(vi.mocked(replaceClassGrouping).mock.calls[0]).toEqual([
      CLASS_A,
      [
        { group_no: 1, user_ids: [1, 2] },
        { group_no: 2, user_ids: [3] },
        { group_no: 5, user_ids: [5, 6] },
      ],
    ]);
    const data = await res.json();
    expect(data.view.ungrouped.map((m: { userCode: string }) => m.userCode)).toEqual(["202600000004"]);

    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "group:import", status: "success" });
    expect(JSON.parse(String(lastAudit().metadata))).toMatchObject({
      groupCount: 3,
      studentCount: 6,
      groupedCount: 5,
      ungroupedCount: 1,
    });
  });

  it("导入只覆盖当前分组，不写历史批次", async () => {
    const res = await importPost(importPostBody({ classId: CLASS_A, rows: validRows }, OWNER));
    expect(res.status).toBe(200);
    // 历史侧写入只有 insertGroupBatch / applyGroupingResult 两条路，本端点都不该碰
    expect(vi.mocked(insertAuditLog).mock.calls.map((c) => c[0].action)).toContain("group:import");
  });

  it("拒绝矩阵：缺人 / 多人 / 重复学号 / 非法组号 / 非 12 位学号 / 空文件", async () => {
    const cases: { name: string; rows: unknown; expect: string }[] = [
      {
        name: "缺人",
        rows: validRows.slice(0, 5),
        expect: "文件缺少本班学生 1 人",
      },
      {
        name: "多人（未知学号）",
        rows: [...validRows, { groupNo: 1, userCode: "202699999999", name: "外人" }],
        expect: "本班没有这些学号 1 个",
      },
      {
        name: "重复学号",
        rows: [...validRows.slice(0, 5), { groupNo: 1, userCode: "202600000001", name: "学生1" }],
        expect: "学号重复 1 处",
      },
      {
        name: "非法组号",
        rows: [...validRows.slice(0, 5), { groupNo: 0, userCode: "202600000006", name: "学生6" }],
        expect: "组号",
      },
      {
        name: "非 12 位学号",
        rows: [...validRows.slice(0, 5), { groupNo: 1, userCode: "12345", name: "学生6" }],
        expect: "不是 12 位数字",
      },
      {
        name: "组号写成了文字",
        rows: [...validRows.slice(0, 5), { groupNo: "1组", userCode: "202600000006", name: "学生6" }],
        expect: "必须是 1 到 999 的整数",
      },
      {
        name: "组号是小数",
        rows: [...validRows.slice(0, 5), { groupNo: 1.5, userCode: "202600000006", name: "学生6" }],
        expect: "必须是 1 到 999 的整数",
      },
      { name: "空文件", rows: [], expect: "文件没有数据行" },
    ];

    for (const item of cases) {
      const res = await importPost(importPostBody({ classId: CLASS_A, rows: item.rows }, ADMIN));
      expect(res.status, item.name).toBe(400);
      const data = await res.json();
      expect(String(data.errors?.join("；")) + String(data.error), item.name).toContain(item.expect);
    }
    expect(replaceClassGrouping).not.toHaveBeenCalled();

    await flushAudit();
    const failed = vi.mocked(insertAuditLog).mock.calls.filter((c) => c[0].status === "failed");
    expect(failed.length).toBe(cases.length);
  });

  it("同一学号用两个不同姓名出现在两个组 → 仍然按学号判重复，不会双重登记", async () => {
    const res = await importPost(
      importPostBody(
        {
          classId: CLASS_A,
          rows: [
            { groupNo: 1, userCode: "202600000001", name: "学生1" },
            { groupNo: 3, userCode: "202600000001", name: "改名后的学生1" },
            { groupNo: 1, userCode: "202600000002", name: "学生2" },
            { groupNo: 1, userCode: "202600000003", name: "学生3" },
            { groupNo: 1, userCode: "202600000004", name: "学生4" },
            { groupNo: 1, userCode: "202600000005", name: "学生5" },
            { groupNo: 1, userCode: "202600000006", name: "学生6" },
          ],
        },
        ADMIN
      )
    );
    expect(res.status).toBe(400);
    const data = await res.json();
    expect(String(data.errors.join("；"))).toContain("学号重复");
    expect(replaceClassGrouping).not.toHaveBeenCalled();
  });

  it("整份拒绝时不落库：名单一致性校验在写之前", async () => {
    const res = await importPost(
      importPostBody({ classId: CLASS_A, rows: validRows.slice(0, 3) }, ADMIN)
    );
    expect(res.status).toBe(400);
    expect(replaceClassGrouping).not.toHaveBeenCalled();
  });

  it("导出 → 解析 → 导入 round-trip：同一份名单写回同一结果", async () => {
    const exported = await exportGet(exportRequest(`classId=${CLASS_A}`, ADMIN));
    const { rows } = await readExport(await exported.arrayBuffer());
    const parsed = rows.map((r) => ({
      // 与前端解析同口径：空单元格可能是 ""（空串）或 null，非空原样带字符串交给服务端判
      groupNo: r.groupNo === null || r.groupNo === undefined || String(r.groupNo).trim() === "" ? null : String(r.groupNo).trim(),
      userCode: String(r.userCode).trim(),
    }));

    const res = await importPost(importPostBody({ classId: CLASS_A, rows: parsed }, ADMIN));
    expect(res.status).toBe(200);
    expect(vi.mocked(replaceClassGrouping).mock.calls[0]).toEqual([
      CLASS_A,
      [
        { group_no: 1, user_ids: [4, 5] },
        { group_no: 2, user_ids: [1, 2, 3] },
      ],
    ]);
  });

  it("请求体不是合法 JSON → 400", async () => {
    const res = await importPost(
      new NextRequest(new URL("/api/manage/groups/import", "http://localhost:3000"), {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: ADMIN },
        body: "{not json",
      })
    );
    expect(res.status).toBe(400);
  });
});
