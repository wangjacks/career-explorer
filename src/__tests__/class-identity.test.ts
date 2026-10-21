import { describe, it, expect } from "vitest";
import {
  RESERVED_CLASS_NAMES,
  UNASSIGNED_CLASS_KEY,
  UNASSIGNED_CLASS_LABEL,
  UNASSIGNED_CLASS_TEACHER_LABEL,
  isReservedClassName,
  isUnassignedClassKey,
  toClassGroup,
} from "../lib/class-identity";

describe("toClassGroup（#260 统计分组身份）", () => {
  it("NULL / 悬空班级归哨兵键，展示为未分班", () => {
    expect(toClassGroup(null, null)).toEqual({
      key: UNASSIGNED_CLASS_KEY,
      label: UNASSIGNED_CLASS_LABEL,
    });
    expect(toClassGroup(undefined, undefined)).toEqual({
      key: UNASSIGNED_CLASS_KEY,
      label: UNASSIGNED_CLASS_LABEL,
    });
    expect(toClassGroup(3, null)).toEqual({
      key: UNASSIGNED_CLASS_KEY,
      label: UNASSIGNED_CLASS_LABEL,
    });
    expect(toClassGroup("", "一班")).toEqual({
      key: UNASSIGNED_CLASS_KEY,
      label: UNASSIGNED_CLASS_LABEL,
    });
  });

  it("真实班级的 key 与 label 都是班名；数字/字符串 id 行为一致", () => {
    expect(toClassGroup(7, "一班")).toEqual({ key: "一班", label: "一班" });
    expect(toClassGroup("7", "一班")).toEqual({ key: "一班", label: "一班" });
    expect(toClassGroup(3, "未分班")).toEqual({ key: "未分班", label: "未分班" });
  });
});

describe("isUnassignedClassKey", () => {
  it("只认哨兵键，不认展示文案", () => {
    expect(isUnassignedClassKey(UNASSIGNED_CLASS_KEY)).toBe(true);
    expect(isUnassignedClassKey(UNASSIGNED_CLASS_LABEL)).toBe(false);
    expect(isUnassignedClassKey("一班")).toBe(false);
  });
});

describe("isReservedClassName", () => {
  it("哨兵键与管理端/教师端展示文案都保留", () => {
    for (const name of RESERVED_CLASS_NAMES) {
      expect(isReservedClassName(name)).toBe(true);
    }
    expect(isReservedClassName(UNASSIGNED_CLASS_TEACHER_LABEL)).toBe(true);
  });

  it("近似名不算保留（归一化由 validateNewClassName 负责）", () => {
    expect(isReservedClassName("未分班2")).toBe(false);
    expect(isReservedClassName("还没分班 ")).toBe(false);
    expect(isReservedClassName("")).toBe(false);
  });
});
