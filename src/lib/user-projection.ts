/**
 * 管理端用户列表的最小响应投影（#358）。
 * 学生/教师列表只暴露前端实际使用的字段；绝不直接展开 `UserRow`，
 * 尤其是 `password_hash`（教师可读全校学生名单，展开会泄露全校哈希）。
 */
import type { UserRow } from "./db";

export interface StudentListItem {
  id: number;
  user_code: string;
  name: string;
  class_id: number | null;
  created_at: string;
  submitted_at: string | null;
}

export interface TeacherListItem {
  id: number;
  user_code: string;
  name: string;
  created_at: string;
}

export function toStudentListItem(row: UserRow): StudentListItem {
  return {
    id: row.id,
    user_code: row.user_code,
    name: row.name,
    class_id: row.class_id,
    created_at: row.created_at,
    submitted_at: row.submitted_at,
  };
}

export function toTeacherListItem(row: UserRow): TeacherListItem {
  return {
    id: row.id,
    user_code: row.user_code,
    name: row.name,
    created_at: row.created_at,
  };
}
