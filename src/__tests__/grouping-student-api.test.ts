import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

vi.mock("@/lib/db", () => ({
  getAllSubmitted: vi.fn(),
  getProfileSubmissionOwnerByFileUrl: vi.fn(),
  getStorageBackend: vi.fn(),
  getStudentGroupRef: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  getStudents: vi.fn(),
  getClassGroups: vi.fn(),
  getClassGroupMembers: vi.fn(),
}));

import { GET as groupGet } from "@/app/api/shared/group/route";
import { GET as signGet } from "@/app/api/shared/storage-sign/route";
import {
  getAllSubmitted,
  getClassGroupMembers,
  getClassGroups,
  getProfileSubmissionOwnerByFileUrl,
  getStorageBackend,
  getStudentGroupRef,
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
  vi.mocked(getClassGroups).mockResolvedValue([
    { id: 11, class_id: CLASS_ID, group_no: 1, created_at: "" },
    { id: 12, class_id: CLASS_ID, group_no: 2, created_at: "" },
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

  it("已分组 → 只返回本组成员（含 isMe 与源标签），不含其他组", async () => {
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
    expect(body.sources[0]).toMatchObject({ key: "tags", label: "标签" });
    expect(body.members[0].featureLabels.tags.length).toBeGreaterThan(0);
    expect(body.members[0]).toHaveProperty("avatarUrl");
    expect(body.members[0]).toHaveProperty("storageId");
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
