import { describe, it, expect, vi, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { signToken } from "@/lib/token";

vi.mock("@/lib/db", () => ({
  getClassGroups: vi.fn(),
  getClassGroupWorkspace: vi.fn(),
  getGroupBatchDetail: vi.fn(),
  getGroupWorkspaceById: vi.fn(),
  getStudentGroupRef: vi.fn(),
  getStudentWorkspaceContext: vi.fn(),
  getTeacherClassPairs: vi.fn(),
  listStudentWorkspaces: vi.fn(),
  listGroupPosts: vi.fn(),
  getGroupPost: vi.fn(),
  insertGroupPost: vi.fn(),
  updateGroupPost: vi.fn(),
  countRecentGroupPosts: vi.fn(),
  listGroupTasks: vi.fn(),
  getGroupTask: vi.fn(),
  insertGroupTask: vi.fn(),
  claimGroupTask: vi.fn(),
  updateGroupTask: vi.fn(),
  countRecentGroupTasks: vi.fn(),
  getGroupUnreadCount: vi.fn(),
  markGroupWorkspaceRead: vi.fn(),
  insertAuditLog: vi.fn(),
}));

import { POST as postPost, GET as getPosts } from "@/app/api/shared/group/posts/route";
import { PATCH as patchTask } from "@/app/api/shared/group/tasks/[id]/route";
import { POST as createTask } from "@/app/api/shared/group/tasks/route";
import { GET as historyGet } from "@/app/api/shared/group/history/route";
import { GET as unreadGet } from "@/app/api/shared/group/unread/route";
import {
  claimGroupTask,
  countRecentGroupPosts,
  getClassGroups,
  getClassGroupWorkspace,
  getGroupBatchDetail,
  getGroupTask,
  getGroupUnreadCount,
  getStudentGroupRef,
  getStudentWorkspaceContext,
  getTeacherClassPairs,
  insertAuditLog,
  insertGroupPost,
  listGroupPosts,
  listStudentWorkspaces,
  updateGroupTask,
} from "@/lib/db";
import type { GroupBatchGroupRow, GroupBatchRow, GroupWorkspaceRow } from "@/lib/db";

const CLASS_ID = 1;
const STUDENT_UID = 1;
const TEACHER_UID = 7;

const WORKSPACE: GroupWorkspaceRow = {
  id: 90,
  class_id: CLASS_ID,
  batch_id: 5,
  batch_group_id: 51,
  group_no: 1,
  title: "第 1 组工作区",
  created_at: "2026-10-20 10:00:00",
};

const BATCH: GroupBatchRow = {
  id: 5,
  class_id: CLASS_ID,
  strategy: "interest-role-v1",
  feature_sources: null,
  group_size: 5,
  student_count: 2,
  tagged_count: 2,
  metrics: null,
  created_by_id: TEACHER_UID,
  created_by_name: "张老师",
  created_by_role: "teacher",
  created_at: "2026-10-20 10:00:00",
};

const BATCH_GROUP: GroupBatchGroupRow = {
  id: 51,
  batch_id: 5,
  group_no: 1,
  cohesion: 0.8,
  member_count: 2,
  leader_user_id: null,
  created_at: "2026-10-20 10:00:00",
};

const GROUP_CONTEXT = { workspace: WORKSPACE, batch: BATCH, batchGroup: BATCH_GROUP };

function request(url: string, init: RequestInit | undefined, token?: string): NextRequest {
  return new NextRequest(new URL(url, "http://localhost:3000"), {
    method: init?.method,
    body: init?.body,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...(token ? { cookie: `auth_token=${token}` } : {}),
    },
  });
}

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getStudentGroupRef).mockResolvedValue({ class_id: CLASS_ID, group_no: 1 });
  vi.mocked(getClassGroups).mockResolvedValue([
    { id: 11, class_id: CLASS_ID, group_no: 1, leader_user_id: null, created_at: "" },
  ]);
  vi.mocked(getStudentWorkspaceContext).mockResolvedValue(GROUP_CONTEXT);
  vi.mocked(getClassGroupWorkspace).mockResolvedValue(GROUP_CONTEXT);
  vi.mocked(getTeacherClassPairs).mockResolvedValue([
    { id: 1, teacher_id: TEACHER_UID, class_id: CLASS_ID, created_at: "" },
  ]);
  vi.mocked(listStudentWorkspaces).mockResolvedValue([]);
  vi.mocked(listGroupPosts).mockResolvedValue([]);
  vi.mocked(insertGroupPost).mockResolvedValue(501);
  vi.mocked(countRecentGroupPosts).mockResolvedValue(0);
  vi.mocked(getGroupUnreadCount).mockResolvedValue(0);
  vi.mocked(getGroupBatchDetail).mockResolvedValue({
    batch: BATCH,
    groups: [BATCH_GROUP],
    members: [],
  });
  vi.mocked(getGroupTask).mockResolvedValue(undefined);
  vi.mocked(claimGroupTask).mockResolvedValue(false);
  vi.mocked(updateGroupTask).mockResolvedValue(undefined);
  vi.mocked(insertAuditLog).mockResolvedValue(undefined);
});

describe("小组公告 / 任务 / 历史 API（#346）", () => {
  it("未登录 → 401；非法请求体 → 400", async () => {
    expect((await getPosts(request("/api/shared/group/posts", undefined))).status).toBe(401);
    const token = await signToken({ role: "student", uid: STUDENT_UID, name: "甲" });
    const res = await postPost(
      request("/api/shared/group/posts", { method: "POST", body: "not-json" }, token)
    );
    expect(res.status).toBe(400);
  });

  it("非组长发布公告 → 403，且记失败审计", async () => {
    const token = await signToken({ role: "student", uid: STUDENT_UID, name: "甲" });
    const res = await postPost(
      request(
        "/api/shared/group/posts",
        { method: "POST", body: JSON.stringify({ title: "公告", content: "内容" }) },
        token
      )
    );
    expect(res.status).toBe(403);
    expect(insertGroupPost).not.toHaveBeenCalled();
    await flush();
    expect(insertAuditLog).toHaveBeenCalledWith(
      expect.objectContaining({ action: "group:post:create", status: "failed" })
    );
  });

  it("组长发布公告 → 200；标题超长 → 400；频率过高 → 429", async () => {
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_ID, group_no: 1, leader_user_id: STUDENT_UID, created_at: "" },
    ]);
    const token = await signToken({ role: "student", uid: STUDENT_UID, name: "甲" });

    const ok = await postPost(
      request(
        "/api/shared/group/posts",
        { method: "POST", body: JSON.stringify({ title: "  公告  ", content: "  内容  " }) },
        token
      )
    );
    expect(ok.status).toBe(200);
    expect(insertGroupPost).toHaveBeenCalledWith(
      expect.objectContaining({ title: "公告", content: "内容", workspaceId: WORKSPACE.id })
    );

    const tooLong = await postPost(
      request(
        "/api/shared/group/posts",
        { method: "POST", body: JSON.stringify({ title: "标".repeat(41), content: "内容" }) },
        token
      )
    );
    expect(tooLong.status).toBe(400);

    vi.mocked(countRecentGroupPosts).mockResolvedValue(5);
    const throttled = await postPost(
      request(
        "/api/shared/group/posts",
        { method: "POST", body: JSON.stringify({ title: "公告", content: "内容" }) },
        token
      )
    );
    expect(throttled.status).toBe(429);
  });

  it("教师向本人带的班发布公告 → 200；非本人班级 → 403", async () => {
    const token = await signToken({ role: "teacher", uid: TEACHER_UID, name: "张老师" });
    const ok = await postPost(
      request(
        "/api/shared/group/posts",
        { method: "POST", body: JSON.stringify({ classId: CLASS_ID, groupNo: 1, title: "通知", content: "明天带材料" }) },
        token
      )
    );
    expect(ok.status).toBe(200);
    expect(insertGroupPost).toHaveBeenCalledWith(
      expect.objectContaining({ authorRole: "teacher", workspaceId: WORKSPACE.id })
    );

    vi.mocked(getTeacherClassPairs).mockResolvedValue([]);
    const denied = await postPost(
      request(
        "/api/shared/group/posts",
        { method: "POST", body: JSON.stringify({ classId: CLASS_ID, groupNo: 1, title: "通知", content: "内容" }) },
        token
      )
    );
    expect(denied.status).toBe(403);
  });

  it("学生查看他人批次工作区 → 403（历史清单里没有）", async () => {
    const token = await signToken({ role: "student", uid: STUDENT_UID, name: "甲" });
    const res = await getPosts(
      request("/api/shared/group/posts?workspaceId=999", undefined, token)
    );
    expect(res.status).toBe(403);
  });

  it("任务认领：抢输返回 409；抢到返回更新后的任务", async () => {
    const openTask = {
      id: 61,
      workspace_id: WORKSPACE.id,
      title: "任务",
      description: null,
      assignee_id: null,
      assignee_name: null,
      status: "open" as const,
      due_at: null,
      created_by_id: STUDENT_UID,
      created_by_name: "组长",
      created_by_role: "student",
      created_at: "2026-10-20 10:00:00",
      completed_at: null,
      deleted_at: null,
    };
    vi.mocked(getGroupTask).mockResolvedValue(openTask);
    const token = await signToken({ role: "student", uid: STUDENT_UID, name: "甲" });

    const lost = await patchTask(
      request(`/api/shared/group/tasks/61`, { method: "PATCH", body: JSON.stringify({ action: "claim" }) }, token),
      { params: Promise.resolve({ id: "61" }) }
    );
    expect(lost.status).toBe(409);

    vi.mocked(claimGroupTask).mockResolvedValue(true);
    const claimedTask = {
      ...openTask,
      status: "in_progress" as const,
      assignee_id: STUDENT_UID,
      assignee_name: "甲",
    };
    // 第一次读用于校验「任务仍可认领」，第二次读用于回传更新后的任务
    vi.mocked(getGroupTask)
      .mockResolvedValueOnce(openTask)
      .mockResolvedValueOnce(claimedTask);
    const won = await patchTask(
      request(`/api/shared/group/tasks/61`, { method: "PATCH", body: JSON.stringify({ action: "claim" }) }, token),
      { params: Promise.resolve({ id: "61" }) }
    );
    expect(won.status).toBe(200);
    expect(claimGroupTask).toHaveBeenCalledWith(61, WORKSPACE.id, STUDENT_UID, "甲");
  });

  it("组长新建任务：默认留待认领；指派非本组成员 → 400", async () => {
    vi.mocked(getClassGroups).mockResolvedValue([
      { id: 11, class_id: CLASS_ID, group_no: 1, leader_user_id: STUDENT_UID, created_at: "" },
    ]);
    const token = await signToken({ role: "student", uid: STUDENT_UID, name: "甲" });
    const ok = await createTask(
      request(
        "/api/shared/group/tasks",
        { method: "POST", body: JSON.stringify({ title: "任务", dueAt: "" }) },
        token
      )
    );
    expect(ok.status).toBe(200);

    const bad = await createTask(
      request(
        "/api/shared/group/tasks",
        { method: "POST", body: JSON.stringify({ title: "任务", assigneeId: 99 }) },
        token
      )
    );
    expect(bad.status).toBe(400);
  });

  it("历史批次清单标记当前批次；未读数走轻量端点", async () => {
    vi.mocked(listStudentWorkspaces).mockResolvedValue([
      { workspaceId: WORKSPACE.id, batchId: 5, batchCreatedAt: "2026-10-20 10:00:00", groupNo: 1, title: "第 1 组工作区" },
      { workspaceId: 80, batchId: 4, batchCreatedAt: "2026-10-10 10:00:00", groupNo: 1, title: "第 1 组工作区" },
    ]);
    const token = await signToken({ role: "student", uid: STUDENT_UID, name: "甲" });
    const history = await historyGet(request("/api/shared/group/history", undefined, token));
    const body = await history.json();
    expect(body.currentWorkspaceId).toBe(WORKSPACE.id);
    expect(body.workspaces.map((w: { isCurrent: boolean }) => w.isCurrent)).toEqual([true, false]);

    vi.mocked(getGroupUnreadCount).mockResolvedValue(2);
    const unread = await unreadGet(request("/api/shared/group/unread", undefined, token));
    expect(await unread.json()).toEqual({ unreadCount: 2 });
  });
});
