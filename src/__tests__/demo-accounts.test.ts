import { describe, it, expect } from "vitest";
import {
  mulberry32,
  nextDemoStudentCode,
  nextDemoTeacherCode,
  nextDemoAdminCode,
  buildDemoRoster,
  buildDemoTeacher,
  pickName,
  randInt,
  DEMO_PASSWORD,
  hashDemoPassword,
} from "@/lib/demo-accounts";

describe("演示账户原语（#253）", () => {
  it("号段编号满足既有校验位数与形态", () => {
    expect(nextDemoStudentCode(1)).toMatch(/^\d{12}$/); // activate.ts 学号 12 位
    expect(nextDemoStudentCode(1)).toBe("900000000001");
    expect(nextDemoTeacherCode(1)).toMatch(/^\d{8}$/); // 教师 8 位
    expect(nextDemoTeacherCode(1)).toBe("99000001");
    expect(nextDemoAdminCode(1)).toMatch(/^\d{5}$/); // 管理员 5 位
    expect(nextDemoAdminCode(1)).toBe("90001");
  });

  it("名册批量生成：数量正确、编号唯一、均为演示学生号段", () => {
    const rng = mulberry32(42);
    const roster = buildDemoRoster(20, rng);
    expect(roster).toHaveLength(20);
    expect(new Set(roster.map((s) => s.user_code)).size).toBe(20);
    for (const s of roster) {
      expect(s.user_code).toMatch(/^9\d{11}$/);
      expect(s.name.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("buildDemoTeacher 落在演示教师号段", () => {
    const t = buildDemoTeacher(1, mulberry32(7));
    expect(t.user_code).toBe("99000001");
  });

  it("mulberry32 同种子确定性、异种子不同", () => {
    const a = mulberry32(123);
    const b = mulberry32(123);
    const seqA = Array.from({ length: 5 }, () => a());
    const seqB = Array.from({ length: 5 }, () => b());
    expect(seqA).toEqual(seqB);
    const c = mulberry32(999);
    expect(Array.from({ length: 5 }, () => c())).not.toEqual(seqA);
  });

  it("randInt 落在闭区间，pickName 取姓+名", () => {
    const rng = mulberry32(2024);
    for (let i = 0; i < 200; i++) {
      const v = randInt(rng, 3, 7);
      expect(v).toBeGreaterThanOrEqual(3);
      expect(v).toBeLessThanOrEqual(7);
    }
    expect(pickName(rng).length).toBeGreaterThanOrEqual(2);
  });

  it("统一演示密码哈希为 bcrypt 形态", async () => {
    const hash = await hashDemoPassword();
    expect(DEMO_PASSWORD).toBe("demo1234");
    expect(hash.startsWith("$2")).toBe(true);
  });
});
