import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";
import type { BackupData, NewGroupBatchInput } from "../lib/db";

const tmpDirs: string[] = [];
let classSeq = 0;

function makeTmpAdapter(): { adapter: SqliteAdapter; dir: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "career-ws-test-"));
  tmpDirs.push(dir);
  const adapter = new SqliteAdapter(path.join(dir, "test.db"));
  adapter.init();
  return { adapter, dir };
}

afterEach(() => {
  classSeq = 0;
  while (tmpDirs.length) {
    const dir = tmpDirs.pop() as string;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 上 sqlite 句柄偶发未释放；清理失败不影响断言
    }
  }
});

function seedClass(adapter: SqliteAdapter, name: string, count: number) {
  classSeq += 1;
  const seq = classSeq;
  const classId = adapter.insertClass(name, `WCODE${seq}`) as number;
  const ids: number[] = [];
  const codes: string[] = [];
  for (let i = 1; i <= count; i++) {
    const code = `2026${String(seq).padStart(2, "0")}${String(i).padStart(6, "0")}`;
    codes.push(code);
    ids.push(adapter.insertUser({ user_code: code, role: "student", name: `学生${i}`, class_id: classId }));
  }
  return { classId, ids, codes };
}

function batchInput(
  classId: number,
  groups: { id: number; code: string; name: string }[][],
  strategy = "interest-role-v1"
): NewGroupBatchInput {
  return {
    classId,
    strategy,
    featureSources: JSON.stringify([{ key: "tags", kind: "set", weight: 1 }]),
    groupSize: 5,
    studentCount: groups.flat().length,
    taggedCount: groups.flat().length,
    metrics: JSON.stringify({ overall: 0.5 }),
    actorId: null,
    actorName: "教师",
    actorRole: "teacher",
    groups: groups.map((members, index) => ({
      groupNo: index + 1,
      cohesion: 0.5,
      leaderUserId: null,
      members: members.map((m) => ({ userId: m.id, userCode: m.code, name: m.name })),
    })),
  };
}

function seedGrouped(adapter: SqliteAdapter) {
  const { classId, ids, codes } = seedClass(adapter, "A", 4);
  const members = ids.map((id, i) => ({ id, code: codes[i], name: `学生${i + 1}` }));
  const batch = batchInput(classId, [members.slice(0, 2), members.slice(2)]);
  const batchId = adapter.applyGroupingResult(
    classId,
    [
      { group_no: 1, user_ids: [ids[0], ids[1]] },
      { group_no: 2, user_ids: [ids[2], ids[3]] },
    ],
    batch
  );
  return { classId, ids, codes, members, batchId };
}

describe("小组工作区（#346）：数据层", () => {
  it("应用分组时每个组各建一个工作区；学生/教师都能定位到本组工作区", () => {
    const { adapter } = makeTmpAdapter();
    const { classId, ids, batchId } = seedGrouped(adapter);

    const workspaces = adapter.getBatchWorkspaces(batchId);
    expect(workspaces.map((w) => w.group_no)).toEqual([1, 2]);
    expect(workspaces.map((w) => w.title)).toEqual(["第 1 组工作区", "第 2 组工作区"]);

    const studentContext = adapter.getStudentWorkspaceContext(ids[0]);
    expect(studentContext?.workspace.group_no).toBe(1);
    expect(studentContext?.workspace.id).toBe(workspaces[0].id);

    const teacherContext = adapter.getClassGroupWorkspace(classId, 2);
    expect(teacherContext?.workspace.id).toBe(workspaces[1].id);
    adapter.close();
  });

  it("重分组追加新批次 → 新工作区；旧批次内容保留且可回看", () => {
    const { adapter } = makeTmpAdapter();
    const { classId, ids, codes, members, batchId } = seedGrouped(adapter);
    const firstWorkspace = adapter.getStudentWorkspaceContext(ids[0])!.workspace;
    adapter.insertGroupPost({
      workspaceId: firstWorkspace.id,
      authorId: ids[0],
      authorName: "学生1",
      authorRole: "student",
      title: "旧批次公告",
      content: "重分组之后这条还要能回看",
    });

    // 再应用一次分组：成员互换，产生新批次
    const secondBatch = batchInput(classId, [members.slice(0, 2), members.slice(2)]);
    const secondBatchId = adapter.applyGroupingResult(
      classId,
      [
        { group_no: 1, user_ids: [ids[1], ids[0]] },
        { group_no: 2, user_ids: [ids[3], ids[2]] },
      ],
      secondBatch
    );
    expect(secondBatchId).not.toBe(batchId);
    const current = adapter.getStudentWorkspaceContext(ids[0])!;
    expect(current.workspace.batch_id).toBe(secondBatchId);
    expect(current.workspace.id).not.toBe(firstWorkspace.id);

    // 历史清单按新→旧返回两批，旧批次内容还能读到
    const history = adapter.listStudentWorkspaces(ids[0]);
    expect(history.map((h) => h.batchId)).toEqual([secondBatchId, batchId]);
    expect(adapter.listGroupPosts(firstWorkspace.id).map((p) => p.title)).toEqual(["旧批次公告"]);
    expect(codes.length).toBe(4);
    adapter.close();
  });

  it("公告：置顶排序、软删除、未读水位与频率统计", () => {
    const { adapter } = makeTmpAdapter();
    const { ids } = seedGrouped(adapter);
    const workspaceId = adapter.getStudentWorkspaceContext(ids[0])!.workspace.id;

    const first = adapter.insertGroupPost({
      workspaceId,
      authorId: ids[0],
      authorName: "学生1",
      authorRole: "student",
      title: "普通公告",
      content: "内容一",
    });
    const second = adapter.insertGroupPost({
      workspaceId,
      authorId: ids[0],
      authorName: "学生1",
      authorRole: "student",
      title: "置顶公告",
      content: "内容二",
    });

    expect(adapter.listGroupPosts(workspaceId).map((p) => p.id)).toEqual([second, first]);
    adapter.updateGroupPost(second, workspaceId, { pinned: 1 });
    expect(adapter.listGroupPosts(workspaceId).map((p) => p.id)).toEqual([second, first]);

    // 未读：没有水位时全部未读；标记已读后清零；之后新发的公告再次变为未读
    expect(adapter.getGroupUnreadCount(workspaceId, ids[1])).toBe(2);
    adapter.markGroupWorkspaceRead(workspaceId, ids[1]);
    expect(adapter.getGroupUnreadCount(workspaceId, ids[1])).toBe(0);
    const third = adapter.insertGroupPost({
      workspaceId,
      authorId: ids[0],
      authorName: "学生1",
      authorRole: "student",
      title: "新公告",
      content: "标记已读之后发的",
    });
    expect(adapter.getGroupUnreadCount(workspaceId, ids[1])).toBe(1);
    adapter.updateGroupPost(third, workspaceId, { deleted_at: "2026-10-01 00:00:00" });
    expect(adapter.getGroupUnreadCount(workspaceId, ids[1])).toBe(0);

    adapter.updateGroupPost(first, workspaceId, { deleted_at: "2026-10-01 00:00:00" });
    expect(adapter.listGroupPosts(workspaceId).map((p) => p.id)).toEqual([second]);

    expect(adapter.countRecentGroupPosts(workspaceId, ids[0], "2000-01-01 00:00:00")).toBe(3);
    adapter.close();
  });

  it("任务：原子认领只成功一次；完成与软删除后不再出现在列表", () => {
    const { adapter } = makeTmpAdapter();
    const { ids } = seedGrouped(adapter);
    const workspaceId = adapter.getStudentWorkspaceContext(ids[0])!.workspace.id;

    const taskId = adapter.insertGroupTask({
      workspaceId,
      title: "整理展示 PPT",
      description: null,
      assigneeId: null,
      assigneeName: null,
      dueAt: "2026-10-30 23:59:00",
      createdById: ids[0],
      createdByName: "学生1",
      createdByRole: "student",
    });
    expect(adapter.listGroupTasks(workspaceId)[0]).toMatchObject({ id: taskId, status: "open" });

    expect(adapter.claimGroupTask(taskId, workspaceId, ids[0], "学生1")).toBe(true);
    expect(adapter.claimGroupTask(taskId, workspaceId, ids[1], "学生2")).toBe(false);
    const claimed = adapter.getGroupTask(taskId, workspaceId)!;
    expect(claimed).toMatchObject({ status: "in_progress", assignee_id: ids[0], assignee_name: "学生1" });

    adapter.updateGroupTask(taskId, workspaceId, {
      status: "done",
      completed_at: "2026-10-23 10:00:00",
    });
    expect(adapter.getGroupTask(taskId, workspaceId)?.status).toBe("done");
    adapter.updateGroupTask(taskId, workspaceId, { deleted_at: "2026-10-23 11:00:00" });
    expect(adapter.listGroupTasks(workspaceId)).toEqual([]);
    expect(adapter.countRecentGroupTasks(workspaceId, ids[0], "2000-01-01 00:00:00")).toBe(1);
    adapter.close();
  });

  it("备份 v9 含工作区四表；恢复后公告/任务/已读都还在；缺字段的旧备份恢复为空", () => {
    const { adapter } = makeTmpAdapter();
    const { ids } = seedGrouped(adapter);
    const workspaceId = adapter.getStudentWorkspaceContext(ids[0])!.workspace.id;
    const postId = adapter.insertGroupPost({
      workspaceId,
      authorId: ids[0],
      authorName: "学生1",
      authorRole: "student",
      title: "公告",
      content: "内容",
    });
    adapter.insertGroupTask({
      workspaceId,
      title: "任务",
      description: null,
      assigneeId: null,
      assigneeName: null,
      dueAt: null,
      createdById: ids[0],
      createdByName: "学生1",
      createdByRole: "student",
    });
    adapter.markGroupWorkspaceRead(workspaceId, ids[1]);

    const dump = adapter.backup();
    expect(dump.version).toBe(9);
    expect(dump.group_workspaces?.length).toBe(2);
    expect(dump.group_posts?.length).toBe(1);
    expect(dump.group_tasks?.length).toBe(1);
    expect(dump.group_workspace_reads?.length).toBe(1);

    const { adapter: restored } = makeTmpAdapter();
    restored.restore(dump);
    expect(restored.listGroupPosts(workspaceId).map((p) => p.id)).toEqual([postId]);
    expect(restored.listGroupTasks(workspaceId).length).toBe(1);
    expect(restored.getGroupUnreadCount(workspaceId, ids[1])).toBe(0);
    expect(restored.getStudentWorkspaceContext(ids[0])?.workspace.id).toBe(workspaceId);

    const legacy = { ...dump } as BackupData;
    delete legacy.group_workspaces;
    delete legacy.group_posts;
    delete legacy.group_tasks;
    delete legacy.group_workspace_reads;
    restored.restore(legacy);
    expect(restored.getGroupWorkspaceById(workspaceId)).toBeUndefined();
    expect(restored.listGroupPosts(workspaceId)).toEqual([]);
    expect(restored.listGroupTasks(workspaceId)).toEqual([]);
    adapter.close();
    restored.close();
  });
});
