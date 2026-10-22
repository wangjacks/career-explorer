import type { GroupPostRow, GroupTaskRow } from "@/lib/db";
import { isTaskOverdue } from "@/lib/group-workspace";

/** 公告的下发形状（不含软删字段；界面只需要展示与操作所需的最小集） */
export interface GroupPostView {
  id: number;
  title: string;
  content: string;
  authorName: string | null;
  authorRole: string | null;
  pinned: boolean;
  createdAt: string;
}

export function toGroupPostView(row: GroupPostRow): GroupPostView {
  return {
    id: row.id,
    title: row.title,
    content: row.content,
    authorName: row.author_name,
    authorRole: row.author_role,
    pinned: row.pinned === 1,
    createdAt: row.created_at,
  };
}

/** 任务的下发形状：`overdue` 由服务端按 Asia/Shanghai 当前时间算好，界面不各写一套 */
export interface GroupTaskView {
  id: number;
  title: string;
  description: string | null;
  assigneeId: number | null;
  assigneeName: string | null;
  status: GroupTaskRow["status"];
  dueAt: string | null;
  createdAt: string;
  completedAt: string | null;
  overdue: boolean;
}

export function toGroupTaskView(row: GroupTaskRow, now: string): GroupTaskView {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    assigneeId: row.assignee_id,
    assigneeName: row.assignee_name,
    status: row.status,
    dueAt: row.due_at,
    createdAt: row.created_at,
    completedAt: row.completed_at,
    overdue: row.status !== "done" && isTaskOverdue(row.due_at, now),
  };
}
