import { describe, it, expect } from "vitest";
import type { UserRow } from "@/lib/db";
import { toStudentListItem, toTeacherListItem } from "@/lib/user-projection";

const STUDENT_ROW: UserRow = {
  id: 7,
  user_code: "202505050101",
  password_hash: "bcrypt-hash-should-never-leak",
  role: "student",
  name: "测试学生",
  class_id: 3,
  tags: '["阅读","编程"]',
  avatar_url: "/api/uploads/avatar.jpg",
  evaluation_url: "/api/uploads/evaluation.jpg",
  evaluation_text: '["评价一","评价二","评价三"]',
  submitted_at: "2026-10-01 10:00:00",
  created_at: "2026-09-01 09:00:00",
  storage_id: 1,
};

const TEACHER_ROW: UserRow = {
  ...STUDENT_ROW,
  id: 8,
  user_code: "20250001",
  role: "teacher",
  name: "测试教师",
  class_id: null,
  submitted_at: null,
};

describe("管理端用户列表投影（#358）", () => {
  it("学生列表只保留前端需要的字段，不泄露密码哈希与档案字段", () => {
    const item = toStudentListItem(STUDENT_ROW);

    expect(item).toStrictEqual({
      id: 7,
      user_code: "202505050101",
      name: "测试学生",
      class_id: 3,
      created_at: "2026-09-01 09:00:00",
      submitted_at: "2026-10-01 10:00:00",
    });
    expect(Object.keys(item)).toStrictEqual([
      "id",
      "user_code",
      "name",
      "class_id",
      "created_at",
      "submitted_at",
    ]);
    expect(JSON.stringify(item)).not.toContain("password_hash");
  });

  it("教师列表只保留编号/姓名/创建时间", () => {
    const item = toTeacherListItem(TEACHER_ROW);

    expect(item).toStrictEqual({
      id: 8,
      user_code: "20250001",
      name: "测试教师",
      created_at: "2026-09-01 09:00:00",
    });
    expect(Object.keys(item)).toStrictEqual(["id", "user_code", "name", "created_at"]);
    expect(JSON.stringify(item)).not.toContain("password_hash");
  });
});
