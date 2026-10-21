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
  demoAccountCodes,
  parseDemoSeq,
  visitorSeqOf,
  assertVisitorSeq,
  VISITOR_SEQ_START,
  VISITOR_SEQ_MAX,
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

describe("访客账户号段与 seq 解析（#278）", () => {
  it("同一 seq 派生三角色编号（admin/teacher/student）", () => {
    expect(demoAccountCodes(1000)).toEqual({
      admin: "91000",
      teacher: "99001000",
      student: "900000001000",
    });
    expect(demoAccountCodes(VISITOR_SEQ_MAX).admin).toBe("99999");
  });

  it("三角色编号可往返解析出 role/seq", () => {
    for (const seq of [VISITOR_SEQ_START, 1001, VISITOR_SEQ_MAX]) {
      const codes = demoAccountCodes(seq);
      expect(parseDemoSeq(codes.admin)).toEqual({ role: "admin", seq });
      expect(parseDemoSeq(codes.teacher)).toEqual({ role: "teacher", seq });
      expect(parseDemoSeq(codes.student)).toEqual({ role: "student", seq });
    }
  });

  it("visitorSeqOf 只认访客号段；名册（seq<1000）与生产编号均排除", () => {
    expect(visitorSeqOf(demoAccountCodes(VISITOR_SEQ_START).student)).toBe(VISITOR_SEQ_START);
    // #253 名册学生 seq 1..20 / 教师 seq 1 均不属访客号段
    expect(visitorSeqOf(nextDemoStudentCode(1))).toBeNull();
    expect(visitorSeqOf(nextDemoStudentCode(20))).toBeNull();
    expect(visitorSeqOf(nextDemoTeacherCode(1))).toBeNull();
    expect(visitorSeqOf(nextDemoAdminCode(1))).toBeNull();
    // 生产编号形态（不以 9 开头 / 长度不匹配）
    expect(parseDemoSeq("10001")).toBeNull();
    expect(parseDemoSeq("202501010001")).toBeNull();
    expect(parseDemoSeq("")).toBeNull();
    expect(parseDemoSeq(undefined as unknown as string)).toBeNull();
  });

  it("assertVisitorSeq 拒绝越界与非法值", () => {
    expect(() => assertVisitorSeq(VISITOR_SEQ_START)).not.toThrow();
    expect(() => assertVisitorSeq(VISITOR_SEQ_MAX)).not.toThrow();
    for (const bad of [VISITOR_SEQ_START - 1, VISITOR_SEQ_MAX + 1, 1, 1.5, NaN]) {
      expect(() => assertVisitorSeq(bad)).toThrow(/访客演示序号非法/);
    }
  });

  it("相邻 seq 的三角色编号互不相等（无碰撞）", () => {
    const a = demoAccountCodes(1000);
    const b = demoAccountCodes(1001);
    expect(new Set([a.admin, a.teacher, a.student, b.admin, b.teacher, b.student]).size).toBe(6);
  });
});
