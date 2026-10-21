import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";
import { IPIP_NEO_FFI_CODE, RIASEC_CODE } from "../lib/assessment-data";

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
    const { dbPath, adapter, assessment, classA, classB, students } = setup();
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
    expect(
      stats.classTypes
        .map((row) => `${row.class_id}:${row.key}:${row.count}`)
        .sort()
    ).toEqual(
      [
        `${classA}:R:1`,
        `${classA}:S:1`,
        `${classB}:A:1`,
      ].sort()
    );

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

  it("classId 单班过滤：总量、班级和班级六型构成都只含该班", () => {
    const { dbPath, adapter, assessment, classB } = setup();
    const stats = adapter.getAssessmentStats(assessment.id, null, classB);

    expect(stats.classes).toEqual([
      { class_id: classB, name: "2025级2班", enrolled: 2, assessed: 1 },
    ]);
    expect(stats.total).toMatchObject({ enrolled: 2, assessed: 1 });
    expect(stats.types).toEqual([{ key: "A", count: 1 }]);
    expect(stats.codes).toEqual([{ code: "ASE", count: 1 }]);
    expect(stats.classTypes).toEqual([{ class_id: classB, key: "A", count: 1 }]);

    adapter.close();
    cleanup(dbPath);
  });

  it("空班级集合（教师还没带班）返回全零，不会退回全校口径", () => {
    const { dbPath, adapter, assessment } = setup();
    const stats = adapter.getAssessmentStats(assessment.id, []);
    expect(stats).toEqual({
      classes: [],
      types: [],
      classTypes: [],
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

/**
 * #310 完成矩阵的原始计数：档案提交 + 两套量表完成人数。
 * 场景与上面相同，另加 IPIP 完成记录与档案提交状态；分组键必须是 class_id，
 * 班名只用于展示（改名后仍归同一行）。
 */
function setupCompletion() {
  const dbPath = makeTmpDb();
  const adapter = new SqliteAdapter(dbPath);
  adapter.init();
  const classA = adapter.insertClass("2025级1班", "INV-C-A");
  const classB = adapter.insertClass("2025级2班", "INV-C-B");
  const riasec = adapter.getAssessmentByCode(RIASEC_CODE)!;
  const ipip = adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)!;

  const insert = (user_code: string, name: string, class_id: number | null, role = "student") =>
    adapter.insertUser({ user_code, name, role, class_id });
  const jia = insert("202505050101", "甲", classA);
  const yi = insert("202505050102", "乙", classA);
  const bing = insert("202505050103", "丙", classA);
  const ding = insert("202505050201", "丁", classB);
  const wu = insert("202505050202", "戊", classB);
  const ji = insert("202505050301", "己", null);
  const teacher = insert("20001001", "王老师", null, "teacher");

  const storageId = adapter.getDefaultStorageBackend()!.id;
  const submit = (userCode: string) =>
    adapter.upsertSubmission(userCode, "[]", "", "", storageId);
  submit("202505050101");
  submit("202505050102");
  submit("202505050201");

  const complete = (userId: number, assessment: { id: number }, typeCode: string | null) =>
    adapter.completeAssessmentResult({
      userId,
      assessmentId: assessment.id,
      answersJson: "{}",
      itemsJson: "[]",
      scoresJson: SCORES,
      typeCode,
    });
  complete(jia, riasec, "SIA");
  complete(yi, riasec, "RIC");
  complete(ding, riasec, "ASE");
  complete(ji, riasec, "IAR");
  complete(teacher, riasec, "RIA");
  complete(jia, ipip, null);

  return { dbPath, adapter, classA, classB, riasec, ipip, students: { jia, yi, bing, ding, wu, ji, teacher } };
}

describe("班级完成矩阵原始计数（#310，真实 SQLite）", () => {
  it("按 class_id 分组：档案提交 + 两套量表完成人数；教师账号不计入", () => {
    const { dbPath, adapter, classA, classB, riasec, ipip } = setupCompletion();
    const stats = adapter.getCompletionStats([riasec.id, ipip.id], null);

    expect(stats.profile).toHaveLength(3);
    const profile = new Map(stats.profile.map((row) => [row.class_id, row]));
    expect(profile.get(classA)).toEqual({
      class_id: classA,
      name: "2025级1班",
      enrolled: 3,
      submitted: 2,
    });
    expect(profile.get(classB)).toEqual({
      class_id: classB,
      name: "2025级2班",
      enrolled: 2,
      submitted: 1,
    });
    expect(profile.get(null)).toEqual({
      class_id: null,
      name: null,
      enrolled: 1,
      submitted: 0,
    });

    const assessed = new Map(
      stats.assessments.map((row) => [`${row.assessment_id}:${row.class_id}`, row.assessed])
    );
    expect(assessed.get(`${riasec.id}:${classA}`)).toBe(2);
    expect(assessed.get(`${riasec.id}:${classB}`)).toBe(1);
    // 未分班只数学生「己」；教师本人的完成记录被 role 过滤掉
    expect(assessed.get(`${riasec.id}:null`)).toBe(1);
    expect(assessed.get(`${ipip.id}:${classA}`)).toBe(1);
    expect(stats.assessments).toHaveLength(4);

    adapter.close();
    cleanup(dbPath);
  });

  it("classIds 收窄只返回这些班；空集合直接返回空计数", () => {
    const { dbPath, adapter, classA, riasec, ipip } = setupCompletion();

    const scoped = adapter.getCompletionStats([riasec.id, ipip.id], [classA]);
    expect(scoped.profile).toEqual([
      { class_id: classA, name: "2025级1班", enrolled: 3, submitted: 2 },
    ]);
    expect(
      [...scoped.assessments].sort((a, b) => a.assessment_id - b.assessment_id)
    ).toEqual([
      { assessment_id: riasec.id, class_id: classA, assessed: 2 },
      { assessment_id: ipip.id, class_id: classA, assessed: 1 },
    ]);

    expect(adapter.getCompletionStats([riasec.id], [])).toEqual({
      profile: [],
      assessments: [],
    });

    adapter.close();
    cleanup(dbPath);
  });

  it("assessmentIds 为空时只返回档案段", () => {
    const { dbPath, adapter } = setupCompletion();
    const stats = adapter.getCompletionStats([], null);
    expect(stats.profile).toHaveLength(3);
    expect(stats.assessments).toEqual([]);
    adapter.close();
    cleanup(dbPath);
  });

  it("班级改名后仍按 class_id 归行，不串到同名/新名班级", () => {
    const { dbPath, adapter, classA, riasec } = setupCompletion();
    adapter.updateClass(classA, { name: "2025级1班（改名）" });

    const stats = adapter.getCompletionStats([riasec.id], null);
    expect(stats.profile).toHaveLength(3);
    expect(stats.profile.find((row) => row.class_id === classA)?.name).toBe(
      "2025级1班（改名）"
    );
    expect(
      stats.assessments.find(
        (row) => row.class_id === classA && row.assessment_id === riasec.id
      )?.assessed
    ).toBe(2);

    adapter.close();
    cleanup(dbPath);
  });

  it("只有草稿的学生不算已完成", () => {
    const { dbPath, adapter, classA, riasec, students } = setupCompletion();
    adapter.upsertAssessmentDraft(students.bing, riasec.id, "{}", "[]");

    const stats = adapter.getCompletionStats([riasec.id], [classA]);
    expect(stats.assessments[0]).toEqual({
      assessment_id: riasec.id,
      class_id: classA,
      assessed: 2,
    });

    adapter.close();
    cleanup(dbPath);
  });
});

describe("教师端未完成名册（#313，真实 SQLite）", () => {
  it("以在册学生为基准：只列没有当前有效完成记录的人，只有草稿的仍算未完成，教师账号不出现", () => {
    const { dbPath, adapter, assessment, students } = setup();

    // 甲/乙/丁/己已完成；丙、戊没交；教师自己也有一份完成结果
    const before = adapter.getAssessmentMissingRoster(assessment.id, null);
    expect(before.map((row) => row.user_code)).toEqual([
      "202505050103", // 丙（2025级1班）
      "202505050202", // 戊（2025级2班）
    ]);
    expect(before.every((row) => row.class_name !== null)).toBe(true);
    expect(before.some((row) => row.name === "王老师")).toBe(false);
    expect(before.some((row) => row.name === "己")).toBe(false); // 未分班但已测

    // 只有草稿：NOT EXISTS 判的是 completed + is_current，草稿不能把人从名单里抹掉
    adapter.upsertAssessmentDraft(students.bing, assessment.id, JSON.stringify({ 1: 5 }), "[]");
    const after = adapter.getAssessmentMissingRoster(assessment.id, null);
    expect(after.map((row) => row.user_code)).toEqual(before.map((row) => row.user_code));

    // 完成过的学生不会因为「有草稿」重复出现在两个名单里
    expect(
      adapter.getAssessmentRoster(assessment.id, null).map((row) => row.user_code)
    ).not.toContain("202505050103");

    adapter.close();
    cleanup(dbPath);
  });

  it("班级范围与 classId 收窄：教师空集合直接空名单，classId 只出该班未完成的人", () => {
    const { dbPath, adapter, assessment, classA, classB } = setup();

    expect(adapter.getAssessmentMissingRoster(assessment.id, [classA]).map((row) => row.name)).toEqual(["丙"]);
    expect(adapter.getAssessmentMissingRoster(assessment.id, []).map((row) => row.name)).toEqual([]);

    expect(
      adapter.getAssessmentMissingRoster(assessment.id, null, { classId: classB }).map((row) => row.name)
    ).toEqual(["戊"]);

    // 已完成学生不会混进未完成名单（按结果表反证）
    expect(adapter.getAssessmentMissingRoster(assessment.id, [classA]).map((row) => row.user_code)).toEqual([
      "202505050103",
    ]);

    adapter.close();
    cleanup(dbPath);
  });
});

describe("人格分布逐人快照（#312，真实 SQLite）", () => {
  function completeBigFive(adapter: SqliteAdapter, userId: number, assessmentId: number, scoresJson: string) {
    adapter.completeAssessmentResult({
      userId,
      assessmentId,
      answersJson: "{}",
      itemsJson: "[]",
      scoresJson,
      typeCode: null,
    });
  }

  it("只取三列、只含 completed + is_current 的学生，并按班级收窄", () => {
    const { dbPath, adapter, classA, students } = setup();
    const ipip = adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)!;
    const scores = JSON.stringify(
      ["N", "E", "O", "A", "C"].map((key) => ({ key, label: key, standard: 50, band: "medium" }))
    );

    completeBigFive(adapter, students.jia, ipip.id, scores);
    completeBigFive(adapter, students.yi, ipip.id, scores);
    completeBigFive(adapter, students.ji, ipip.id, scores);
    // 教师账号也有结果，但教师不是学生，不能计入班级分布
    completeBigFive(adapter, students.teacher, ipip.id, scores);
    // 只有草稿的学生仍算未完成
    adapter.upsertAssessmentDraft(students.bing, ipip.id, JSON.stringify({ 1: 5 }), "[]");

    const all = adapter.getDimensionalResultScores(ipip.id, null);
    expect(all.map((row) => row.user_id)).toEqual([students.jia, students.yi, students.ji].sort((a, b) => a - b));
    expect(all.map((row) => Object.keys(row).sort())).toEqual([
      ["completed_at", "scores_json", "user_id"],
      ["completed_at", "scores_json", "user_id"],
      ["completed_at", "scores_json", "user_id"],
    ]);
    expect(all.every((row) => row.scores_json === scores)).toBe(true);

    expect(adapter.getDimensionalResultScores(ipip.id, [classA]).map((row) => row.user_id)).toEqual(
      [students.jia, students.yi].sort((a, b) => a - b)
    );
    expect(adapter.getDimensionalResultScores(ipip.id, [])).toEqual([]);

    adapter.close();
    cleanup(dbPath);
  });

  it("重测后只取当前有效版本（旧版本 is_current=0 不出现）", () => {
    const { dbPath, adapter, students } = setup();
    const ipip = adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)!;
    const first = JSON.stringify([{ key: "N", standard: 10, band: "low" }]);
    const second = JSON.stringify([{ key: "N", standard: 90, band: "high" }]);

    completeBigFive(adapter, students.jia, ipip.id, first);
    completeBigFive(adapter, students.jia, ipip.id, second);

    const rows = adapter.getDimensionalResultScores(ipip.id, null);
    expect(rows).toHaveLength(1);
    expect(rows[0].scores_json).toBe(second);

    adapter.close();
    cleanup(dbPath);
  });
});
