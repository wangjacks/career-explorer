import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import Database from "better-sqlite3";
import { describe, expect, it } from "vitest";
import {
  ALPHA_FORM_MIN_SAMPLE,
  DIMENSION_ALPHA_MIN,
  ITEM_MEAN_CEILING,
  ITEM_MEAN_FLOOR,
  ITEM_MIN_SAMPLE,
  ITEM_RIT_MIN,
  SOURCE_MEAN_GAP_MAX,
  analyzeItemQuality,
  classifyItem,
  toItemCsv,
  type AttemptRecord,
  type ItemOrigin,
  type ItemQuestion,
} from "../lib/assessment-item-stats";
import { cronbachAlpha, pearsonCorrelation } from "../lib/assessment-validation";

/**
 * #285 题目质量回收的统计口径：
 * - 阈值边界用 `classifyItem` 锁死（n = 50 才有结论，均值 1.6 / 4.4、r_it 0.30 都是闭区间）；
 * - 聚合口径用手算小样本 + `assessment-validation.ts` 的同名实现交叉核对，防止两份数学漂移；
 * - CSV 与 CLI 只读性单独验，确保脚本不碰 `updated_at`、不输出任何学生身份信息。
 */

function sampleSd(values: readonly number[]): number {
  const avg = values.reduce((sum, value) => sum + value, 0) / values.length;
  const variance = values.reduce((sum, value) => sum + (value - avg) ** 2, 0) / (values.length - 1);
  return Math.sqrt(variance);
}

/** 测试侧的 RFC 4180 单行解析：顺带验证转义后的 CSV 仍可被标准解析器读回 */
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let current = "";
  let quoted = false;
  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (quoted) {
      if (char === '"' && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else if (char === '"') {
        quoted = false;
      } else {
        current += char;
      }
    } else if (char === '"') {
      quoted = true;
    } else if (char === ",") {
      cells.push(current);
      current = "";
    } else {
      current += char;
    }
  }
  cells.push(current);
  return cells;
}

function question(
  index: number,
  dimension: string,
  origin: ItemOrigin = "onet-mini",
  prompt = `第${index}题的题干`
): ItemQuestion {
  return { index, dimension, origin, version: 1, prompt };
}

const R_DIMENSION = { key: "R", label: "现实型" };
const I_DIMENSION = { key: "I", label: "研究型" };

describe("classifyItem：单题淘汰阈值", () => {
  it("n < 50 一律样本不足：即使均值极端也不给淘汰结论", () => {
    expect(classifyItem({ n: ITEM_MIN_SAMPLE - 1, mean: 5, sd: 0, rit: -0.9 })).toEqual({
      verdict: "insufficient",
      flags: ["sample-too-small"],
    });
    expect(classifyItem({ n: 0, mean: null, sd: null, rit: null })).toEqual({
      verdict: "insufficient",
      flags: ["sample-too-small"],
    });
  });

  it("阈值是闭区间：均值 1.6 / 4.4、r_it 0.30、n = 50 都保留", () => {
    expect(
      classifyItem({ n: ITEM_MIN_SAMPLE, mean: ITEM_MEAN_FLOOR, sd: 1, rit: ITEM_RIT_MIN })
    ).toEqual({ verdict: "keep", flags: [] });
    expect(
      classifyItem({ n: ITEM_MIN_SAMPLE, mean: ITEM_MEAN_CEILING, sd: 1, rit: ITEM_RIT_MIN })
    ).toEqual({ verdict: "keep", flags: [] });
  });

  it("地板题 / 天花板题：均值严格低于 1.6 或严格高于 4.4 才淘汰", () => {
    expect(classifyItem({ n: 50, mean: 1.59, sd: 1, rit: 0.5 })).toEqual({
      verdict: "retire",
      flags: ["floor"],
    });
    expect(classifyItem({ n: 50, mean: 4.41, sd: 1, rit: 0.5 })).toEqual({
      verdict: "retire",
      flags: ["ceiling"],
    });
  });

  it("区分度不足与无法计算都淘汰，且标记原因", () => {
    expect(classifyItem({ n: 50, mean: 3, sd: 1, rit: 0.299 })).toEqual({
      verdict: "retire",
      flags: ["low-rit"],
    });
    expect(classifyItem({ n: 50, mean: 3, sd: 1, rit: null })).toEqual({
      verdict: "retire",
      flags: ["rit-uncomputable"],
    });
  });

  it("全同作答（sd = 0）淘汰；多个问题同时出现时保留全部 flags", () => {
    expect(classifyItem({ n: 50, mean: 3, sd: 0, rit: 0.5 })).toEqual({
      verdict: "retire",
      flags: ["no-variation"],
    });
    expect(classifyItem({ n: 50, mean: 1.2, sd: 0, rit: 0.1 })).toEqual({
      verdict: "retire",
      flags: ["floor", "no-variation", "low-rit"],
    });
  });
});

describe("analyzeItemQuality：逐题指标", () => {
  const questions = [
    question(1, "R"),
    question(2, "R"),
    question(3, "R"),
    question(4, "I"),
  ];
  const attempts: AttemptRecord[] = [
    { indexes: [1, 2, 3, 4], answers: { 1: 1, 2: 2, 3: 3, 4: 4 } },
    // 重复题号与题库外题号在分析时去重 / 丢弃，不能把同一题算两遍
    { indexes: [1, 2, 3, 3, 999], answers: { 1: 2, 2: 3, 3: 4 } },
    { indexes: [1, 2, 3], answers: { 1: 3, 2: 4, 3: 5 } },
    { indexes: [1, 2, 3], answers: { 1: 1, 2: 3, 3: 5 } },
    // 只答了 1 题：均值照算，r_it 没有「同维其余题」可配对
    { indexes: [1, 2], answers: { 1: 2 } },
    // 全部是脏作答：记录保留，但不产生任何题目的观测值
    { indexes: [1, 2, 3], answers: { 1: 6, 2: 0, 3: 3.5 } },
    // 题号全部无效：整条记录不进统计
    { indexes: [999], answers: { 999: 3 } },
  ];
  const report = analyzeItemQuality({
    questions,
    attempts,
    dimensions: [R_DIMENSION, I_DIMENSION],
  });
  const byItem = new Map(report.items.map((item) => [item.index, item]));

  it("记录数是有效轮次；题号全无效的记录被跳过", () => {
    expect(report.attemptCount).toBe(6);
    expect(report.skippedAttemptCount).toBe(0);
    expect(report.items.map((item) => item.index)).toEqual([1, 2, 3, 4]);
  });

  it("n / 均值 / 样本标准差（ddof = 1）按所有有效作答计算", () => {
    const first = byItem.get(1)!;
    expect(first.n).toBe(5); // 含只答一题的那条记录
    expect(first.mean).toBeCloseTo(1.8, 10);
    expect(first.sd).toBeCloseTo(sampleSd([1, 2, 3, 1, 2]), 10);

    const second = byItem.get(2)!;
    expect(second.n).toBe(4);
    expect(second.mean).toBeCloseTo(3, 10);
    expect(second.sd).toBeCloseTo(sampleSd([2, 3, 4, 3]), 10);

    const fourth = byItem.get(4)!;
    expect(fourth.n).toBe(1);
    expect(fourth.sd).toBeNull(); // 单个观测没有样本标准差
  });

  it("r_it = 该题与同卷同维其余题之和的相关，配对口径与手算一致", () => {
    expect(byItem.get(1)!.rit).toBeCloseTo(
      pearsonCorrelation([1, 2, 3, 1], [5, 7, 9, 8])!,
      10
    );
    expect(byItem.get(2)!.rit).toBeCloseTo(
      pearsonCorrelation([2, 3, 4, 3], [4, 6, 8, 6])!,
      10
    );
    expect(byItem.get(3)!.rit).toBeCloseTo(
      pearsonCorrelation([3, 4, 5, 5], [3, 5, 7, 4])!,
      10
    );
    // 同维只有自己一题作答：无法计算，不伪装成 0
    expect(byItem.get(1)!.n).toBeGreaterThan(0);
    expect(byItem.get(4)!.rit).toBeNull();
  });

  it("小样本统一判为样本不足，note 说明 n 与门槛", () => {
    for (const item of report.items) {
      expect(item.verdict).toBe("insufficient");
      expect(item.flags).toEqual(["sample-too-small"]);
      expect(item.note).toContain(`未达 ${ITEM_MIN_SAMPLE} 次`);
    }
  });

  it("维度 α 按同一套 5 题组合分组，缺答行不进 α；单题维度不适用", () => {
    const rDimension = report.dimensions.find((dimension) => dimension.key === "R")!;
    // [1,2,3] 与 [1,2] 两个组合都出现过；只有 [1,2,3] 有 4 条完整作答
    expect(rDimension.alphaFormTotal).toBe(2);
    expect(rDimension.alphaForms).toBe(1);
    expect(rDimension.alpha).toBeCloseTo(
      cronbachAlpha([
        [1, 2, 3],
        [2, 3, 4],
        [3, 4, 5],
        [1, 3, 5],
      ])!,
      10
    );
    expect(rDimension.alphaMin).toBeCloseTo(rDimension.alpha!, 10);
    expect(rDimension.alphaFormsBelow).toBe(0);
    expect(rDimension.verdict).toBe("ok");

    const iDimension = report.dimensions.find((dimension) => dimension.key === "I")!;
    expect(iDimension.alpha).toBeNull();
    expect(iDimension.verdict).toBe("not-applicable");
  });

  it("报告回显放行门与退役集，默认都为空", () => {
    expect(report.excludedOrigins).toEqual([]);
    expect(report.retiredIndexes).toEqual([]);
  });
});

describe("analyzeItemQuality：维度与来源判定", () => {
  it("同一组合少于 2 人时 α 不可计算，维度结论为样本不足", () => {
    const report = analyzeItemQuality({
      questions: [question(1, "R"), question(2, "R")],
      attempts: [
        { indexes: [1, 2], answers: { 1: 1, 2: 2 } },
        { indexes: [1, 2], answers: { 1: 2 } },
      ],
      dimensions: [R_DIMENSION],
    });
    const dimension = report.dimensions[0];
    expect(ALPHA_FORM_MIN_SAMPLE).toBe(2);
    expect(dimension.alphaFormTotal).toBe(1);
    expect(dimension.alphaForms).toBe(0);
    expect(dimension.alpha).toBeNull();
    expect(dimension.verdict).toBe("insufficient");
  });

  it("组合 α 低于 0.55 时维度判为复查，并记录最低 α 与低于阈值的组合数", () => {
    const attempts: AttemptRecord[] = [];
    for (let i = 0; i < 5; i += 1) attempts.push({ indexes: [1, 2], answers: { 1: 1, 2: 5 } });
    for (let i = 0; i < 5; i += 1) attempts.push({ indexes: [1, 2], answers: { 1: 5, 2: 1 } });
    attempts.push({ indexes: [1, 2], answers: { 1: 4, 2: 4 } });
    const report = analyzeItemQuality({
      questions: [question(1, "R"), question(2, "R")],
      attempts,
      dimensions: [R_DIMENSION],
    });
    const dimension = report.dimensions[0];
    expect(dimension.alpha).not.toBeNull();
    expect(dimension.alpha!).toBeLessThan(DIMENSION_ALPHA_MIN);
    expect(dimension.alphaForms).toBe(1);
    expect(dimension.alphaFormsBelow).toBe(1);
    expect(dimension.alpha).toBeCloseTo(
      cronbachAlpha([
        ...Array.from({ length: 5 }, () => [1, 5]),
        ...Array.from({ length: 5 }, () => [5, 1]),
        [4, 4],
      ])!,
      10
    );
    expect(dimension.alphaMin).toBeCloseTo(dimension.alpha!, 10);
    expect(dimension.verdict).toBe("review");
  });

  it("官方题与原创题同维均值差 > 0.5：整批原创题复评", () => {
    const questions = [question(1, "R", "onet-mini"), question(2, "R", "cn-original")];
    const attempts: AttemptRecord[] = [];
    for (let i = 0; i < 60; i += 1) {
      attempts.push({
        indexes: [1, 2],
        answers: { 1: i % 2 === 0 ? 5 : 4, 2: i % 2 === 0 ? 2 : 1 },
      });
    }
    const dimension = analyzeItemQuality({ questions, attempts, dimensions: [R_DIMENSION] })
      .dimensions[0];
    expect(dimension.officialMean).toBeCloseTo(4.5, 10);
    expect(dimension.originalMean).toBeCloseTo(1.5, 10);
    expect(dimension.sourceGap).toBeCloseTo(3, 10);
    expect(dimension.sourceVerdict).toBe("review-original");
    expect(SOURCE_MEAN_GAP_MAX).toBe(0.5);
  });

  it("均值差正好 0.5 算达标；差异不到 0.5 也达标", () => {
    const questions = [question(1, "R", "onet-sf"), question(2, "R", "cn-original")];
    const attempts: AttemptRecord[] = [];
    for (let i = 0; i < 60; i += 1) {
      attempts.push({
        indexes: [1, 2],
        answers: { 1: i % 2 === 0 ? 5 : 4, 2: 4 },
      });
    }
    const dimension = analyzeItemQuality({ questions, attempts, dimensions: [R_DIMENSION] })
      .dimensions[0];
    expect(dimension.officialMean).toBeCloseTo(4.5, 10);
    expect(dimension.originalMean).toBeCloseTo(4, 10);
    expect(dimension.sourceGap).toBeCloseTo(0.5, 10);
    expect(dimension.sourceVerdict).toBe("ok");
  });

  it("原创题样本不足时来源比较记为样本不足；没有原创题时不适用", () => {
    const insufficient = analyzeItemQuality({
      questions: [question(1, "R", "onet-mini"), question(2, "R", "cn-original")],
      attempts: [{ indexes: [1, 2], answers: { 1: 4, 2: 2 } }],
      dimensions: [R_DIMENSION],
    }).dimensions[0];
    expect(insufficient.officialMean).toBeNull();
    expect(insufficient.originalMean).toBeNull();
    expect(insufficient.sourceGap).toBeNull();
    expect(insufficient.sourceVerdict).toBe("insufficient");

    const notApplicable = analyzeItemQuality({
      questions: [question(1, "R", "onet-mini"), question(2, "R", "onet-sf")],
      attempts: [{ indexes: [1, 2], answers: { 1: 4, 2: 2 } }],
      dimensions: [R_DIMENSION],
    }).dimensions[0];
    expect(notApplicable.sourceVerdict).toBe("not-applicable");
  });

  it("逐题标注抽题状态：退役优先于来源未放行", () => {
    const report = analyzeItemQuality({
      questions: [
        question(1, "R", "onet-mini"),
        question(2, "R", "cn-original"),
        question(3, "R", "cn-original"),
      ],
      attempts: [{ indexes: [1, 2, 3], answers: { 1: 3, 2: 3, 3: 3 } }],
      dimensions: [R_DIMENSION],
      excludedOrigins: new Set(["cn-original"]),
      retiredIndexes: new Set([3]),
    });
    expect(report.items.map((item) => [item.index, item.samplingStatus])).toEqual([
      [1, "active"],
      [2, "origin-gated"],
      [3, "retired"],
    ]);
    expect(report.excludedOrigins).toEqual(["cn-original"]);
    expect(report.retiredIndexes).toEqual([3]);
  });

  it("题库外的题号与未声明维度不会进入报告", () => {
    const report = analyzeItemQuality({
      questions: [question(1, "R"), question(2, "X")],
      attempts: [{ indexes: [1, 2], answers: { 1: 3, 2: 3 } }],
      dimensions: [R_DIMENSION],
    });
    expect(report.items.map((item) => item.index)).toEqual([1]);
    expect(report.attemptCount).toBe(1);
  });
});

describe("toItemCsv：逐题 CSV", () => {
  const report = analyzeItemQuality({
    questions: [
      question(1, "R", "onet-mini", '第一题,带"引号"'),
      question(2, "R", "cn-original", "第二题"),
      question(3, "I", "ipip", "第三题"),
    ],
    attempts: [{ indexes: [1, 2], answers: { 1: 1, 2: 5 } }],
    dimensions: [R_DIMENSION, { key: "I", label: "研究型, I" }],
    excludedOrigins: new Set(["cn-original"]),
  });
  const csv = toItemCsv(report);
  const lines = csv.split("\n");

  it("表头固定，行数 = 题目数，末尾换行", () => {
    expect(lines[0]).toBe(
      "dimension,dimension_label,origin,item_index,version,prompt,n,mean,sd,r_it,item_verdict,flags,sampling_status," +
        "dimension_alpha,dimension_alpha_min,dimension_alpha_form_total,dimension_alpha_forms," +
        "dimension_alpha_forms_below,dimension_verdict,official_mean,original_mean,source_gap," +
        "source_verdict,note"
    );
    expect(lines).toHaveLength(report.items.length + 2); // 表头 + 3 题 + 末尾空串
    expect(csv.endsWith("\n")).toBe(true);
  });

  it("题面里的逗号 / 引号按 RFC 4180 转义，维度标签同样处理", () => {
    expect(csv).toContain('"第一题,带""引号"""');
    expect(csv).toContain('"研究型, I"');
  });

  it("按「维度声明顺序 → 来源 → 题号」排序，状态与判定可筛选", () => {
    const rows = lines.slice(1, -1).map(parseCsvLine);
    expect(rows.map((row) => [row[0], row[2], row[3]])).toEqual([
      ["R", "onet-mini", "1"],
      ["R", "cn-original", "2"],
      ["I", "ipip", "3"],
    ]);
    expect(rows[1]).toContain("origin-gated");
    expect(rows[0]).toContain("sample-too-small");
  });

  it("不可计算的值留空，不写 NaN / null / undefined", () => {
    expect(csv).not.toMatch(/NaN|null|undefined/);
    const third = parseCsvLine(lines[3]);
    // n = 0 → mean / sd / r_it 三列全空
    expect(third.slice(6, 10)).toEqual(["0", "", "", ""]);
  });
});

// ── CLI：只读、CSV、隐私 ──

const SCRIPT = fileURLToPath(new URL("../../scripts/assessment-item-stats.mjs", import.meta.url));

function createStatsFixture(): { dir: string; dbPath: string } {
  const dir = mkdtempSync(path.join(tmpdir(), "item-stats-"));
  const dbPath = path.join(dir, "career.db");
  const db = new Database(dbPath);
  db.exec(`
    CREATE TABLE assessments (
      id INTEGER PRIMARY KEY,
      code TEXT NOT NULL,
      name TEXT,
      scale_version TEXT,
      items_per_attempt INTEGER,
      dimensions_json TEXT
    );
    CREATE TABLE assessment_questions (
      assessment_id INTEGER NOT NULL,
      question_index INTEGER NOT NULL,
      dimension TEXT NOT NULL,
      origin TEXT NOT NULL,
      version INTEGER NOT NULL,
      prompt TEXT NOT NULL
    );
    CREATE TABLE assessment_results (
      id INTEGER PRIMARY KEY,
      assessment_id INTEGER NOT NULL,
      user_id INTEGER,
      student_name TEXT,
      status TEXT NOT NULL,
      answers_json TEXT,
      items_json TEXT,
      updated_at TEXT NOT NULL
    );
  `);
  db.prepare(
    "INSERT INTO assessments (id, code, name, scale_version, items_per_attempt, dimensions_json) VALUES (1, 'riasec', '测试量表', 'test-1', 2, ?)"
  ).run(JSON.stringify([R_DIMENSION]));
  const insertQuestion = db.prepare(
    "INSERT INTO assessment_questions (assessment_id, question_index, dimension, origin, version, prompt) VALUES (1, ?, 'R', ?, 1, ?)"
  );
  insertQuestion.run(1, "onet-mini", "官方题");
  insertQuestion.run(2, "cn-original", "原创题");
  const insertResult = db.prepare(
    "INSERT INTO assessment_results (assessment_id, user_id, student_name, status, answers_json, items_json, updated_at) VALUES (1, ?, ?, ?, ?, ?, ?)"
  );
  const snapshot = JSON.stringify({ v: 1, pool: "test-pool", indexes: [1, 2] });
  for (let i = 0; i < 60; i += 1) {
    // 第 1 题恒为 5：天花板 + 无变异 + r_it 不可计算 → 必然建议淘汰
    insertResult.run(
      1000 + i,
      `secret-student-${i}`,
      "completed",
      JSON.stringify({ 1: 5, 2: (i % 5) + 1 }),
      snapshot,
      "2026-01-01T00:00:00Z"
    );
  }
  // 抽样量表缺快照：不猜题集，计入跳过
  insertResult.run(2000, "secret-student-x", "completed", JSON.stringify({ 1: 5, 2: 3 }), null, "2026-01-01T00:00:00Z");
  // 未完成记录不进统计
  insertResult.run(2001, "secret-student-y", "in_progress", JSON.stringify({ 1: 5 }), snapshot, "2026-01-01T00:00:00Z");
  db.close();
  return { dir, dbPath };
}

function hashFile(filePath: string): string {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

describe("scripts/assessment-item-stats.mjs：只读 CLI", () => {
  it("读 SQLite 不写库、不碰 updated_at，CSV 完整且不含学生身份信息", () => {
    const { dir, dbPath } = createStatsFixture();
    const outPath = path.join(dir, "items.csv");
    try {
      const before = hashFile(dbPath);
      const result = spawnSync(
        process.execPath,
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          SCRIPT,
          "--db",
          dbPath,
          "--out",
          outPath,
        ],
        { encoding: "utf8" }
      );
      expect(result.status, result.stderr).toBe(0);
      expect(result.stdout).toBe("");
      expect(result.stderr).toContain("完成记录：60 条参与统计，1 条跳过");
      expect(result.stderr).toContain("其中 1 条缺有效抽题快照");
      expect(result.stderr).toContain("退役台账为空");

      expect(hashFile(dbPath)).toBe(before);
      const check = new Database(dbPath, { readonly: true });
      try {
        const row = check
          .prepare("SELECT updated_at FROM assessment_results WHERE id = 1")
          .get() as { updated_at: string };
        expect(row.updated_at).toBe("2026-01-01T00:00:00Z");
        expect(check.prepare("SELECT COUNT(*) AS count FROM assessment_results").get()).toEqual({ count: 62 });
      } finally {
        check.close();
      }

      const csv = readFileSync(outPath, "utf8");
      expect(csv.startsWith("\uFEFFdimension,")).toBe(true); // BOM 供 Excel 识别中文
      expect(csv).not.toContain("secret-student");
      expect(csv).not.toContain("user_id");
      expect(csv.split("\n").filter((line) => line.length > 0)).toHaveLength(3); // 表头 + 2 题
      expect(csv).toContain("ceiling|no-variation|rit-uncomputable");
      expect(csv).toContain("review-original");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("--strict 遇到建议淘汰题以退出码 2 结束", () => {
    const { dir, dbPath } = createStatsFixture();
    try {
      const result = spawnSync(
        process.execPath,
        [
          "--disable-warning=MODULE_TYPELESS_PACKAGE_JSON",
          SCRIPT,
          "--strict",
          "--db",
          dbPath,
        ],
        { encoding: "utf8" }
      );
      expect(result.status).toBe(2);
      expect(result.stderr).toContain("--strict：存在建议淘汰题或需复查维度");
      expect(result.stdout.startsWith("dimension,")).toBe(true);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it("题目来源非法或缺少必需参数时显式失败，不生成半截 CSV", () => {
    const missing = spawnSync(
      process.execPath,
      ["--disable-warning=MODULE_TYPELESS_PACKAGE_JSON", SCRIPT],
      { encoding: "utf8" }
    );
    expect(missing.status).toBe(1);
    expect(missing.stderr).toContain("请指定数据来源");
    expect(missing.stdout).toBe("");
  });
});

/**
 * 交叉核对：本模块为了被 Node 直接加载而保持零 import，数学实现是 `assessment-validation.ts`
 * 的第二份；这里用同一批 60 行数据逐值比对，防止两边阈值口径悄悄漂移。
 */
describe("与 assessment-validation.ts 的统计口径一致", () => {
  it("r_it 与卷面 α 和参考实现逐值一致", () => {
    const questions = [question(1, "R"), question(2, "R"), question(3, "R")];
    const attempts: AttemptRecord[] = [];
    const rows: number[][] = [];
    for (let i = 0; i < 60; i += 1) {
      const row = [((i * 3) % 5) + 1, ((i * 2) % 5) + 1, ((i * 4) % 5) + 1];
      rows.push(row);
      attempts.push({ indexes: [1, 2, 3], answers: { 1: row[0], 2: row[1], 3: row[2] } });
    }
    const report = analyzeItemQuality({ questions, attempts, dimensions: [R_DIMENSION] });
    const byItem = new Map(report.items.map((item) => [item.index, item]));

    for (let item = 0; item < 3; item += 1) {
      const rest = rows.map((row) => row.reduce((sum, value) => sum + value, 0) - row[item]);
      expect(byItem.get(item + 1)!.rit).toBeCloseTo(
        pearsonCorrelation(rows.map((row) => row[item]), rest)!,
        10
      );
    }
    expect(report.dimensions[0].alpha).toBeCloseTo(cronbachAlpha(rows)!, 10);
  });
});
