import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";
import { RIASEC_CODE } from "../lib/assessment-data";

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-assessment-stats-"));
  return path.join(dir, "test.db");
}

const SCORES = JSON.stringify([
  { key: "R", label: "现实型", questionCount: 5, answered: 5, raw: 20, minPossible: 5, maxPossible: 25, standard: 60 },
]);

/**
 * 场景：
 * - A 班（id=classA）3 名在册学生：甲（SIA）、乙（RIC）、丙（未答）
 * - B 班（id=classB）2 名在册学生：丁（ASE）、戊（未答）
 * - 1 名未分班学生：己（IAR）
 * - 另有 1 名教师账号也有一份完成结果（不应计入学生完成度）
 */
function setup() {
  const dbPath = makeTmpDb();
  const adapter = new SqliteAdapter(dbPath);
  adapter.init();
  const classA = adapter.insertClass("2025级1班", "INV-A-001");
  const classB = adapter.insertClass("2025级2班", "INV-B-002");
  const assessment = adapter.getAssessmentByCode(RIASEC_CODE)!;

  const insert = (user_code: string, name: string, class_id: number | null, role = "student") =>
    adapter.insertUser({ user_code, name, role, class_id });
  const jia = insert("202505050101", "甲", classA);
  const yi = insert("202505050102", "乙", classA);
  const bing = insert("202505050103", "丙", classA);
  const ding = insert("202505050201", "丁", classB);
  const wu = insert("202505050202", "戊", classB);
  const ji = insert("202505050301", "己", null);
  const teacher = insert("20001001", "王老师", null, "teacher");

  const complete = (userId: number, typeCode: string) =>
    adapter.completeAssessmentResult({
      userId,
      assessmentId: assessment.id,
      answersJson: "{}",
      // 本文件只测聚合口径，抽题快照给空数组（读作「整库即本轮」，#282）
      itemsJson: "[]",
      scoresJson: SCORES,
      typeCode,
    });
  complete(jia, "SIA");
  complete(yi, "RIC");
  complete(ding, "ASE");
  complete(ji, "IAR");
  complete(teacher, "RIA");

  return { dbPath, adapter, assessment, classA, classB, students: { jia, yi, bing, ding, wu, ji, teacher } };
}

function cleanup(dbPath: string) {
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

describe("教师端测评聚合（#229，真实 SQLite）", () => {
  it("班级完成度/总数：未测评计入分母，未分班学生计入总数，完成率不超 100%", () => {
    const { dbPath, adapter, assessment, classA, classB } = setup();
    const stats = adapter.getAssessmentStats(assessment.id, null);

    expect(stats.classes).toEqual([
      { class_id: classA, name: "2025级1班", enrolled: 3, assessed: 2 },
      { class_id: classB, name: "2025级2班", enrolled: 2, assessed: 1 },
    ]);
    // 在册学生 6 人（含 1 名未分班）；已完成 4 人（教师账号的结果不计入）
    expect(stats.total).toMatchObject({ enrolled: 6, assessed: 4 });

    adapter.close();
    cleanup(dbPath);
  });

  it("六型计数按三字码首位归型，与逐人当前结果核对一致", () => {
    const { dbPath, adapter, assessment, students } = setup();
    const stats = adapter.getAssessmentStats(assessment.id, null);
    const typeCount = new Map(stats.types.map((row) => [row.key, row.count]));
    expect(typeCount.get("S")).toBe(1); // 甲 SIA
    expect(typeCount.get("R")).toBe(1); // 乙 RIC
    expect(typeCount.get("A")).toBe(1); // 丁 ASE
    expect(typeCount.get("I")).toBe(1); // 己 IAR
    expect(typeCount.get("E")).toBeUndefined(); // 无归型就无该键（补 0 在 finalize 层）
    expect(typeCount.get("C")).toBeUndefined();

    // 逐人核对：每个学生当前结果的三字码首位累加起来必须与聚合一致（验收第 1 条）
    const recount: Record<string, number> = {};
    for (const uid of [students.jia, students.yi, students.ding, students.ji]) {
      const current = adapter.getCurrentAssessmentResult(uid, assessment.id)!;
      const lead = current.type_code!.slice(0, 1);
      recount[lead] = (recount[lead] ?? 0) + 1;
    }
    for (const [lead, count] of Object.entries(recount)) {
      expect(typeCount.get(lead)).toBe(count);
    }

    adapter.close();
    cleanup(dbPath);
  });

  it("三字码计数含并列，且最近完成时间取当前有效结果的最大值", () => {
    const { dbPath, adapter, assessment, students } = setup();
    const stats = adapter.getAssessmentStats(assessment.id, null);
    expect(stats.codes).toHaveLength(4);
    expect(stats.codes.map((row) => row.code).sort()).toEqual(["ASE", "IAR", "RIC", "SIA"]);

    const completed = [students.jia, students.yi, students.ding, students.ji]
      .map((uid) => adapter.getCurrentAssessmentResult(uid, assessment.id)!.completed_at!)
      .sort();
    expect(stats.total.last_completed_at).toBe(completed[completed.length - 1]);

    adapter.close();
    cleanup(dbPath);
  });

  it("草稿、非当前版本、非学生账号都不计入聚合", () => {
    const { dbPath, adapter, assessment, students } = setup();

    // 草稿（未完成）不算完成：丙只存了草稿
    adapter.upsertAssessmentDraft(students.bing, assessment.id, JSON.stringify({ 1: 5 }), "[]");
    adapter.upsertAssessmentDraft(students.wu, assessment.id, JSON.stringify({ 1: 4 }), "[]");
    // 同一学生连续完成两次 → 旧版本 is_current = 0，只计当前一次（且只记当前三字码 RIA）
    const completeAgain = (userId: number, typeCode: string) =>
      adapter.completeAssessmentResult({
        userId,
        assessmentId: assessment.id,
        answersJson: "{}",
        itemsJson: "[]",
        scoresJson: SCORES,
        typeCode,
      });
    completeAgain(students.bing, "SEC");
    completeAgain(students.bing, "RIA");
    // 非学生账号（管理员）完成也不计入学生完成度
    const admin = adapter.insertUser({ user_code: "10001", name: "管理员", role: "admin" });
    completeAgain(admin, "SEC");

    const stats = adapter.getAssessmentStats(assessment.id, null);
    // 在册 6 人；完成 5 人（甲、乙、丁、己、丙——丙只算当前一次；管理员不算）
    expect(stats.total).toMatchObject({ enrolled: 6, assessed: 5 });
    const codes = stats.codes.map((row) => row.code).sort();
    expect(codes).toEqual(["ASE", "IAR", "RIA", "RIC", "SIA"]);
    // 被替换掉的旧版本 SEC 不出现；草稿不计型
    expect(stats.codes.some((row) => row.code === "SEC")).toBe(false);
    expect(stats.types.find((row) => row.key === "C")).toBeUndefined();
    expect(stats.types.find((row) => row.key === "R")?.count).toBe(2);

    adapter.close();
    cleanup(dbPath);
  });

  it("班级范围收窄：只统计指定班级的学生（不含未分班学生）", () => {
    const { dbPath, adapter, assessment, classA } = setup();
    const stats = adapter.getAssessmentStats(assessment.id, [classA]);
    expect(stats.classes).toHaveLength(1);
    expect(stats.classes[0]).toMatchObject({ name: "2025级1班", enrolled: 3, assessed: 2 });
    expect(stats.total).toMatchObject({ enrolled: 3, assessed: 2 });
    expect(stats.codes.map((row) => row.code).sort()).toEqual(["RIC", "SIA"]);
    expect(stats.types.map((row) => row.key).sort()).toEqual(["R", "S"]);

    adapter.close();
    cleanup(dbPath);
  });

  it("空班级集合（教师还没带班）返回全零，不会退回全校口径", () => {
    const { dbPath, adapter, assessment } = setup();
    const stats = adapter.getAssessmentStats(assessment.id, []);
    expect(stats).toEqual({
      classes: [],
      types: [],
      codes: [],
      total: { enrolled: 0, assessed: 0, last_completed_at: null },
    });

    adapter.close();
    cleanup(dbPath);
  });
});

describe("教师端测评名册（#229，真实 SQLite）", () => {
  it("返回姓名/学号/三字码/完成时间，按班级名 + 学号稳定排序；未分班单列", () => {
    const { dbPath, adapter, assessment } = setup();
    const rows = adapter.getAssessmentRoster(assessment.id, null);
    expect(rows.map((row) => row.user_code)).toEqual([
      "202505050301", // 未分班（class_name 为 null，排最前）
      "202505050101",
      "202505050102",
      "202505050201",
    ]);
    expect(rows[0]).toMatchObject({ class_id: null, class_name: null, name: "己", code: "IAR" });
    expect(rows[1]).toMatchObject({ name: "甲", code: "SIA" });
    expect(rows.every((row) => row.assessed_at.length > 0)).toBe(true);

    adapter.close();
    cleanup(dbPath);
  });

  it("按班级 / 三字码首位过滤，且不返回未完成学生", () => {
    const { dbPath, adapter, assessment, classA, classB } = setup();

    const classARows = adapter.getAssessmentRoster(assessment.id, null, { classId: classA });
    expect(classARows.map((row) => row.user_code)).toEqual(["202505050101", "202505050102"]);
    expect(classARows.some((row) => row.code === null)).toBe(false);

    const classBRows = adapter.getAssessmentRoster(assessment.id, null, { classId: classB });
    expect(classBRows.map((row) => row.name)).toEqual(["丁"]);

    const artistic = adapter.getAssessmentRoster(assessment.id, null, { lead: "A" });
    expect(artistic.map((row) => row.code)).toEqual(["ASE"]);

    // 教师范围（只带 A 班）时不传 classId 也只看 A 班
    expect(adapter.getAssessmentRoster(assessment.id, [classA]).map((row) => row.user_code)).toEqual([
      "202505050101",
      "202505050102",
    ]);

    adapter.close();
    cleanup(dbPath);
  });

  it("按完整三字码精确过滤（#232 胶囊下钻），且可与班级 / 首位条件叠加", () => {
    const { dbPath, adapter, assessment, classA } = setup();

    const sia = adapter.getAssessmentRoster(assessment.id, null, { code: "SIA" });
    expect(sia.map((row) => row.name)).toEqual(["甲"]);
    expect(sia.every((row) => row.code === "SIA")).toBe(true);

    // 精确码与首位是「且」关系：SIA 属于 S 型，但 RIC 不属于 S
    expect(adapter.getAssessmentRoster(assessment.id, null, { lead: "S", code: "SIA" }).map((row) => row.name)).toEqual(["甲"]);
    expect(adapter.getAssessmentRoster(assessment.id, null, { lead: "S", code: "RIC" })).toEqual([]);

    // 与班级条件叠加：A 班里没有 ASE（ASE 在 B 班）
    expect(
      adapter.getAssessmentRoster(assessment.id, null, { classId: classA, code: "SIA" }).map((row) => row.name)
    ).toEqual(["甲"]);
    expect(adapter.getAssessmentRoster(assessment.id, null, { classId: classA, code: "ASE" })).toEqual([]);

    // 教师范围（只带 A 班）同样生效
    expect(adapter.getAssessmentRoster(assessment.id, [classA], { code: "RIC" }).map((row) => row.name)).toEqual(["乙"]);

    adapter.close();
    cleanup(dbPath);
  });
});
