import { describe, it, expect } from "vitest";
import { validateActivation } from "@/lib/activate";

// 名单内未激活学生（教师导入产生，password_hash 为 NULL）
const rosterStudent = {
  role: "student",
  name: "张三",
  class_id: 1,
  password_hash: null,
};

describe("validateActivation（学生账户激活三要素校验）", () => {
  it("学号不在名单中 → not-in-roster", () => {
    expect(validateActivation(undefined, "张三", 1)).toBe("not-in-roster");
  });

  it("学号存在但非 student 角色 → not-in-roster（按不存在处理）", () => {
    expect(validateActivation({ ...rosterStudent, role: "teacher" }, "张三", 1)).toBe(
      "not-in-roster"
    );
  });

  it("已激活账户（password_hash 非空）→ already-activated", () => {
    expect(
      validateActivation({ ...rosterStudent, password_hash: "$2b$10$abc" }, "张三", 1)
    ).toBe("already-activated");
  });

  it("姓名与名单不一致 → mismatch", () => {
    expect(validateActivation(rosterStudent, "李四", 1)).toBe("mismatch");
  });

  it("邀请码班级与学号所属班级不一致 → mismatch", () => {
    expect(validateActivation(rosterStudent, "张三", 2)).toBe("mismatch");
  });

  it("未分班学生（class_id 为 null）无法匹配任何邀请码 → mismatch", () => {
    expect(validateActivation({ ...rosterStudent, class_id: null }, "张三", 1)).toBe(
      "mismatch"
    );
  });

  it("三要素一致（姓名含首尾空格容忍）→ 校验通过", () => {
    expect(validateActivation(rosterStudent, " 张三 ", 1)).toBeNull();
  });
});
