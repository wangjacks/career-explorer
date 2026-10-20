import { describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import {
  ASSESSMENT_ANCHORS,
  ASSESSMENT_SEEDS,
  IPIP_ASSESSMENT,
  IPIP_DIMENSIONS,
  IPIP_NEO_FFI_CODE,
  IPIP_NEO_FFI_SCALE_VERSION,
  IPIP_QUESTIONS,
  RIASEC_CODE,
  getQuestionSeeds,
  validateAssessmentSeed,
} from "../lib/assessment-data";
import { scoreAssessment } from "../lib/assessment-scoring";
import { SqliteAdapter } from "../lib/db-sqlite";

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-ipip-"));
  return path.join(dir, "test.db");
}

function cleanup(dbPath: string): void {
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

describe("IPIP NEO-FFI 50 题种子（#290）", () => {
  it("50 题、5 维各 10 题、25 道反向题且全部来自 IPIP", () => {
    expect(IPIP_QUESTIONS).toHaveLength(50);
    expect(IPIP_QUESTIONS.map((question) => question.index)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1)
    );
    expect(IPIP_QUESTIONS.filter((question) => question.reverseScored)).toHaveLength(25);
    expect(IPIP_QUESTIONS.every((question) => question.origin === "ipip")).toBe(true);

    for (const dimension of IPIP_DIMENSIONS) {
      const questions = IPIP_QUESTIONS.filter((question) => question.dimension === dimension.key);
      expect(questions).toHaveLength(10);
      expect(questions.filter((question) => question.reverseScored)).toHaveLength(5);
      expect(questions.filter((question) => !question.reverseScored)).toHaveLength(5);
    }
  });

  it("题面、英文原文与来源字段完整且可在文档中逐题追溯", () => {
    for (const question of IPIP_QUESTIONS) {
      expect(question.prompt.trim().length).toBeGreaterThan(0);
      expect(question.source.trim().length).toBeGreaterThan(0);
      expect(question.source).toMatch(/[A-Za-z]/);
      expect(question.anchor).toBeUndefined();
    }
    expect(new Set(IPIP_QUESTIONS.map((question) => question.prompt)).size).toBe(50);
    expect(new Set(IPIP_QUESTIONS.map((question) => question.source)).size).toBe(50);
  });

  it("量表定义、维度顺序、锚点和注册表符合 Issue #290", () => {
    expect(IPIP_ASSESSMENT).toMatchObject({
      code: "ipip-neo-ffi",
      name: "五大人格测评（IPIP NEO-FFI 精简版）",
      questionCount: 50,
      scoringMode: "dimensional",
      scaleVersion: "IPIP NEO-FFI 1.0",
    });
    expect(IPIP_NEO_FFI_CODE).toBe("ipip-neo-ffi");
    expect(IPIP_NEO_FFI_SCALE_VERSION).toBe("IPIP NEO-FFI 1.0");
    expect(IPIP_DIMENSIONS.map((dimension) => dimension.key)).toEqual(["N", "E", "O", "A", "C"]);
    expect(IPIP_DIMENSIONS.map((dimension) => dimension.label)).toEqual([
      "神经质",
      "外向性",
      "开放性",
      "宜人性",
      "尽责性",
    ]);
    expect(IPIP_ASSESSMENT.attribution).toContain("公有领域");
    expect(IPIP_ASSESSMENT.licenseText).toContain("商业 NEO-FFI");
    expect(ASSESSMENT_SEEDS.map((seed) => seed.code)).toEqual([RIASEC_CODE, IPIP_NEO_FFI_CODE]);
    expect(getQuestionSeeds(IPIP_NEO_FFI_CODE)).toBe(IPIP_QUESTIONS);

    for (const code of [RIASEC_CODE, IPIP_NEO_FFI_CODE]) {
      expect(ASSESSMENT_ANCHORS[code].map((anchor) => anchor.value)).toEqual([1, 2, 3, 4, 5]);
      expect(ASSESSMENT_ANCHORS[code]).toHaveLength(5);
    }
    expect(ASSESSMENT_ANCHORS[IPIP_NEO_FFI_CODE][0].label).toBe("非常不同意");
    expect(ASSESSMENT_ANCHORS[IPIP_NEO_FFI_CODE][4].label).toBe("非常同意");
  });

  it("量表无关校验通过，且不会把 IPIP 送进 O*NET 锚点查询", () => {
    const onetLookup = vi.fn(() => {
      throw new Error("IPIP 不应查询 O*NET");
    });
    expect(() => validateAssessmentSeed(IPIP_ASSESSMENT, IPIP_QUESTIONS, onetLookup)).not.toThrow();
    expect(onetLookup).not.toHaveBeenCalled();
  });

  it("坏种子会被通用校验拦住", () => {
    const mutate = (change: (questions: typeof IPIP_QUESTIONS) => typeof IPIP_QUESTIONS) =>
      change(IPIP_QUESTIONS.map((question) => ({ ...question })));

    expect(() => validateAssessmentSeed({ ...IPIP_ASSESSMENT, questionCount: 49 }, IPIP_QUESTIONS)).toThrow(
      /题数与题库不符/
    );
    expect(() =>
      validateAssessmentSeed(IPIP_ASSESSMENT, mutate((questions) => {
        questions[0] = { ...questions[0], dimension: "X" };
        return questions;
      }))
    ).toThrow(/未定义的维度/);
    expect(() =>
      validateAssessmentSeed(IPIP_ASSESSMENT, mutate((questions) => {
        questions[0] = { ...questions[0], prompt: " " };
        return questions;
      }))
    ).toThrow(/题干为空/);
    expect(() =>
      validateAssessmentSeed(
        { ...IPIP_ASSESSMENT, questionCount: 49 },
        mutate((questions) => questions.filter((question) => question.index !== 50))
      )
    ).toThrow(/各维度题数不相等/);
  });
});

describe("IPIP 数据层与现有计分引擎对接（#290）", () => {
  it("SQLite 全新安装同时落两套量表与 50 题，重复初始化保持幂等", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const enabled = adapter.getEnabledAssessments();
    expect(enabled.map((row) => row.code).sort()).toEqual([IPIP_NEO_FFI_CODE, RIASEC_CODE].sort());

    const assessment = adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)!;
    expect(assessment).toMatchObject({
      name: IPIP_ASSESSMENT.name,
      question_count: 50,
      scoring_mode: "dimensional",
      scale_version: IPIP_NEO_FFI_SCALE_VERSION,
      enabled: 1,
    });
    expect(JSON.parse(assessment.dimensions_json)).toEqual(IPIP_DIMENSIONS);

    const questions = adapter.getAssessmentQuestions(assessment.id);
    expect(questions).toHaveLength(50);
    expect(questions.map((question) => question.question_index)).toEqual(
      Array.from({ length: 50 }, (_, index) => index + 1)
    );
    expect(questions.filter((question) => question.reverse_scored === 1)).toHaveLength(25);
    expect(questions.every((question) => question.origin === "ipip")).toBe(true);

    adapter.init();
    expect(adapter.getAssessmentQuestions(assessment.id)).toHaveLength(50);
    expect(adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)).toEqual(assessment);

    adapter.close();
    cleanup(dbPath);
  });

  it("数据库行直接喂给 dimensional 计分：反向题翻转、五维标准分且不生成三字码", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const assessment = adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)!;
    const questions = adapter.getAssessmentQuestions(assessment.id).map((question) => ({
      index: question.question_index,
      dimension: question.dimension,
      reverseScored: question.reverse_scored === 1,
    }));
    const answers = Object.fromEntries(questions.map((question) => [question.index, 5]));
    const result = scoreAssessment(JSON.parse(assessment.dimensions_json), questions, answers, {
      mode: assessment.scoring_mode,
    });

    expect(result.complete).toBe(true);
    expect(result.mode).toBe("dimensional");
    expect(result.code).toBeUndefined();
    expect(result.rankedKeys).toBeUndefined();
    expect(result.scores.map((score) => score.key)).toEqual(["N", "E", "O", "A", "C"]);
    expect(result.scores.every((score) => score.questionCount === 10 && score.answered === 10)).toBe(true);
    expect(result.scores.every((score) => score.raw === 30 && score.standard === 50)).toBe(true);

    adapter.close();
    cleanup(dbPath);
  });

  it("备份导出/恢复保留 IPIP 量表、50 题和 origin", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();
    const assessment = adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)!;

    const backup = adapter.backup();
    const ipipQuestions = backup.assessment_questions!.filter(
      (question) => question.assessment_id === assessment.id
    );
    expect(ipipQuestions).toHaveLength(50);
    expect(ipipQuestions.every((question) => question.origin === "ipip")).toBe(true);

    adapter.restore(backup);
    expect(adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)?.question_count).toBe(50);
    expect(adapter.getAssessmentQuestionsByCode(IPIP_NEO_FFI_CODE)).toHaveLength(50);

    adapter.close();
    cleanup(dbPath);
  });
});
