import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

vi.mock("@/lib/db", () => ({
  getAllSubmitted: vi.fn(),
  getProfileSubmissionOwnerByFileUrl: vi.fn(),
  getStorageBackend: vi.fn(),
  getStudentGroupRef: vi.fn(),
  areStudentsInSameCurrentGroup: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  getStudents: vi.fn(),
  getClassGroups: vi.fn(),
  getClassGroupMembers: vi.fn(),
  getAssessmentByCode: vi.fn(),
  getCurrentAssessmentResultsByUserCodes: vi.fn(),
  getGroupUnreadCount: vi.fn(),
  getStudentWorkspaceContext: vi.fn(),
}));

import { GET as groupGet } from "@/app/api/shared/group/route";
import { GET as signGet } from "@/app/api/shared/storage-sign/route";
import {
  getAllSubmitted,
  areStudentsInSameCurrentGroup,
  getAssessmentByCode,
  getClassGroupMembers,
  getClassGroups,
  getCurrentAssessmentResultsByUserCodes,
  getGroupUnreadCount,
  getProfileSubmissionOwnerByFileUrl,
  getStorageBackend,
  getStudentGroupRef,
  getStudentWorkspaceContext,
  getStudents,
  getTeacherClassPairs,
} from "@/lib/db";
import type { ClassGroupMemberRow, ClassGroupRow, UserRow } from "@/lib/db";

const CLASS_ID = 1;
const AVATAR_1 = "/api/uploads/avatar_1.jpg";
const AVATAR_2 = "/api/uploads/avatar_2.jpg";
const AVATAR_3 = "/api/uploads/avatar_3.jpg";
const EVAL_2 = "/api/uploads/eval_2.jpg";

function user(id: number, avatar: string | null, evaluation: string | null): UserRow {
  return {
    id,
    user_code: `2026${String(id).padStart(8, "0")}`,
    password_hash: null,
    role: "student",
    name: `学生${id}`,
    class_id: CLASS_ID,
    tags: id % 2 === 0 ? JSON.stringify(["摄影"]) : JSON.stringify(["编程"]),
    avatar_url: avatar,
    evaluation_url: evaluation,
    evaluation_text: null,
    submitted_at: "2026-09-30 00:00:00",
    created_at: "2026-09-30 00:00:00",
    storage_id: 1,
  };
}

const ROSTER: UserRow[] = [
  user(1, AVATAR_1, null),
  user(2, AVATAR_2, EVAL_2),
  user(3, AVATAR_3, null),
];

const GROUP_REFS: Record<number, { class_id: number; group_no: number }> = {
  1: { class_id: CLASS_ID, group_no: 1 },
  2: { class_id: CLASS_ID, group_no: 1 },
  3: { class_id: CLASS_ID, group_no: 2 },
};

function groupRequest(cookie?: string): NextRequest {
  return new NextRequest(new URL("/api/shared/group", "http://localhost:3000"), {
    headers: cookie ? { cookie } : {},
  });
}

function signRequest(url: string, cookie?: string): NextRequest {
  return new NextRequest(
    new URL(`/api/shared/storage-sign?url=${encodeURIComponent(url)}`, "http://localhost:3000"),
    { headers: cookie ? { cookie } : {} }
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStudents).mockResolvedValue(ROSTER);
  vi.mocked(getAllSubmitted).mockResolvedValue(ROSTER);
  vi.mocked(getProfileSubmissionOwnerByFileUrl).mockResolvedValue(undefined);
  vi.mocked(getStorageBackend).mockResolvedValue({ id: 1, type: "local" } as never);
  vi.mocked(getTeacherClassPairs).mockResolvedValue([]);
  vi.mocked(getStudentGroupRef).mockImplementation(async (uid: number) => GROUP_REFS[uid]);
  // 默认：没有工作区 / 没有兴趣结果；需要覆盖的用例单独 mock
  vi.mocked(getStudentWorkspaceContext).mockResolvedValue(undefined);
  vi.mocked(getAssessmentByCode).mockResolvedValue(undefined);
  vi.mocked(getCurrentAssessmentResultsByUserCodes).mockResolvedValue([]);
  vi.mocked(getGroupUnreadCount).mockResolvedValue(0);
  vi.mocked(areStudentsInSameCurrentGroup).mockImplementation(async (a: number, b: number) => {
    const [ra, rb] = [GROUP_REFS[a], GROUP_REFS[b]];
    return Boolean(ra && rb && ra.class_id === rb.class_id && ra.group_no === rb.group_no);
  });
  vi.mocked(getClassGroups).mockResolvedValue([
    { id: 11, class_id: CLASS_ID, group_no: 1, leader_user_id: null, created_at: "" },
    { id: 12, class_id: CLASS_ID, group_no: 2, leader_user_id: null, created_at: "" },
  ] as ClassGroupRow[]);
  vi.mocked(getClassGroupMembers).mockResolvedValue([
    { id: 1, group_id: 11, user_id: 1, created_at: "" },
    { id: 2, group_id: 11, user_id: 2, created_at: "" },
    { id: 3, group_id: 12, user_id: 3, created_at: "" },
  ] as ClassGroupMemberRow[]);
});

describe("GET /api/shared/group — 学生端本组名单（#101）", () => {
  it("未登录 → 401", async () => {
    const res = await groupGet(groupRequest());
    expect(res.status).toBe(401);
  });

  it("教师访问 → 403（仅学生可看本组）", async () => {
    const token = await signToken({ role: "teacher", uid: 7, name: "张老师" });
    const res = await groupGet(groupRequest(`auth_token=${token}`));
    expect(res.status).toBe(403);
  });

  it("未分组 → grouped:false 且成员为空", async () => {
    vi.mocked(getStudentGroupRef).mockResolvedValue(undefined);
    const token = await signToken({ role: "student", uid: 1, name: "甲" });
    const res = await groupGet(groupRequest(`auth_token=${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grouped).toBe(false);
    expect(body.members).toEqual([]);
  });

  it("组号引用与成员行不一致（两次读之间被原子重分组）→ 按未分组返回，不泄露他组名单", async () => {
    // 本人引用仍指向 1 组，但成员行已是重分组后的另一批人（1 组里已无本人）
    vi.mocked(getClassGroupMembers).mockResolvedValue([
      { id: 1, group_id: 11, user_id: 2, created_at: "" },
      { id: 2, group_id: 11, user_id: 3, created_at: "" },
    ] as ClassGroupMemberRow[]);
    const token = await signToken({ role: "student", uid: 1, name: "甲" });
    const res = await groupGet(groupRequest(`auth_token=${token}`));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.grouped).toBe(false);
    expect(body.members).toEqual([]);
  });

  it("已分组 → 只返回本组成员（含 isMe 与标签），不含其他组；测评衍生字段不下发", async () => {
    const token = await signToken({ role: "student", uid: 1, name: "甲" });
    const res = await groupGet(groupRequest(`auth_token=${token}`));
    const body = await res.json();
    expect(body.grouped).toBe(true);
    expect(body.groupNo).toBe(1);
    expect(body.memberCount).toBe(2);
    expect(body.members.map((m: { userId: number }) => m.userId)).toEqual([1, 2]);
    expect(body.members.find((m: { userId: number }) => m.userId === 1).isMe).toBe(true);
    expect(body.members.find((m: { userId: number }) => m.userId === 2).isMe).toBe(false);
    expect(body.members.some((m: { userId: number }) => m.userId === 3)).toBe(false);
    expect(body.members[0].tags).toEqual(["编程"]);
    expect(body.members[0]).not.toHaveProperty("featureLabels");
    expect(body.members[0]).toHaveProperty("avatarUrl");
    expect(body.members[0]).toHaveProperty("storageId");
    // #346：没有工作区时按「未开启」下发，字段形状保持一致
    expect(body.workspace).toBeNull();
    expect(body.batch).toBeNull();
    expect(body.unreadCount).toBe(0);
    expect(body.canManage).toBe(false);
    expect(body.commonInterests).toEqual([]);
    expect(body.interestCoverage).toBeNull();
  });

  it("有工作区 + 本人是组长 → 带批次依据、未读数与 canManage", async () => {
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_ID, group_no: 1, leader_user_id: 1, created_at: "" },
      { id: 12, class_id: CLASS_ID, group_no: 2, leader_user_id: null, created_at: "" },
    ] as ClassGroupRow[]);
    vi.mocked(getStudentWorkspaceContext).mockResolvedValue({
      workspace: {
        id: 90,
        class_id: CLASS_ID,
        batch_id: 5,
        batch_group_id: 51,
        group_no: 1,
        title: "第 1 组工作区",
        created_at: "2026-10-20 10:00:00",
      },
      batch: {
        id: 5,
        class_id: CLASS_ID,
        strategy: "interest-role-v1",
        feature_sources: null,
        group_size: 5,
        student_count: 2,
        tagged_count: 2,
        metrics: null,
        created_by_id: 7,
        created_by_name: "张老师",
        created_by_role: "teacher",
        created_at: "2026-10-20 10:00:00",
      },
      batchGroup: {
        id: 51,
        batch_id: 5,
        group_no: 1,
        cohesion: 0.8,
        member_count: 2,
        leader_user_id: null,
        created_at: "2026-10-20 10:00:00",
      },
    });
    vi.mocked(getGroupUnreadCount).mockResolvedValue(3);
    const token = await signToken({ role: "student", uid: 1, name: "甲" });
    const res = await groupGet(groupRequest(`auth_token=${token}`));
    const body = await res.json();
    expect(body.batch).toMatchObject({ id: 5, strategy: "interest-role-v1" });
    expect(body.batch.strategyLabel).toBe("兴趣相近 + 性格互补");
    expect(body.workspace).toMatchObject({ id: 90, title: "第 1 组工作区" });
    expect(body.unreadCount).toBe(3);
    expect(body.canManage).toBe(true);
    expect(body.members.find((m: { userId: number }) => m.userId === 1).isLeader).toBe(true);
    expect(body.members.find((m: { userId: number }) => m.userId === 2).isLeader).toBe(false);
  });
});

describe("GET /api/shared/storage-sign — 同组头像放行（#101）", () => {
  it("学生签自己的头像 → 200", async () => {
    const token = await signToken({ role: "student", uid: 1, name: "甲" });
    const res = await signGet(signRequest(AVATAR_1, `auth_token=${token}`));
    expect(res.status).toBe(200);
  });

  it("学生签同组同学的头像 → 200（本次新增的放行边界）", async () => {
    const token = await signToken({ role: "student", uid: 1, name: "甲" });
    const res = await signGet(signRequest(AVATAR_2, `auth_token=${token}`));
    expect(res.status).toBe(200);
  });

  it("学生签同组同学的词云 → 403（只放行头像）", async () => {
    const token = await signToken({ role: "student", uid: 1, name: "甲" });
    const res = await signGet(signRequest(EVAL_2, `auth_token=${token}`));
    expect(res.status).toBe(403);
  });

  it("学生签非同组同学的头像 → 403", async () => {
    const token = await signToken({ role: "student", uid: 1, name: "甲" });
    const res = await signGet(signRequest(AVATAR_3, `auth_token=${token}`));
    expect(res.status).toBe(403);
  });
});
