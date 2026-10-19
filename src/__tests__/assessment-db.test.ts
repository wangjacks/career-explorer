import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../lib/db-sqlite";
import {
  RIASEC_ASSESSMENT,
  RIASEC_CODE,
  RIASEC_QUESTIONS,
  RIASEC_DIMENSIONS,
  validateAssessmentSeed,
} from "../lib/assessment-data";

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

describe("RIASEC 题库种子（#221）", () => {
  it("首次安装预置 riasec 量表与 30 题，六个维度各 5 题", () => {
    const { dbPath, adapter, assessment } = setup();

    const enabled = adapter.getEnabledAssessments();
    expect(enabled).toHaveLength(1);
    expect(enabled[0].code).toBe(RIASEC_CODE);
    expect(enabled[0].question_count).toBe(30);
    expect(enabled[0].scoring_mode).toBe("typological");
    expect(enabled[0].scale_version).toBe(RIASEC_ASSESSMENT.scaleVersion);

    // 维度定义 JSON：供计分引擎直接消费的 { key, label } 数组
    const dimensions = JSON.parse(assessment.dimensions_json) as { key: string; label: string }[];
    expect(dimensions.map((d) => d.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(dimensions.every((d) => d.label.length > 0)).toBe(true);

    const questions = adapter.getAssessmentQuestions(assessment.id);
    expect(questions).toHaveLength(30);
    // 题号从 1 连续到 30（作答接口按题号存答案，跳号会让进度口径失真）
    expect(questions.map((q) => q.question_index)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1)
    );
    for (const question of questions) {
      expect(question.prompt.trim().length).toBeGreaterThan(0);
      expect(dimensionKeys()).toContain(question.dimension);
      // Mini-IP 原始量表无反向计分题，字段照实写 0
      expect(question.reverse_scored).toBe(0);
      expect(question.version).toBe(1);
    }
    // 六型均衡：每型 5 题，否则标准分口径不可比
    for (const key of dimensionKeys()) {
      expect(questions.filter((q) => q.dimension === key)).toHaveLength(5);
    }

    // 题号与维度按 Mini-IP 报告建议的轮转顺序（R,I,A,S,E,C 循环）
    const cycle = ["R", "I", "A", "S", "E", "C"];
    expect(questions.map((q) => q.dimension)).toEqual(
      Array.from({ length: 30 }, (_, i) => cycle[i % 6])
    );
    expect(questions[0].prompt).toBe("动手制作厨房橱柜");

    // 署名 / 授权 / 免责文本随记录可查出（O*NET 授权硬性要求）
    expect(assessment.attribution).toContain("O*NET");
    expect(assessment.attribution).toContain("U.S. Department of Labor");
    expect(assessment.license_text).toContain("USDOL/ETA");
    expect(assessment.disclaimer).toContain("不作为心理诊断");

    adapter.close();
    cleanup(dbPath);
  });

  it("种子幂等：重复 init 不重复插入，且不覆盖后台维护过的题面", () => {
    const { dbPath, adapter, assessment } = setup();

    adapter.init();
    expect(adapter.getAssessmentQuestions(assessment.id)).toHaveLength(30);
    expect(adapter.getEnabledAssessments()).toHaveLength(1);

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
    expect(adapter.getEnabledAssessments()).toHaveLength(0);

    adapter.close();
    cleanup(dbPath);
  });

  it("按 code 取题库与按 id 取题库同口径；停用的量表仍可按 code 读取", () => {
    const { dbPath, adapter, assessment } = setup();

    const byCode = adapter.getAssessmentQuestionsByCode(RIASEC_CODE);
    expect(byCode).toEqual(adapter.getAssessmentQuestions(assessment.id));
    expect(adapter.getAssessmentQuestionsByCode("nope")).toEqual([]);

    const raw = new Database(dbPath);
    raw.prepare("UPDATE assessments SET enabled = 0 WHERE id = ?").run(assessment.id);
    raw.close();
    expect(adapter.getEnabledAssessments()).toHaveLength(0);
    expect(adapter.getAssessmentByCode(RIASEC_CODE)?.enabled).toBe(0);

    adapter.close();
    cleanup(dbPath);
  });

  it("种子自检：完整题库存得下，坏数据在落库前报错", () => {
    expect(() => validateAssessmentSeed(RIASEC_ASSESSMENT, RIASEC_QUESTIONS)).not.toThrow();

    const caseOf = (mutate: (questions: typeof RIASEC_QUESTIONS) => typeof RIASEC_QUESTIONS) => {
      return () => validateAssessmentSeed(RIASEC_ASSESSMENT, mutate(RIASEC_QUESTIONS.map((q) => ({ ...q }))));
    };

    expect(caseOf((qs) => qs.slice(1))).toThrow(/题数与题库不符/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, index: 2 } : q)))).toThrow(/题号重复/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, index: 31 } : q)))).toThrow(/题号不连续/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, dimension: "X" } : q)))).toThrow(/未定义的维度/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, prompt: "  " } : q)))).toThrow(/题干为空/);
    expect(caseOf((qs) => qs.map((q, i) => (i === 0 ? { ...q, source: "" } : q)))).toThrow(/缺少英文原文/);
  });
});

describe("草稿与结果（#221）", () => {
  it("草稿 upsert 幂等：同一学生同一量表只有一条 in_progress，作答内容被覆盖", () => {
    const { dbPath, adapter, studentId, assessment } = setup();

    const first = adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 4, 2: 5 }));
    const second = adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 2 }));
    expect(second).toBe(first);

    const draft = adapter.getAssessmentDraft(studentId, assessment.id);
    expect(draft).toMatchObject({ id: first, status: "in_progress", is_current: 0 });
    expect(JSON.parse(draft!.answers_json)).toEqual({ 1: 2 });
    // 草稿不算完成记录
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)).toBeUndefined();
    expect(adapter.getAssessmentResults(studentId, assessment.id)).toEqual([]);

    adapter.close();
    cleanup(dbPath);
  });

  it("完成结果沿用草稿行；再完成一次生成新版本，is_current 唯一且历史可查", () => {
    const { dbPath, adapter, studentId, assessment } = setup();

    const draftId = adapter.upsertAssessmentDraft(studentId, assessment.id, JSON.stringify({ 1: 4 }));
    const firstId = adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: JSON.stringify({ 1: 4 }),
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

  it("学生之间互不可见；维度与计分类型可共存（dimensional 量表无三字码）", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    const otherId = adapter.insertUser({ user_code: "202505050102", role: "student", name: "李四" });

    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: "{}",
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
      scoresJson: JSON.stringify([{ key: "R", standard: 75 }]),
      typeCode: "RIA",
    });

    const data = adapter.backup();
    expect(data.version).toBe(6);
    expect(data.assessments).toHaveLength(1);
    expect(data.assessment_questions).toHaveLength(30);
    expect(data.assessment_results).toHaveLength(1);

    adapter.restore(data);
    expect(adapter.getAssessmentQuestionsByCode(RIASEC_CODE)).toHaveLength(30);
    const restored = adapter.getCurrentAssessmentResult(studentId, assessment.id);
    expect(restored).toMatchObject({ type_code: "RIA", is_current: 1 });

    adapter.close();
    cleanup(dbPath);
  });

  it("旧备份（version 5，无测评字段）恢复后保留当前题库与结果；空表自愈补种", () => {
    const { dbPath, adapter, studentId, assessment } = setup();
    adapter.completeAssessmentResult({
      userId: studentId,
      assessmentId: assessment.id,
      answersJson: "{}",
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
    // 缺字段保留现状（题库是参考数据、作答是学生个人数据，都比清空安全）
    expect(adapter.getAssessmentQuestionsByCode(RIASEC_CODE)).toHaveLength(30);
    expect(adapter.getCurrentAssessmentResult(studentId, assessment.id)).toBeDefined();

    // 手工清空题库后恢复旧备份：seed 以 code 存在性判定，恢复后自愈补种
    const raw = new Database(dbPath);
    raw.exec("DELETE FROM assessment_results; DELETE FROM assessment_questions; DELETE FROM assessments");
    raw.close();
    adapter.restore(legacy);
    expect(adapter.getAssessmentQuestionsByCode(RIASEC_CODE)).toHaveLength(30);

    adapter.close();
    cleanup(dbPath);
  });
});

describe("两适配器 Schema 对账（#221）", () => {
  /**
   * MySQL 适配器无法在无 MySQL 实例的环境里做行为测试（CI 同样没有），这份对账补上「表结构同构」这条铁律：
   * 直接从两适配器源码抽 CREATE TABLE 的列名比对，任一侧悄悄改列/漏列都会在这里失败。
   * 行为口径（草稿 upsert / is_current / 事务）由上面的 SQLite 用例覆盖，MySQL 侧靠同一个 `DbAdapter`
   * 接口在 `npm run build` 的 tsc 阶段兜住方法签名。
   */
  const columnNames = (source: string, table: string): string[] => {
    const lines = source.split(/\r?\n/);
    const start = lines.findIndex((line) => line.includes(`CREATE TABLE IF NOT EXISTS ${table} (`));
    expect(start, `两适配器都必须建表 ${table}`).toBeGreaterThanOrEqual(0);
    const columns: string[] = [];
    for (let i = start + 1; i < lines.length; i += 1) {
      const line = lines[i].trim();
      if (line.startsWith(")")) break;
      if (!line) continue;
      // 索引 / 唯一约束 / 外键约束不是列
      if (/^(INDEX|UNIQUE|KEY|CONSTRAINT|PRIMARY|FOREIGN)\b/i.test(line)) continue;
      const match = /^([a-z_][a-z0-9_]*)\s/.exec(line);
      if (match) columns.push(match[1]);
    }
    return columns;
  };

  const read = (file: string) => readFileSync(path.resolve(process.cwd(), "src/lib", file), "utf8");

  it.each(["assessments", "assessment_questions", "assessment_results"])("%s 两适配器列集合一致", (table) => {
    const sqliteColumns = columnNames(read("db-sqlite.ts"), table);
    const mysqlColumns = columnNames(read("db-mysql.ts"), table);
    expect(sqliteColumns.length).toBeGreaterThan(0);
    expect(mysqlColumns).toEqual(sqliteColumns);
  });

  it("三表覆盖 issue #221 要求的字段", () => {
    const sqlite = read("db-sqlite.ts");
    expect(columnNames(sqlite, "assessments")).toEqual(
      expect.arrayContaining([
        "code",
        "name",
        "question_count",
        "dimensions_json",
        "scoring_mode",
        "scale_version",
        "attribution",
        "license_text",
        "enabled",
      ])
    );
    expect(columnNames(sqlite, "assessment_questions")).toEqual(
      expect.arrayContaining(["assessment_id", "question_index", "prompt", "dimension", "reverse_scored", "version"])
    );
    expect(columnNames(sqlite, "assessment_results")).toEqual(
      expect.arrayContaining([
        "user_id",
        "assessment_id",
        "status",
        "answers_json",
        "scores_json",
        "type_code",
        "is_current",
        "started_at",
        "completed_at",
      ])
    );
  });
});

describe("RIASEC 维度常量", () => {
  it("声明顺序固定为 R,I,A,S,E,C（计分与雷达图共用）", () => {
    expect(RIASEC_DIMENSIONS.map((d) => d.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(RIASEC_QUESTIONS).toHaveLength(30);
  });
});

function dimensionKeys(): string[] {
  return RIASEC_DIMENSIONS.map((d) => d.key);
}
