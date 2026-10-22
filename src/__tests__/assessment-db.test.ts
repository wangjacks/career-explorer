import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../lib/db-sqlite";
import { scoreAssessment } from "../lib/assessment-scoring";
import { onetInterestCodeOf } from "../lib/onet";
import {
  IPIP_QUESTIONS,
  RIASEC_ASSESSMENT,
  RIASEC_CODE,
  RIASEC_QUESTIONS,
  RIASEC_DIMENSIONS,
  RIASEC_SCALE_VERSION,
  validateAssessmentSeed,
  type QuestionSeed,
} from "../lib/assessment-data";

/** 题库总量与每维题数（#281 起 120 / 20），测试里不写死数字 */
const BANK_SIZE = RIASEC_QUESTIONS.length;
const PER_DIMENSION = BANK_SIZE / RIASEC_DIMENSIONS.length;

/** 造一个「旧版 30 题库」：删掉 31–120，并把量表定义退回 Mini-IP-CN 1.0 */
function downgradeToLegacyBank(dbPath: string, assessmentId: number): void {
  const raw = new Database(dbPath);
  raw.prepare("DELETE FROM assessment_questions WHERE assessment_id = ? AND question_index > 30").run(assessmentId);
  raw.prepare(
    "UPDATE assessment_questions SET origin = 'cn-original' WHERE assessment_id = ? AND question_index <= 30"
  ).run(assessmentId);
  raw.prepare(
    // items_per_attempt = 0 是「#282 之前建的库补列后」的真实形态：列默认值 0 = 整库作答
    "UPDATE assessments SET question_count = 30, items_per_attempt = 0, scale_version = 'Mini-IP-CN 1.0', name = '霍兰德职业兴趣测评（Mini-IP 精简版）' WHERE id = ?"
  ).run(assessmentId);
  raw.close();
}


function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-assessment-"));
  return path.join(dir, "test.db");
}

/** 建好库 + 种子 + 一个学生，返回适配器与该学生 id */
function setup() {
  const dbPath = makeTmpDb();
  const adapter = new SqliteAdapter(dbPath);
  adapter.init();
  const studentId = adapter.insertUser({ user_code: "202505050101", role: "student", name: "张三" });
  const assessment = adapter.getAssessmentByCode(RIASEC_CODE)!;
  return { dbPath, adapter, studentId, assessment };
}

function cleanup(dbPath: string) {
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

describe("RIASEC 题库种子（#221 / #281 扩容到 120 题）", () => {
  it("首次安装预置 riasec 量表与 120 题，六个维度各 20 题", () => {
    const { dbPath, adapter, assessment } = setup();

    const enabled = adapter.getEnabledAssessments();
    expect(enabled).toHaveLength(2);
    const riasec = enabled.find((row) => row.code === RIASEC_CODE)!;
    expect(riasec.question_count).toBe(BANK_SIZE);
    expect(riasec.scoring_mode).toBe("typological");
    expect(riasec.scale_version).toBe(RIASEC_ASSESSMENT.scaleVersion);
    expect(RIASEC_ASSESSMENT.scaleVersion).toBe(RIASEC_SCALE_VERSION);
    expect(riasec.name).toContain("120 题库");
    // 「每次 30 题」属于学生侧题量文案，归 #283（抽题口径已落地，但量表名不预告题量）
    expect(riasec.name).not.toContain("每次 30 题");
    // #282：每次作答题数落库（0 = 整库作答）
    expect(riasec.items_per_attempt).toBe(RIASEC_ASSESSMENT.itemsPerAttempt);
    expect(riasec.items_per_attempt).toBe(30);

    // 维度定义 JSON：供计分引擎直接消费的 { key, label } 数组
    const dimensions = JSON.parse(assessment.dimensions_json) as { key: string; label: string }[];
    expect(dimensions.map((d) => d.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(dimensions.every((d) => d.label.length > 0)).toBe(true);

    const questions = adapter.getAssessmentQuestions(assessment.id);
    expect(questions).toHaveLength(BANK_SIZE);
    // 题号从 1 连续到 120（作答接口按题号存答案，跳号会让进度口径失真）
    expect(questions.map((q) => q.question_index)).toEqual(
      Array.from({ length: BANK_SIZE }, (_, i) => i + 1)
    );
    for (const question of questions) {
      expect(question.prompt.trim().length).toBeGreaterThan(0);
      expect(dimensionKeys()).toContain(question.dimension);
      // 本量表无反向计分题，字段照实写 0
      expect(question.reverse_scored).toBe(0);
      expect(question.version).toBe(1);
      expect(["onet-mini", "onet-sf", "cn-original"]).toContain(question.origin);
    }
    // 六型均衡：每型 20 题，否则标准分口径不可比
    for (const key of dimensionKeys()) {
      expect(questions.filter((q) => q.dimension === key)).toHaveLength(PER_DIMENSION);
    }
    // origin 分布：官方 Mini-IP 30 / 官方 SF 30 / 原创 60（1–30 / 31–60 / 61–120）
    expect(questions.filter((q) => q.origin === "onet-mini")).toHaveLength(30);
    expect(questions.filter((q) => q.origin === "onet-sf")).toHaveLength(30);
    expect(questions.filter((q) => q.origin === "cn-original")).toHaveLength(60);
    for (const question of questions) {
      const expectedOrigin =
        question.question_index <= 30 ? "onet-mini" : question.question_index <= 60 ? "onet-sf" : "cn-original";
      expect(question.origin).toBe(expectedOrigin);
    }

    // 题号 1–30 仍按 Mini-IP 报告建议的轮转顺序（R,I,A,S,E,C 循环），已授权题面一字未改
    const cycle = ["R", "I", "A", "S", "E", "C"];
    expect(questions.slice(0, 30).map((q) => q.dimension)).toEqual(
      Array.from({ length: 30 }, (_, i) => cycle[i % 6])
    );
    expect(questions[0].prompt).toBe("动手制作厨房橱柜");

    // 署名 / 授权 / 免责文本随记录可查出（O*NET 授权硬性要求）
    expect(assessment.attribution).toContain("O*NET");
    expect(assessment.attribution).toContain("U.S. Department of Labor");
    expect(assessment.license_text).toContain("USDOL/ETA");
    expect(assessment.license_text).toContain("O*NET Database");
    expect(assessment.disclaimer).toContain("不作为心理诊断");

    adapter.close();
    cleanup(dbPath);
  });

  it("种子幂等：重复 init 不重复插入，且不覆盖后台维护过的题面", () => {
    const { dbPath, adapter, assessment } = setup();

    adapter.init();
    expect(adapter.getAssessmentQuestions(assessment.id)).toHaveLength(BANK_SIZE);
    expect(adapter.getEnabledAssessments()).toHaveLength(2);

    // 模拟后台维护题面 + 停用：再次 init 不得覆盖
    const raw = new Database(dbPath);
    raw.prepare("UPDATE assessment_questions SET prompt = ? WHERE assessment_id = ? AND question_index = 1").run(
      "（已维护）动手制作厨房橱柜",
      assessment.id
    );
    raw.prepare("UPDATE assessments SET enabled = 0 WHERE id = ?").run(assessment.id);
    raw.close();

    adapter.init();
    expect(adapter.getAssessmentQuestions(assessment.id)[0].prompt).toBe("（已维护）动手制作厨房橱柜");
    expect(adapter.getEnabledAssessments()).toHaveLength(1);
    expect(adapter.getEnabledAssessments()[0].code).not.toBe(RIASEC_CODE);

    adapter.close();
    cleanup(dbPath);
  });

  it("按 code 取题库与按 id 取题库同口径；停用的量表仍可按 code 读取", () => {
    const { dbPath, adapter, assessment } = setup();

    const byCode = adapter.getAssessmentQuestionsByCode(RIASEC_CODE);
    expect(byCode).toEqual(adapter.getAssessmentQuestions(assessment.id));
    expect(adapter.getAssessmentQuestionsByCode("nope")).toEqual([]);
    // code 大小写归一化在边界做：SQLite 的 = 区分大小写、MySQL 不区分，两侧行为必须一致
    expect(adapter.getAssessmentByCode(" RIASEC ")?.id).toBe(assessment.id);
    expect(adapter.getAssessmentQuestionsByCode("RIASEC")).toHaveLength(BANK_SIZE);

    const raw = new Database(dbPath);
    raw.prepare("UPDATE assessments SET enabled = 0 WHERE id = ?").run(assessment.id);
    raw.close();
    expect(adapter.getEnabledAssessments()).toHaveLength(1);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.enabled).toBe(0);

    adapter.close();
    cleanup(dbPath);
  });

  it("题库为空时由 init 自愈补种，且不覆盖已维护的非空题库", () => {
    const { dbPath, adapter, assessment } = setup();

    // 模拟「量表行在、题库空」的残缺态（例如恢复了一份 question 数组为空的备份）
    const raw = new Database(dbPath);
    raw.exec("DELETE FROM assessment_questions");
    raw.close();
    expect(adapter.getAssessmentQuestions(assessment.id)).toHaveLength(0);

    adapter.init();
    expect(adapter.getAssessmentQuestions(assessment.id)).toHaveLength(BANK_SIZE);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.question_count).toBe(BANK_SIZE);

    // 补种之后就是「已维护」：改过的题面再 init 一次不会被覆盖
    const raw2 = new Database(dbPath);
    raw2.prepare("UPDATE assessment_questions SET prompt = ? WHERE assessment_id = ? AND question_index = 1").run(
      "（已维护）动手制作厨房橱柜",
      assessment.id
    );
    raw2.close();

    adapter.init();
    expect(adapter.getAssessmentQuestions(assessment.id)[0].prompt).toBe("（已维护）动手制作厨房橱柜");

    adapter.close();
    cleanup(dbPath);
  });

  it("种子自检：完整题库存得下，坏数据在落库前报错", () => {
    expect(() => validateAssessmentSeed(RIASEC_ASSESSMENT, RIASEC_QUESTIONS, onetInterestCodeOf)).not.toThrow();

    const caseOf = (mutate: (questions: QuestionSeed[]) => QuestionSeed[]) => {
      return () =>
        validateAssessmentSeed(RIASEC_ASSESSMENT, mutate(RIASEC_QUESTIONS.map((q) => ({ ...q }))), onetInterestCodeOf);
    };

    // #221 既有规则
    expect(caseOf((qs) => qs.slice(1))).toThrow(/题数与题库不符/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, index: 2 } : q)))).toThrow(/题号重复/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, index: 121 } : q)))).toThrow(/题号不连续/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, dimension: "X" } : q)))).toThrow(/未定义的维度/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, prompt: "  " } : q)))).toThrow(/题干为空/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, source: "" } : q)))).toThrow(/缺少英文原文/);

    // #281 新规则：每维题数相等（删掉一道 R 维原创题）
    expect(
      caseOf((qs) => qs.filter((q) => !(q.dimension === "R" && q.origin === "cn-original" && q.index === 61)))
    ).toThrow(/在用题数不相等|题数与题库不符/);
    // 维度题数相等但某维原创题不足 3 道（把 R 维 8 道原创题改成官方来源，只剩 2 道原创）
    expect(
      caseOf((qs) => qs.map((q) => (q.index >= 61 && q.index <= 68 ? { ...q, origin: "onet-sf" as const } : q)))
    ).toThrow(/原创题不足/);
    // 题干重复 / 长度越界 / 禁词
    expect(caseOf((qs) => qs.map((q, i) => (i === 1 ? { ...q, prompt: qs[0].prompt } : q)))).toThrow(/题干重复/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, prompt: "动手" } : q)))).toThrow(/汉字数/);
    expect(
      caseOf((qs) =>
        qs.map((q, i) =>
          i === 0
            ? { ...q, prompt: "动手制作厨房橱柜并安装台面柜门抽屉五金件以及全部其他相关配件和材料" }
            : q
        )
      )
    ).toThrow(/汉字数/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, prompt: "做一份月薪两万的工作" } : q)))).toThrow(
      /收入|学历|地位/
    );
    // 原创题缺 anchor / anchor 不在快照 / 维度不在兴趣高码前两位
    expect(caseOf((qs) => qs.map((q, i) => (i === 60 ? { ...q, anchor: undefined } : q)))).toThrow(/缺少锚定职业/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 60 ? { ...q, anchor: "不存在的职业" } : q)))).toThrow(
      /不在 O\*NET 快照中/
    );
    expect(
      caseOf((qs) =>
        qs.map((q, i) => (i === 60 ? { ...q, anchor: "Bookkeeping, Accounting, and Auditing Clerks" } : q))
      )
    ).toThrow(/兴趣高码/);
    // 近重复：把同维度另一题（54，未被近重复组覆盖）改成与 52 几乎一样的题面 → 必须被拦下
    expect(
      caseOf((qs) => {
        const target = qs.find((q) => q.index === 54)!;
        target.prompt = "管理一家零售门店的";
        return qs;
      })
    ).toThrow(/近重复/);
  });
});

describe("题库只增不改升级（#281）", () => {
  it("已有 30 题的库升级到 120 题：补题、回填 origin、更新量表定义", () => {
    const { dbPath, adapter, assessment } = setup();
    downgradeToLegacyBank(dbPath, assessment.id);
    expect(adapter.getAssessmentQuestions(assessment.id)).toHaveLength(30);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.question_count).toBe(30);

    const result = adapter.upgradeAssessmentBank();
    expect(result).toEqual({
      inserted: 90,
      originBackfilled: 30,
      definitionUpdated: true,
      licenseTextUpdated: false,
      itemsPerAttemptUpdated: true,
    });

    const questions = adapter.getAssessmentQuestions(assessment.id);
    expect(questions).toHaveLength(BANK_SIZE);
    expect(questions.filter((q) => q.origin === "onet-mini")).toHaveLength(30);
    expect(questions.filter((q) => q.origin === "onet-sf")).toHaveLength(30);
    expect(questions.filter((q) => q.origin === "cn-original")).toHaveLength(60);
    // 题号 1–30 的题面与维度一个字都没动
    for (const seed of RIASEC_QUESTIONS.slice(0, 30)) {
      const row = questions.find((q) => q.question_index === seed.index)!;
      expect(row.prompt).toBe(seed.prompt);
      expect(row.dimension).toBe(seed.dimension);
    }
    const definition = adapter.getAssessmentByCode(RIASEC_CODE)!;
    expect(definition.question_count).toBe(BANK_SIZE);
    expect(definition.scale_version).toBe(RIASEC_SCALE_VERSION);
    expect(definition.name).toContain("120 题库");
    // #282：每次抽题数与 scale_version 无关也要补齐（旧库补列后读作 0 = 整库作答）
    expect(definition.items_per_attempt).toBe(RIASEC_ASSESSMENT.itemsPerAttempt);

    adapter.close();
    cleanup(dbPath);
  });

  it("绝不覆盖后台维护过的题面：升级后仍是后台版本，origin 照常回填", () => {
    const { dbPath, adapter, assessment } = setup();
    downgradeToLegacyBank(dbPath, assessment.id);
    const raw = new Database(dbPath);
    raw.prepare("UPDATE assessment_questions SET prompt = ? WHERE assessment_id = ? AND question_index = 1").run(
      "（后台维护版）动手制作厨房橱柜",
      assessment.id
    );
    raw.close();

    adapter.upgradeAssessmentBank();
    const questions = adapter.getAssessmentQuestions(assessment.id);
    expect(questions.find((q) => q.question_index === 1)!.prompt).toBe("（后台维护版）动手制作厨房橱柜");
    expect(questions.find((q) => q.question_index === 1)!.origin).toBe("onet-mini");

    adapter.close();
    cleanup(dbPath);
  });

  it("重复执行幂等：第二次不改任何字段", () => {
    const { dbPath, adapter, assessment } = setup();
    downgradeToLegacyBank(dbPath, assessment.id);
    adapter.upgradeAssessmentBank();
    const before = adapter.getAssessmentQuestions(assessment.id);
    const definitionBefore = adapter.getAssessmentByCode(RIASEC_CODE)!;

    const second = adapter.upgradeAssessmentBank();
    expect(second).toEqual({
      inserted: 0,
      originBackfilled: 0,
      definitionUpdated: false,
      licenseTextUpdated: false,
      itemsPerAttemptUpdated: false,
    });
    expect(adapter.getAssessmentQuestions(assessment.id)).toEqual(before);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)).toEqual(definitionBefore);

    adapter.close();
    cleanup(dbPath);
  });

  it("定义级字段只在 scale_version 不一致时更新（同版本库改过的名字不被覆盖）", () => {
    const { dbPath, adapter, assessment } = setup();
    const raw = new Database(dbPath);
    raw.prepare("UPDATE assessments SET name = ? WHERE id = ?").run("（后台改过的名字）", assessment.id);
    raw.close();

    const result = adapter.upgradeAssessmentBank();
    expect(result.definitionUpdated).toBe(false);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.name).toBe("（后台改过的名字）");

    adapter.close();
    cleanup(dbPath);
  });

  it("同版本库的 license_text 与种子不一致时只刷新这一列（#284），不动后台维护的名字", () => {
    const { dbPath, adapter, assessment } = setup();
    const raw = new Database(dbPath);
    raw.prepare("UPDATE assessments SET license_text = ?, name = ? WHERE id = ?").run(
      "（旧授权文案）",
      "（后台改过的名字）",
      assessment.id
    );
    raw.close();

    const result = adapter.upgradeAssessmentBank();
    expect(result.definitionUpdated).toBe(false);
    expect(result.licenseTextUpdated).toBe(true);
    const definition = adapter.getAssessmentByCode(RIASEC_CODE)!;
    expect(definition.name).toBe("（后台改过的名字）");
    expect(definition.license_text).toBe(RIASEC_ASSESSMENT.licenseText);

    // 幂等：第二次不再刷新
    expect(adapter.upgradeAssessmentBank()).toEqual({
      inserted: 0,
      originBackfilled: 0,
      definitionUpdated: false,
      licenseTextUpdated: false,
      itemsPerAttemptUpdated: false,
    });

    adapter.close();
    cleanup(dbPath);
  });
});

describe("草稿与结果（#221）", () => {
  it("草稿 upsert 幂等：同一学生同一量表只有一条 in_progress，作答内容被覆盖", () => {
    const { dbPath, adapter, studentId, assessment } = setup();

    const first = adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 4, 2: 5 }), "[]");
    const second = adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 2 }), "[]");
    expect(second).toBe(first);

    const draft = adapter.getAssessmentDraft(studentId, assessment.id);
    expect(draft).toMatchObject({ id: first, status: "in_progress", is_current: 0, draft_slot: 1 });
    expect(JSON.parse(draft!.answers_json)).toEqual({ 1: 2 });
    // 草稿不算完成记录
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)).toBeUndefined();
    expect(adapter.getAssessmentResults(studentId, assessment.id)).toEqual([]);

    adapter.close();
    cleanup(dbPath);
  });

  it("草稿唯一性由唯一约束兜住：绕过适配器也插不进第二条草稿", () => {
    const { dbPath, adapter, studentId, assessment } = setup();

    adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 4 }), "[]");

    // draft_slot = 1 是草稿位；唯一约束 (user_id, assessment_id, draft_slot) 让并发自动保存也插不出第二条
    const raw = new Database(dbPath);
    expect(() =>
      raw
        .prepare(
          `INSERT INTO assessment_results
             (user_id, assessment_id, status, answers_json, is_current, draft_slot, started_at, updated_at)
           VALUES (?, ?, 'in_progress', '{}', 0, 1, '2026-10-20 10:00:00', '2026-10-20 10:00:00')`
        )
        .run(studentId, assessment.id)
    ).toThrow(/UNIQUE/);
    raw.close();

    adapter.close();
    cleanup(dbPath);
  });

  it("完成时释放草稿位：完成后可再开新草稿，不覆盖已完成的版本", () => {
    const { dbPath, adapter, studentId, assessment } = setup();

    adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 4 }), "[]");
    const completedId = adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 1: 4 }),
      itemsJson: "[]",
      scoresJson: null,
      typeCode: "RIA",
    });
    expect(adapter.getAssessmentDraft(studentId, assessment.id)).toBeUndefined();

    // 再开新一轮：新草稿占回草稿位，已完成版本不受影响
    const newDraftId = adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 5 }), "[]");
    expect(newDraftId).not.toBe(completedId);
    expect(adapter.getAssessmentDraft(studentId, assessment.id)?.answers_json).toBe(JSON.stringify({ 1: 5 }));
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)?.id).toBe(completedId);
    expect(adapter.getAssessmentResults(studentId, assessment.id)).toHaveLength(1);

    adapter.close();
    cleanup(dbPath);
  });

  it("完成结果沿用草稿行；再完成一次生成新版本，is_current 唯一且历史可查", () => {
    const { dbPath, adapter, studentId, assessment } = setup();

    const draftId = adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 4 }), "[]");
    const firstId = adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 1: 4 }),
      itemsJson: "[]",
      scoresJson: JSON.stringify([{ key: "R", standard: 75 }]),
      typeCode: "RIA",
    });
    expect(firstId).toBe(draftId);

    const first = adapter.getCurrentAssessmentResult(studentId, assessment.id)!;
    expect(first.status).toBe("completed");
    expect(first.is_current).toBe(1);
    expect(first.type_code).toBe("RIA");
    expect(first.completed_at).toBeTruthy();
    expect(first.started_at).toBeTruthy();
    expect(adapter.getAssessmentDraft(studentId, assessment.id)).toBeUndefined();

    // 第二次完成（不经草稿），旧版本让位
    const secondId = adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 1: 5 }),
      itemsJson: "[]",
      scoresJson: JSON.stringify([{ key: "R", standard: 100 }]),
      typeCode: "RIC",
    });
    expect(secondId).not.toBe(firstId);

    const current = adapter.getCurrentAssessmentResult(studentId, assessment.id)!;
    expect(current.id).toBe(secondId);
    expect(current.type_code).toBe("RIC");

    const history = adapter.getAssessmentResults(studentId, assessment.id);
    expect(history.map((r) => r.id)).toEqual([secondId, firstId]);
    expect(history.filter((r) => r.is_current === 1)).toHaveLength(1);
    expect(history[1].type_code).toBe("RIA");

    adapter.close();
    cleanup(dbPath);
  });

  it("抽题快照随草稿与完成记录落库（#282）：沿用同一行，不改写也不丢", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    const snapshot = JSON.stringify({ v: 1, pool: "abc123", indexes: [7, 21, 55] });

    adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 7: 4 }), snapshot);
    expect(adapter.getAssessmentDraft(studentId, assessment.id)!.items_json).toBe(snapshot);

    // 第二次作答覆盖快照字段（值本来就来自这条快照，重复写同一个值）
    const snapshot2 = JSON.stringify({ v: 1, pool: "abc123", indexes: [7, 21] });
    adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 7: 4, 21: 3 }), snapshot2);
    const draft = adapter.getAssessmentDraft(studentId, assessment.id)!;
    expect(draft.items_json).toBe(snapshot2);

    // 完成时沿用草稿行：快照原样带过去，读回来的还是当轮那份题号清单
    const completedId = adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 7: 4, 21: 3 }),
      itemsJson: snapshot2,
      scoresJson: null,
      typeCode: "RIA",
    });
    expect(completedId).toBe(draft.id);
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)!.items_json).toBe(snapshot2);

    adapter.close();
    cleanup(dbPath);
  });

  it("学生之间互不可见；维度与计分类型可共存（dimensional 量表无三字码）", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    const otherId = adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四" });

    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: "{}",
      itemsJson: "[]",
      scoresJson: null,
      typeCode: null,
    });

    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)).toBeDefined();
    expect(adapter.getCurrentAssessmentResult(otherId, assessment.id)).toBeUndefined();
    // dimensional 量表（大五等）不产出三字码：三字码列允许 NULL
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)!.type_code).toBeNull();

    adapter.close();
    cleanup(dbPath);
  });

  it("删除学生时清掉其测评作答记录", () => {
    const { dbPath, adapter, studentId, assessment } = setup();

    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: "{}",
      itemsJson: "[]",
      scoresJson: null,
      typeCode: "RIA",
    });
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)).toBeDefined();

    expect(adapter.deleteStudents(["202505050101"])).toBe(1);
    const raw = new Database(dbPath);
    const remaining = raw.prepare("SELECT COUNT(*) as c FROM assessment_results").get() as { c: number };
    raw.close();
    expect(remaining.c).toBe(0);

    adapter.close();
    cleanup(dbPath);
  });
});

describe("备份与恢复（#221：三表纳入备份 version 6）", () => {
  it("备份含测评三表，恢复后量表与结果均保留", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 1: 4 }),
      itemsJson: "[]",
      scoresJson: JSON.stringify([{ key: "R", standard: 75 }]),
      typeCode: "RIA",
    });

    const data = adapter.backup();
    expect(data.version).toBe(9);
    expect(data.assessments).toHaveLength(2);
    expect(data.assessment_questions).toHaveLength(BANK_SIZE + IPIP_QUESTIONS.length);
    // #281：备份带 origin，往返后逐题一致
    const riasecQuestions = data.assessment_questions!.filter(
      (question) => question.assessment_id === assessment.id
    );
    for (const row of riasecQuestions) {
      expect(row.origin).toBe(
        row.question_index <= 30 ? "onet-mini" : row.question_index <= 60 ? "onet-sf" : "cn-original"
      );
    }
    expect(data.assessment_results).toHaveLength(1);

    adapter.restore(data);
    const restoredQuestions = adapter.getAssessmentQuestionsByCode(RIASEC_CODE);
    expect(restoredQuestions).toHaveLength(BANK_SIZE);
    expect(restoredQuestions.map((q) => q.origin)).toEqual(riasecQuestions.map((q) => q.origin));
    const restored = adapter.getCurrentAssessmentResult(studentId, assessment.id);
    expect(restored).toMatchObject({ type_code: "RIA", is_current: 1 });

    adapter.close();
    cleanup(dbPath);
  });

  it("旧备份（无测评字段）恢复：题库保留现状，作答结果一律清空（users 已整表替换）", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: "{}",
      itemsJson: "[]",
      scoresJson: null,
      typeCode: "RIA",
    });

    const legacy = {
      ...adapter.backup(),
      version: 5,
      assessments: undefined,
      assessment_questions: undefined,
      assessment_results: undefined,
    };
    adapter.restore(legacy);
    // 题库是参考数据 → 缺字段保留现状
    expect(adapter.getAssessmentQuestionsByCode(RIASEC_CODE)).toHaveLength(BANK_SIZE);
    expect(adapter.getStudentByCode("202505050101")).toBeDefined();
    // 作答只靠数值 user_id 关联，users 已被备份整表替换：保留旧结果会张冠李戴 → 一律清空
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)).toBeUndefined();
    expect(adapter.getAssessmentDraft(studentId, assessment.id)).toBeUndefined();

    // 题库被清空后恢复旧备份：即使 code 还在，题数为 0 也要补种
    const raw = new Database(dbPath);
    raw.exec("DELETE FROM assessment_results; DELETE FROM assessment_questions; DELETE FROM assessments");
    raw.close();
    adapter.restore(legacy);
    expect(adapter.getAssessmentQuestionsByCode(RIASEC_CODE)).toHaveLength(BANK_SIZE);

    adapter.close();
    cleanup(dbPath);
  });

  it("备份里题库为空数组：恢复后由种子自愈补题，不留「可用但 0 题」的量表", () => {
    const { dbPath, adapter, assessment } = setup();

    const forged = { ...adapter.backup(), assessment_questions: [] };
    adapter.restore(forged);
    expect(adapter.getAssessmentQuestionsByCode(RIASEC_CODE)).toHaveLength(BANK_SIZE);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.question_count).toBe(BANK_SIZE);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.id).toBe(assessment.id);

    adapter.close();
    cleanup(dbPath);
  });
  it("旧备份的题库缺 origin 列：恢复时按原创题默认，不拒绝恢复", () => {
    const { dbPath, adapter } = setup();
    const data = adapter.backup();
    // 模拟旧备份：逐行去掉 origin 列
    const legacyQuestions = data.assessment_questions!.map((q) =>
      Object.fromEntries(Object.entries(q).filter(([key]) => key !== "origin"))
    );
    adapter.restore({ ...data, assessment_results: [], assessment_questions: legacyQuestions as never });
    const restored = adapter.getAssessmentQuestionsByCode(RIASEC_CODE);
    expect(restored).toHaveLength(BANK_SIZE);
    expect(restored.every((q) => q.origin === "cn-original")).toBe(true);

    adapter.close();
    cleanup(dbPath);
  });

  it("旧备份缺 items_per_attempt / items_json：恢复补默认值而不是拒绝，升级再补齐（#282）", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    const snapshot = JSON.stringify({ v: 1, pool: "abc123", indexes: [3, 88] });
    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 3: 4, 88: 2 }),
      itemsJson: snapshot,
      scoresJson: null,
      typeCode: "RIA",
    });

    const data = adapter.backup();
    expect(data.assessments![0].items_per_attempt).toBe(30);
    expect(data.assessment_results![0].items_json).toBe(snapshot);

    // 模拟 #282 之前的备份：逐行去掉两个新列
    const drop = (row: object, key: string) =>
      Object.fromEntries(Object.entries(row).filter(([name]) => name !== key));
    adapter.restore({
      ...data,
      assessments: data.assessments!.map((a) => drop(a, "items_per_attempt")) as never,
      assessment_results: data.assessment_results!.map((r) => drop(r, "items_json")) as never,
    });
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.items_per_attempt).toBe(0);
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)!.items_json).toBe("[]");

    // 旧库形态（0 = 整库作答）由 upgradeAssessmentBank 按种子补齐，不需要人工改库
    expect(adapter.upgradeAssessmentBank().itemsPerAttemptUpdated).toBe(true);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.items_per_attempt).toBe(30);

    adapter.close();
    cleanup(dbPath);
  });
});

describe("两适配器 Schema 对账（#221）", () => {
  /**
   * MySQL 适配器无法在无 MySQL 实例的环境里做行为测试（CI 同样没有），这份对账补上「表结构同构」这条铁律：
   * 从两适配器源码抽 CREATE TABLE 块，比对**列名、外键目标、大小写敏感的唯一语义**，任一侧悄悄改列/漏外键/
   * 换 collation 都会在这里失败。行为口径（草稿 upsert / is_current / 事务）由上面的 SQLite 用例覆盖，
   * MySQL 侧靠同一个 `DbAdapter` 接口在 `npm run build` 的 tsc 阶段兜住方法签名。
   */
  const tableBlock = (source: string, table: string): string => {
    const lines = source.split(/\r?\n/);
    const start = lines.findIndex((line) => line.includes(`CREATE TABLE IF NOT EXISTS ${table} (`));
    expect(start, `两适配器都必须建表 ${table}`).toBeGreaterThanOrEqual(0);
    const block: string[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line.startsWith(")")) break;
      block.push(line);
    }
    return block.join("\n");
  };

  const columnNames = (source: string, table: string): string[] => {
    const columns: string[] = [];
    for (const line of tableBlock(source, table).split("\n")) {
      if (!line) continue;
      // 索引 / 唯一约束 / 外键约束不是列
      if (/^(INDEX|UNIQUE|KEY|CONSTRAINT|PRIMARY|FOREIGN)\b/i.test(line)) continue;
      const match = /^([a-z_][a-z0-9_]*)\s/.exec(line);
      if (match) columns.push(match[1]);
    }
    return columns;
  };

  /** 列 → 被引用表：SQLite 写行内 `REFERENCES`，MySQL 写表级 `CONSTRAINT ... FOREIGN KEY (...) REFERENCES` */
  const references = (source: string, table: string): string[] => {
    const found: string[] = [];
    for (const line of tableBlock(source, table).split("\n")) {
      const constraint = /FOREIGN KEY\s*\(([a-z_][a-z0-9_]*)\)\s*REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/i.exec(line);
      if (constraint) {
        found.push(`${constraint[1]}->${constraint[2]}`);
        continue;
      }
      const inline = /^([a-z_][a-z0-9_]*)\s[^,]*REFERENCES\s+([a-z_][a-z0-9_]*)\s*\(/i.exec(line);
      if (inline) found.push(`${inline[1]}->${inline[2]}`);
    }
    return found.sort();
  };

  const read = (file: string) => readFileSync(path.resolve(process.cwd(), "src/lib", file), "utf8");

  it.each(["assessments", "assessment_questions", "assessment_results"])("%s 两适配器列集合一致", (table) => {
    const sqliteColumns = columnNames(read("db-sqlite.ts"), table);
    const mysqlColumns = columnNames(read("db-mysql.ts"), table);
    expect(sqliteColumns.length).toBeGreaterThan(0);
    expect(mysqlColumns).toEqual(sqliteColumns);
  });

  it("外键集合一致（SQLite 的 REFERENCES 与本机 foreign_keys=ON 下真实生效）", () => {
    const sqlite = read("db-sqlite.ts");
    const mysql = read("db-mysql.ts");
    expect(references(mysql, "assessment_questions")).toEqual(references(sqlite, "assessment_questions"));
    expect(references(mysql, "assessment_results")).toEqual(references(sqlite, "assessment_results"));
    // 非空断言：两侧同时丢外键时上面两条会「空对空」通过
    expect(references(sqlite, "assessment_questions")).toEqual(["assessment_id->assessments"]);
    expect(references(sqlite, "assessment_results")).toEqual(["assessment_id->assessments", "user_id->users"]);
  });

  it("code 的唯一比较语义一致：MySQL 显式 utf8mb4_bin（默认 collation 不区分大小写）", () => {
    expect(tableBlock(read("db-mysql.ts"), "assessments")).toMatch(/code VARCHAR\(\d+\) COLLATE utf8mb4_bin/i);
  });

  it("三表覆盖 issue #221 / #282 要求的字段", () => {
    const sqlite = read("db-sqlite.ts");
    expect(columnNames(sqlite, "assessments")).toEqual(
      expect.arrayContaining([
        "code",
        "name",
        "question_count",
        "items_per_attempt",
        "dimensions_json",
        "scoring_mode",
        "scale_version",
        "attribution",
        "license_text",
        "enabled",
      ])
    );
    expect(columnNames(sqlite, "assessment_questions")).toEqual(
      expect.arrayContaining([
        "assessment_id",
        "question_index",
        "prompt",
        "dimension",
        "origin",
        "reverse_scored",
        "version",
      ])
    );
    expect(columnNames(sqlite, "assessment_results")).toEqual(
      expect.arrayContaining([
        "user_id",
        "assessment_id",
        "status",
        "answers_json",
        "items_json",
        "scores_json",
        "type_code",
        "is_current",
        "started_at",
        "completed_at",
      ])
    );
  });
});

describe("与计分引擎的对接契约（#220 / #221）", () => {
  it("库里取出的维度与题库可直接喂给 scoreAssessment，结果能原样落库", () => {
    const { dbPath, adapter, studentId, assessment } = setup();

    // 契约：dimensions_json → `{ key, label }[]`；题库行 → `{ index, dimension, reverseScored }`
    const dimensions = JSON.parse(assessment.dimensions_json) as { key: string; label: string }[];
    const questions = adapter.getAssessmentQuestions(assessment.id).map((q) => ({
      index: q.question_index,
      dimension: q.dimension,
      reverseScored: q.reverse_scored === 1,
    }));
    // 120 题全答 4 分：每维 20 题 → 原始分 80 / 量程 20-100 → 线性标准分 75，六维并列按 R,I,A,S,E,C 破平
    const answers = Object.fromEntries(questions.map((q) => [String(q.index), 4]));
    const result = scoreAssessment(dimensions, questions, answers);
    expect(result.complete).toBe(true);
    expect(result.missingIndexes).toEqual([]);
    expect(result.scores.map((s) => s.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(result.scores.every((s) => s.questionCount === PER_DIMENSION && s.standard === 75)).toBe(true);
    expect(result.code).toBe("RIA");

    // 快照列语义对齐：scores → scores_json、code → type_code
    const resultId = adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify(answers),
      itemsJson: "[]",
      scoresJson: JSON.stringify(result.scores),
      typeCode: result.code ?? null,
    });
    const stored = adapter.getCurrentAssessmentResult(studentId, assessment.id)!;
    expect(stored.id).toBe(resultId);
    expect(JSON.parse(stored.answers_json!)).toEqual(answers);
    expect(JSON.parse(stored.scores_json!)).toEqual(result.scores);
    expect(stored.type_code).toBe("RIA");

    adapter.close();
    cleanup(dbPath);
  });
});

describe("RIASEC 维度常量", () => {
  it("声明顺序固定为 R,I,A,S,E,C（计分与雷达图共用）", () => {
    expect(RIASEC_DIMENSIONS.map((d) => d.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(RIASEC_QUESTIONS).toHaveLength(120);
  });
});

function dimensionKeys(): string[] {
  return RIASEC_DIMENSIONS.map((d) => d.key);
}

describe("按学号批量取当前测评结果快照（#233 教师导出 / #234 数据列表）", () => {
  it("只回当前有效版本、未测评学号不出现、空入参短路", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    const otherId = adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四" });
    expect(otherId).toBeGreaterThan(0);
    // 李四只有草稿：草稿不算「测过」，不应出现在结果里（#234 列表徽章同口径）
    adapter.upsertAssessmentDraft(otherId, assessment.id, JSON.stringify({ 1: 3 }), "[]");

    // 同一学生两次完成：只应返回 is_current 的那条（最新）
    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 1: 4 }),
      itemsJson: "[]",
      scoresJson: JSON.stringify([{ key: "R", standard: 75 }]),
      typeCode: "RIA",
    });
    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 1: 5 }),
      itemsJson: "[]",
      scoresJson: JSON.stringify([{ key: "R", standard: 100 }]),
      typeCode: "RIC",
    });

    const summaries = adapter.getCurrentAssessmentResultsByUserCodes(assessment.id, [
      "202505050101", // 已完测
      "202505050102", // 在册但只有草稿
      "999999999999", // 不存在的学号
    ]);

    expect(summaries).toHaveLength(1);
    expect(summaries[0].user_code).toBe("202505050101");
    expect(summaries[0].type_code).toBe("RIC");
    expect(summaries[0].scores_json).toContain("100");
    expect(summaries[0].completed_at).toBeTruthy();
    // 不返回作答内容（导出列不需要，少搬个人数据）
    expect(summaries[0]).not.toHaveProperty("answers_json");
    expect(adapter.getCurrentAssessmentResultsByUserCodes(assessment.id, [])).toEqual([]);

    adapter.close();
    cleanup(dbPath);
  });

  it("名单跨分片仍返回完整结果（#193 批查分片口径复用）", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: "{}",
      itemsJson: "[]",
      scoresJson: JSON.stringify([{ key: "S", standard: 80 }]),
      typeCode: "SIA",
    });

    // 第二片里才命中（分片大小 500）
    const codes = Array.from({ length: 600 }, (_, index) => String(100000000000 + index));
    codes[codes.length - 1] = "202505050101";
    const summaries = adapter.getCurrentAssessmentResultsByUserCodes(assessment.id, codes);
    expect(summaries.map((row) => row.user_code)).toEqual(["202505050101"]);

    adapter.close();
    cleanup(dbPath);
  });
});
