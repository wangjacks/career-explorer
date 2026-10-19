import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

// 隔离数据库层：端点测试只关心鉴权、归属校验、原子落库与审计
vi.mock("@/lib/db", () => ({
  getStudents: vi.fn(),
  getClasses: vi.fn(),
  getClassGroups: vi.fn(),
  getClassGroupMembers: vi.fn(),
  getGroupBatches: vi.fn(),
  getGroupBatchDetail: vi.fn(),
  getStudentGroupRef: vi.fn(),
  moveGroupMember: vi.fn(),
  insertGroupEntry: vi.fn(),
  deleteGroupEntry: vi.fn(),
  applyGroupingResult: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  getUserById: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { POST as triggerPost, GET as groupsGet } from "@/app/api/manage/groups/route";
import { PATCH as membersPatch } from "@/app/api/manage/groups/members/route";
import { POST as entriesPost, DELETE as entriesDelete } from "@/app/api/manage/groups/entries/route";
import {
  applyGroupingResult,
  deleteGroupEntry,
  getClassGroupMembers,
  getClassGroups,
  getClasses,
  getGroupBatchDetail,
  getGroupBatches,
  getStudents,
  getStudentGroupRef,
  getTeacherClassPairs,
  getUserById,
  insertAuditLog,
  insertGroupEntry,
  moveGroupMember,
} from "@/lib/db";
import type { ClassGroupMemberRow, ClassGroupRow, UserRow } from "@/lib/db";

const TEACHER_UID = 7;
const OTHER_TEACHER_UID = 8;
const CLASS_A = 1;
const CLASS_B = 2;

function student(id: number, classId: number, tags: string[] | null): UserRow {
  return {
    id,
    user_code: `2026${String(id).padStart(8, "0")}`,
    password_hash: null,
    role: "student",
    name: `学生${id}`,
    class_id: classId,
    tags: tags ? JSON.stringify(tags) : null,
    avatar_url: null,
    evaluation_url: null,
    submitted_at: null,
    created_at: "2026-09-30 00:00:00",
    storage_id: 1,
  };
}

function jsonRequest(body: unknown, cookie: string, method = "POST"): NextRequest {
  return new NextRequest(new URL("/api/manage/groups", "http://localhost:3000"), {
    method,
    headers: { "Content-Type": "application/json", cookie },
    body: JSON.stringify(body),
  });
}

function searchRequest(query: string, cookie?: string, method = "GET"): NextRequest {
  return new NextRequest(new URL(`/api/manage/groups?${query}`, "http://localhost:3000"), {
    method,
    headers: cookie ? { cookie } : {},
  });
}

const flushAudit = () => new Promise((resolve) => setTimeout(resolve, 0));

function lastAudit() {
  const calls = vi.mocked(insertAuditLog).mock.calls;
  expect(calls.length).toBeGreaterThan(0);
  return calls[calls.length - 1][0];
}

/** 班级 A：6 个学生（4 个有标签）；班级 B：2 个学生 */
const ROSTER: UserRow[] = [
  student(1, CLASS_A, ["摄影"]),
  student(2, CLASS_A, ["摄影"]),
  student(3, CLASS_A, ["编程"]),
  student(4, CLASS_A, ["编程"]),
  student(5, CLASS_A, null),
  student(6, CLASS_A, null),
  student(21, CLASS_B, ["音乐"]),
  student(22, CLASS_B, ["音乐"]),
];

function emptyGrouping() {
  vi.mocked(getClassGroups).mockResolvedValue([] as ClassGroupRow[]);
  vi.mocked(getClassGroupMembers).mockResolvedValue([] as ClassGroupMemberRow[]);
  vi.mocked(getGroupBatches).mockResolvedValue([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStudents).mockResolvedValue(ROSTER);
  // 建组端点会先查班级存在：两库都会被外键拦住，这一步是为了给出可读且一致的 404
  vi.mocked(getClasses).mockResolvedValue([
    { id: CLASS_A, name: "A 班", invitation_code: "CODEA", created_at: "" },
    { id: CLASS_B, name: "B 班", invitation_code: "CODEB", created_at: "" },
  ]);
  vi.mocked(getTeacherClassPairs).mockResolvedValue([
    { id: 1, teacher_id: TEACHER_UID, class_id: CLASS_A, created_at: "" },
  ]);
  vi.mocked(applyGroupingResult).mockResolvedValue(99);
  // clearAllMocks 不清实现，逐条给默认值，避免上一条用例的 mockRejectedValue 泄漏
  vi.mocked(moveGroupMember).mockResolvedValue(undefined);
  vi.mocked(insertGroupEntry).mockResolvedValue(undefined);
  vi.mocked(deleteGroupEntry).mockResolvedValue(undefined);
  vi.mocked(getStudentGroupRef).mockResolvedValue(undefined);
  // 换人端点以 users 表的班级归属为准（#14 复核），默认按名册回查
  vi.mocked(getUserById).mockImplementation(async (id: number) => ROSTER.find((u) => u.id === id));
  vi.mocked(getGroupBatchDetail).mockResolvedValue({ batch: undefined, groups: [], members: [] });
  emptyGrouping();
});

describe("POST /api/manage/groups — 触发自动分组（#101）", () => {
  it("未登录 → 401", async () => {
    const res = await triggerPost(jsonRequest({ classId: CLASS_A }, ""));
    expect(res.status).toBe(401);
  });

  it("教师对非自建班 → 403（写限所带班级），且记 group:generate failed", async () => {
    const token = await signToken({ role: "teacher", uid: OTHER_TEACHER_UID, name: "别的老师" });
    const res = await triggerPost(jsonRequest({ classId: CLASS_A }, `auth_token=${token}`));
    expect(res.status).toBe(403);
    expect(applyGroupingResult).not.toHaveBeenCalled();

    await flushAudit();
    const log = lastAudit();
    expect(log).toMatchObject({
      action: "group:generate",
      resource_type: "group-batch",
      status: "failed",
      actor_id: OTHER_TEACHER_UID,
      actor_role: "teacher",
      error_message: "无权对该班级分组",
    });
    expect(log.resource_id).toBeNull();
    expect(JSON.parse(String(log.metadata))).toEqual({ classId: CLASS_A });
  });

  it("班级无学生 → 400", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudents).mockResolvedValue([]);
    const res = await triggerPost(jsonRequest({ classId: CLASS_A }, `auth_token=${token}`));
    expect(res.status).toBe(400);
  });

  it("落库失败 → 500，且失败也留审计（AGENTS.md：管理域写操作成败均记）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(applyGroupingResult).mockRejectedValue(new Error("database is locked"));
    const res = await triggerPost(jsonRequest({ classId: CLASS_A }, `auth_token=${token}`));
    expect(res.status).toBe(500);

    await flushAudit();
    const log = lastAudit();
    expect(log).toMatchObject({ action: "group:generate", status: "failed", error_message: "database is locked" });
  });

  it("教师对自己带的班 → 200，且「覆盖 + 归档」走同一个原子方法", async () => {
    const token = await signToken({ role: "teacher", uid: TEACHER_UID, name: "张老师" });
    const res = await triggerPost(jsonRequest({ classId: CLASS_A }, `auth_token=${token}`));
    expect(res.status).toBe(200);
    expect(applyGroupingResult).toHaveBeenCalledTimes(1);

    const [classId, groups, batch] = vi.mocked(applyGroupingResult).mock.calls[0];
    expect(classId).toBe(CLASS_A);
    // 6 人 → 2 组（3+3），每人恰好出现一次
    expect(groups.length).toBe(2);
    expect(groups.map((g) => g.user_ids.length).sort()).toEqual([3, 3]);
    expect(new Set(groups.flatMap((g) => g.user_ids)).size).toBe(6);
    expect(batch.strategy).toBe("idf-cosine");
    expect(JSON.parse(batch.featureSources)[0]).toMatchObject({ key: "tags", kind: "set" });
    expect(batch.studentCount).toBe(6);
    expect(batch.taggedCount).toBe(4);
    expect(batch.actorName).toBe("张老师");
    expect(batch.groups[0].members[0]).toHaveProperty("userCode");
    expect(batch.groups[0].members[0]).toHaveProperty("name");

    await flushAudit();
    const log = lastAudit();
    expect(log.action).toBe("group:generate");
    expect(log.resource_type).toBe("group-batch");
    expect(String(log.resource_id)).toBe("99");
    expect(log.status).toBe("success");
  });

  it("有标签者的分组效果优于基线（相似标签被分到一起）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    await triggerPost(jsonRequest({ classId: CLASS_A }, `auth_token=${token}`));
    const [, groups, batch] = vi.mocked(applyGroupingResult).mock.calls[0];
    const metrics = JSON.parse(batch.metrics) as {
      overall: number;
      baselines: { sequence: number; random: number };
    };
    expect(metrics.overall).toBeGreaterThan(metrics.baselines.sequence);
    expect(metrics.overall).toBeGreaterThan(metrics.baselines.random);
    // 学号升序且标签相同 → 1、2 应落在一组
    expect(groups.find((g) => g.user_ids.includes(1))?.user_ids).toContain(2);
  });
});

describe("GET /api/manage/groups — 读当前分组（读不限）", () => {
  it("缺少 classId → 400", async () => {
    const res = await groupsGet(searchRequest(""));
    expect(res.status).toBe(400);
  });

  it("教师可读非自建班（读不限），返回指标与源元信息", async () => {
    const token = await signToken({ role: "teacher", uid: OTHER_TEACHER_UID, name: "别的老师" });
    const res = await groupsGet(searchRequest(`classId=${CLASS_A}`, `auth_token=${token}`));
    expect(res.status).toBe(200);
    const view = await res.json();
    expect(view.hasGrouping).toBe(false);
    expect(view.studentCount).toBe(6);
    expect(view.coveredCount).toBe(4);
    expect(view.sources[0]).toMatchObject({ key: "tags", label: "标签" });
    expect(view.latestBatch).toBeNull();
  });

  it("读回当前分组：带成员、内聚度与「与最近一批的差异数」", async () => {
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_A, group_no: 1, created_at: "" },
      { id: 12, class_id: CLASS_A, group_no: 2, created_at: "" },
    ] as ClassGroupRow[]);
    vi.mocked(getClassGroupMembers).mockResolvedValue([
      { id: 1, group_id: 11, user_id: 1, created_at: "" },
      { id: 2, group_id: 11, user_id: 2, created_at: "" },
      { id: 3, group_id: 12, user_id: 3, created_at: "" },
    ] as ClassGroupMemberRow[]);
    vi.mocked(getGroupBatches).mockResolvedValue([
      {
        id: 5, class_id: CLASS_A, strategy: "idf-cosine", feature_sources: "[]",
        group_size: 5, student_count: 4, tagged_count: 4, metrics: JSON.stringify({ overall: 1 }),
        created_by_id: null, created_by_name: "张老师", created_by_role: "teacher", created_at: "2026-09-30 10:00:00",
      },
    ]);
    // 上次自动分组：1、2 在组 1；3、4 在组 2 → 当前缺 4 号，故差异为 1
    vi.mocked(getGroupBatchDetail).mockResolvedValue({
      batch: undefined,
      groups: [
        { id: 51, batch_id: 5, group_no: 1, cohesion: 0.5, member_count: 2, created_at: "" },
        { id: 52, batch_id: 5, group_no: 2, cohesion: null, member_count: 1, created_at: "" },
      ],
      members: [
        { id: 1, batch_id: 5, group_id: 51, user_id: 1, user_code: "a", name: "甲", created_at: "" },
        { id: 2, batch_id: 5, group_id: 51, user_id: 2, user_code: "b", name: "乙", created_at: "" },
        { id: 3, batch_id: 5, group_id: 52, user_id: 3, user_code: "c", name: "丙", created_at: "" },
        { id: 4, batch_id: 5, group_id: 52, user_id: 4, user_code: "d", name: "丁", created_at: "" },
      ],
    });

    const res = await groupsGet(searchRequest(`classId=${CLASS_A}`));
    const view = await res.json();
    expect(view.hasGrouping).toBe(true);
    expect(view.groups.length).toBe(2);
    expect(view.groups[0].members.map((m: { userCode: string }) => m.userCode)).toEqual([
      "202600000001",
      "202600000002",
    ]);
    expect(view.groups[0].cohesion).toBeCloseTo(1, 6); // 标签相同
    expect(view.latestBatch.createdByName).toBe("张老师");
    expect(view.diffCount).toBe(1);
  });

  it("视图给出「未进组」名单：转入或导入漏填的人不能被静默藏起来", async () => {
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_A, group_no: 1, created_at: "" },
    ] as ClassGroupRow[]);
    vi.mocked(getClassGroupMembers).mockResolvedValue([
      { id: 1, group_id: 11, user_id: 1, created_at: "" },
      { id: 2, group_id: 11, user_id: 2, created_at: "" },
    ] as ClassGroupMemberRow[]);

    const view = await (await groupsGet(searchRequest(`classId=${CLASS_A}`))).json();
    // A 班 6 人，只有 1、2 进组
    expect(view.ungrouped.map((m: { userCode: string }) => m.userCode)).toEqual([
      "202600000003",
      "202600000004",
      "202600000005",
      "202600000006",
    ]);
    expect(view.ungrouped[0]).toMatchObject({ userId: 3, name: "学生3" });
  });
});

describe("PATCH /api/manage/groups/members — 手工换人（#101）", () => {
  it("教师对非自建班 → 403", async () => {
    const token = await signToken({ role: "teacher", uid: OTHER_TEACHER_UID, name: "别的老师" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_A, group_no: 1 });
    const res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 1, toGroupNo: 2 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(403);
    expect(moveGroupMember).not.toHaveBeenCalled();

    await flushAudit();
    expect(lastAudit()).toMatchObject({
      action: "group:move",
      status: "failed",
      actor_id: OTHER_TEACHER_UID,
      error_message: "无权调整该班级分组",
    });
  });

  it("学生不在本班 → 400", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_B, group_no: 1 });
    const res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 21, toGroupNo: 2 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(400);
  });

  it("未分组且不在本班 → 400，不会被直接插进本班的组", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    // getStudentGroupRef 保持默认的 undefined：只看组引用做归属判断时会放过这一例
    const res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 21, toGroupNo: 1 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(400);
    expect(moveGroupMember).not.toHaveBeenCalled();
  });

  it("userId 不是学生或不存在 → 400", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getUserById).mockResolvedValue({ ...student(9, CLASS_A, null), role: "teacher" } as UserRow);
    let res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 9, toGroupNo: 1 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(400);

    vi.mocked(getUserById).mockResolvedValue(undefined);
    res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 12345, toGroupNo: 1 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(400);
    expect(moveGroupMember).not.toHaveBeenCalled();
  });

  it("成员行指向别班（转班漏清理的脏数据）→ 以 users 为准搬回本班，来源记 null", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_B, group_no: 2 });
    const res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 1, toGroupNo: 2 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(200);
    expect((await res.json()).fromGroupNo).toBe(null);
    expect(moveGroupMember).toHaveBeenCalledWith(CLASS_A, 1, 2);
  });

  it("目标组不存在 → 400（不冒 500），并记 group:move failed", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_A, group_no: 1 });
    vi.mocked(moveGroupMember).mockRejectedValue(new Error("目标组不存在"));
    const res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 1, toGroupNo: 99 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("目标组不存在");

    await flushAudit();
    const log = lastAudit();
    expect(log).toMatchObject({ action: "group:move", status: "failed", error_message: "目标组不存在" });
    expect(JSON.parse(String(log.metadata))).toMatchObject({ classId: CLASS_A, userId: 1, fromGroupNo: 1, toGroupNo: 99 });
  });

  it("成功换人 → 200 并记 group:move（含 from/to）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_A, group_no: 1 });
    const res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 3, toGroupNo: 2 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(200);
    expect(moveGroupMember).toHaveBeenCalledWith(CLASS_A, 3, 2);

    await flushAudit();
    const log = lastAudit();
    expect(log.action).toBe("group:move");
    expect(log.resource_type).toBe("group");
    // recordAudit 会把 metadata 序列化为字符串后再入库
    expect(JSON.parse(String(log.metadata))).toMatchObject({ classId: CLASS_A, userId: 3, fromGroupNo: 1, toGroupNo: 2 });
  });

  it("界面快照带学号且与库中不符 → 409，不落库（SQLite 删后会复用 id）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_A, group_no: 1 });
    const res = await membersPatch(
      jsonRequest(
        { classId: CLASS_A, userId: 3, toGroupNo: 2, userCode: "202600000099" },
        `auth_token=${token}`,
        "PATCH"
      )
    );
    expect(res.status).toBe(409);
    expect((await res.json()).error).toBe("学生信息已变化，请刷新后重试");
    expect(moveGroupMember).not.toHaveBeenCalled();

    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "group:move", status: "failed", error_message: "学生标识与库中不一致" });
  });

  it("带一致学号 → 照常移动（换人抽屉的提交口径）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_A, group_no: 1 });
    const res = await membersPatch(
      jsonRequest(
        { classId: CLASS_A, userId: 3, toGroupNo: 2, userCode: "202600000003" },
        `auth_token=${token}`,
        "PATCH"
      )
    );
    expect(res.status).toBe(200);
    expect(moveGroupMember).toHaveBeenCalledWith(CLASS_A, 3, 2);
  });

  it("驱动层报错原文不回显给客户端（表名/索引名只进审计）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_A, group_no: 1 });
    vi.mocked(moveGroupMember).mockRejectedValue(
      new Error("UNIQUE constraint failed: class_group_members.user_id")
    );
    const res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 3, toGroupNo: 2 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toBe("移动失败，请刷新后重试");

    await flushAudit();
    expect(String(lastAudit().error_message)).toContain("UNIQUE constraint failed");
  });

  it("移到同一组 → 直接返回未移动，不落库也不记审计", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_A, group_no: 2 });
    const res = await membersPatch(
      jsonRequest({ classId: CLASS_A, userId: 3, toGroupNo: 2 }, `auth_token=${token}`, "PATCH")
    );
    expect(res.status).toBe(200);
    expect((await res.json()).moved).toBe(false);
    expect(moveGroupMember).not.toHaveBeenCalled();
    expect(insertAuditLog).not.toHaveBeenCalled();
  });
});

describe("POST/DELETE /api/manage/groups/entries — 建/删组（#101）", () => {
  it("教师对非自建班 → 403", async () => {
    const token = await signToken({ role: "teacher", uid: OTHER_TEACHER_UID, name: "别的老师" });
    const res = await entriesPost(jsonRequest({ classId: CLASS_A }, `auth_token=${token}`));
    expect(res.status).toBe(403);
    expect(insertGroupEntry).not.toHaveBeenCalled();
  });

  it("班级不存在 → 可读的 404 而不是外键报错的 500，并记 failed", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await entriesPost(jsonRequest({ classId: 999, groupNo: 1 }, `auth_token=${token}`));
    expect(res.status).toBe(404);
    expect(insertGroupEntry).not.toHaveBeenCalled();

    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "group:create", status: "failed", error_message: "班级不存在" });
  });

  it("组号超出手工上限 → 400（MySQL 会因超出 INT 范围报错，两库须同口径）", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await entriesPost(jsonRequest({ classId: CLASS_A, groupNo: 100000 }, `auth_token=${token}`));
    expect(res.status).toBe(400);
    expect(insertGroupEntry).not.toHaveBeenCalled();
  });

  it("请求体不是合法 JSON → 400 而不是 500", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await triggerPost(
      new NextRequest(new URL("/api/manage/groups", "http://localhost:3000"), {
        method: "POST",
        headers: { "Content-Type": "application/json", cookie: `auth_token=${token}` },
        body: "{这不是 JSON",
      })
    );
    expect(res.status).toBe(400);
    expect(applyGroupingResult).not.toHaveBeenCalled();

    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "group:generate", status: "failed" });
  });

  it("组号缺省时取「最大组号 + 1」", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_A, group_no: 1, created_at: "" },
      { id: 12, class_id: CLASS_A, group_no: 4, created_at: "" },
    ] as ClassGroupRow[]);
    const res = await entriesPost(jsonRequest({ classId: CLASS_A }, `auth_token=${token}`));
    expect(res.status).toBe(200);
    expect((await res.json()).groupNo).toBe(5);
    expect(insertGroupEntry).toHaveBeenCalledWith(CLASS_A, 5);
  });

  it("组号已存在 → 409，并记 group:create failed", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_A, group_no: 2, created_at: "" },
    ] as ClassGroupRow[]);
    const res = await entriesPost(jsonRequest({ classId: CLASS_A, groupNo: 2 }, `auth_token=${token}`));
    expect(res.status).toBe(409);
    expect(insertGroupEntry).not.toHaveBeenCalled();

    await flushAudit();
    const log = lastAudit();
    expect(log).toMatchObject({ action: "group:create", status: "failed", error_message: "第 2 组已存在" });
    expect(JSON.parse(String(log.metadata))).toEqual({ classId: CLASS_A, groupNo: 2 });
  });

  it("删除非空组 → 400（先移人），不落库", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_A, group_no: 1, created_at: "" },
    ] as ClassGroupRow[]);
    vi.mocked(getClassGroupMembers).mockResolvedValue([
      { id: 1, group_id: 11, user_id: 1, created_at: "" },
    ] as ClassGroupMemberRow[]);
    const res = await entriesDelete(searchRequest(`classId=${CLASS_A}&groupNo=1`, `auth_token=${token}`, "DELETE"));
    expect(res.status).toBe(400);
    expect(deleteGroupEntry).not.toHaveBeenCalled();

    await flushAudit();
    const log = lastAudit();
    expect(log).toMatchObject({
      action: "group:delete",
      status: "failed",
      error_message: "该组还有成员，请先移到其他组",
    });
    expect(JSON.parse(String(log.metadata))).toEqual({ classId: CLASS_A, groupNo: 1 });
  });

  it("删除空组 → 200 并记 group:delete", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_A, group_no: 1, created_at: "" },
    ] as ClassGroupRow[]);
    const res = await entriesDelete(searchRequest(`classId=${CLASS_A}&groupNo=1`, `auth_token=${token}`, "DELETE"));
    expect(res.status).toBe(200);
    expect(deleteGroupEntry).toHaveBeenCalledWith(CLASS_A, 1);

    await flushAudit();
    expect(lastAudit().action).toBe("group:delete");
  });

  it("删除不存在的组 → 404", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    const res = await entriesDelete(searchRequest(`classId=${CLASS_A}&groupNo=7`, `auth_token=${token}`, "DELETE"));
    expect(res.status).toBe(404);
    expect(deleteGroupEntry).not.toHaveBeenCalled();
  });

  it("建组落库失败 → 500，且失败落审计", async () => {
    const token = await signToken({ role: "admin", uid: 1, name: "管理员" });
    vi.mocked(insertGroupEntry).mockRejectedValue(new Error("disk I/O error"));
    const res = await entriesPost(jsonRequest({ classId: CLASS_A }, `auth_token=${token}`));
    expect(res.status).toBe(500);

    await flushAudit();
    expect(lastAudit()).toMatchObject({ action: "group:create", status: "failed", error_message: "disk I/O error" });
  });

  it("删组教师越权 → 403，失败审计里带上目标班级与组号", async () => {
    const token = await signToken({ role: "teacher", uid: OTHER_TEACHER_UID, name: "别的老师" });
    const res = await entriesDelete(
      searchRequest(`classId=${CLASS_A}&groupNo=1`, `auth_token=${token}`, "DELETE")
    );
    expect(res.status).toBe(403);

    await flushAudit();
    const log = lastAudit();
    expect(log).toMatchObject({ action: "group:delete", status: "failed", actor_id: OTHER_TEACHER_UID });
    expect(JSON.parse(String(log.metadata))).toEqual({ classId: CLASS_A, groupNo: 1 });
  });
});
