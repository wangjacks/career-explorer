#!/usr/bin/env node
/**
 * 量表信效度验证报告生成器（#227）
 *
 * 用法：
 *   node scripts/validate-assessment.mjs --db ./data/career.db [--code riasec] [--out report.md]
 *   node scripts/validate-assessment.mjs --export ./responses.json [--out report.md]
 *
 * 两种数据来源：
 * - `--db`：直读 SQLite（本地部署最常见）；只读打开，不写库; MySQL 部署请先按方案文档中的 SQL 导出，
 *   再用 `--export` 跑（导出格式见 docs/assessment-validation-plan.md 附录）。
 * - `--export`：读匿名导出 JSON，后端无关，也方便研究者在统计软件里复核。
 *
 * 隐私：只输出**聚合统计**。db 模式下 user_id 只在内存里做匿名键（p01/p02…）用于配对重测，
 * 报告里不出现 user_id、姓名、学号，也不出现任何单条作答明细。
 *
 * 统计口径与阈值实现在 `src/lib/assessment-validation.ts`（有单测），本脚本只做取数与排版。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  BAND_LABELS,
  CITC_MIN,
  NORM_MIN_SAMPLE,
  NORM_RECOMMENDED_SAMPLE,
  RETEST_ACCEPTABLE,
  normSampleBand,
  pearsonCorrelation,
  percentileTable,
  summarizeDimension,
} from "../src/lib/assessment-validation.ts";

const DEFAULT_CODE = "riasec";
const DEFAULT_MIN_RETEST_DAYS = 7;

function parseArgs(argv) {
  const args = {
    db: "",
    export: "",
    code: DEFAULT_CODE,
    out: "",
    minRetestDays: DEFAULT_MIN_RETEST_DAYS,
    strict: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--db") args.db = next ?? "";
    else if (current === "--export") args.export = next ?? "";
    else if (current === "--code") args.code = next ?? DEFAULT_CODE;
    else if (current === "--out") args.out = next ?? "";
    else if (current === "--min-interval-days") args.minRetestDays = Number(next ?? DEFAULT_MIN_RETEST_DAYS);
    else if (current === "--strict") args.strict = true;
    else if (current === "--help" || current === "-h") {
      console.log("用法：node scripts/validate-assessment.mjs (--db <sqlite> | --export <json>) [--code riasec] [--out <file>] [--min-interval-days 7] [--strict]");
      process.exit(0);
    }
    if (current.startsWith("--")) i += 1;
  }
  return args;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function toNumberMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    const index = Number(key);
    const numeric = typeof value === "string" ? Number(value) : value;
    if (!Number.isInteger(index) || index < 1) continue;
    if (typeof numeric !== "number" || !Number.isInteger(numeric) || numeric < 1 || numeric > 5) continue;
    out[index] = numeric;
  }
  return out;
}

function toScoreMap(raw) {
  const out = {};
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return out;
  for (const [key, value] of Object.entries(raw)) {
    if (typeof value === "number" && Number.isFinite(value)) out[key] = value;
  }
  return out;
}

/** 从 SQLite 取数并转成与 `--export` 相同的内存结构（user_id 匿名化为内部键） */
function loadFromDb(dbPath, code) {
  if (!existsSync(dbPath)) fail(`找不到数据库文件：${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  try {
    const assessment = db.prepare("SELECT * FROM assessments WHERE code = ?").get(code);
    if (!assessment) fail(`数据库里没有 code=${code} 的量表（先启动一次应用完成建表与种子）`);
    const questions = db
      .prepare("SELECT question_index, dimension, reverse_scored FROM assessment_questions WHERE assessment_id = ? ORDER BY question_index")
      .all(assessment.id)
      .map((row) => ({ index: row.question_index, dimension: row.dimension, reverseScored: row.reverse_scored === 1 }));
    const rows = db
      .prepare(
        `SELECT user_id, answers_json, scores_json, completed_at
           FROM assessment_results
          WHERE assessment_id = ? AND status = 'completed'
          ORDER BY user_id, completed_at, id`
      )
      .all(assessment.id);
    // 匿名键：按 user_id 出现顺序编号，只在内存里用于配对重测，不进入报告
    const anonymized = new Map();
    const responses = rows.map((row) => {
      if (!anonymized.has(row.user_id)) anonymized.set(row.user_id, `p${String(anonymized.size + 1).padStart(2, "0")}`);
      let scores = [];
      try {
        scores = JSON.parse(row.scores_json ?? "[]");
      } catch (err) {
        console.warn(`跳过一条 scores_json 解析失败的记录：${err.message}`);
      }
      const scoreMap = {};
      if (Array.isArray(scores)) {
        for (const item of scores) {
          if (item && typeof item.key === "string" && typeof item.standard === "number") scoreMap[item.key] = item.standard;
        }
      }
      return {
        studentKey: anonymized.get(row.user_id),
        completedAt: row.completed_at ?? "",
        answers: toNumberMap(parseJson(row.answers_json)),
        scores: scoreMap,
      };
    });
    return {
      assessment: {
        code: assessment.code,
        name: assessment.name,
        scaleVersion: assessment.scale_version,
        // #282：每次作答题数（0 = 全量作答）。库里没有这一列（旧库）时按全量作答处理
        itemsPerAttempt: Number(assessment.items_per_attempt ?? 0),
        dimensions: parseDimensions(assessment.dimensions_json),
        questions,
      },
      responses,
    };
  } finally {
    db.close();
  }
}

function parseJson(raw) {
  try {
    return JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
}

function loadFromExport(filePath) {
  if (!existsSync(filePath)) fail(`找不到导出文件：${filePath}`);
  const payload = parseJson(readFileSync(filePath, "utf8"));
  if (!payload || typeof payload !== "object") fail("导出文件不是合法 JSON 对象");
  const assessment = payload.assessment ?? {};
  const dimensions = Array.isArray(assessment.dimensions) ? assessment.dimensions : [];
  const questions = Array.isArray(assessment.questions) ? assessment.questions : [];
  if (dimensions.length === 0) fail("导出文件缺少 assessment.dimensions");
  if (questions.length === 0) fail("导出文件缺少 assessment.questions");
  const responses = Array.isArray(payload.responses) ? payload.responses : [];
  return {
    assessment: {
      code: assessment.code ?? DEFAULT_CODE,
      name: assessment.name ?? "",
      scaleVersion: assessment.scaleVersion ?? "",
      itemsPerAttempt: Number(assessment.itemsPerAttempt ?? assessment.items_per_attempt ?? 0),
      dimensions: dimensions
        .filter((item) => item && typeof item.key === "string")
        .map((item) => ({ key: item.key, label: typeof item.label === "string" ? item.label : item.key })),
      questions: questions
        .filter((item) => item && Number.isInteger(item.index) && typeof item.dimension === "string")
        .map((item) => ({ index: item.index, dimension: item.dimension, reverseScored: item.reverseScored === true })),
    },
    responses: responses.map((item, order) => ({
      studentKey: typeof item.studentKey === "string" && item.studentKey ? item.studentKey : `p${order + 1}`,
      completedAt: typeof item.completedAt === "string" ? item.completedAt : "",
      answers: toNumberMap(item.answers),
      scores: toScoreMap(item.scores),
    })),
  };
}

function parseDimensions(raw) {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item.key === "string")
    .map((item) => ({ key: item.key, label: typeof item.label === "string" ? item.label : item.key }));
}

function daysBetween(first, second) {
  const left = Date.parse(first.replace(" ", "T"));
  const right = Date.parse(second.replace(" ", "T"));
  if (!Number.isFinite(left) || !Number.isFinite(right)) return null;
  return Math.abs(right - left) / 86400000;
}

/** 每人取最后一次完成记录（常模与维度相关按人计权一次，避免重测把同一人重复算进去） */
function latestPerStudent(responses) {
  const byStudent = new Map();
  for (const response of responses) {
    const existing = byStudent.get(response.studentKey);
    if (!existing || response.completedAt >= existing.completedAt) byStudent.set(response.studentKey, response);
  }
  return [...byStudent.values()];
}

function fmt(value, digits = 3) {
  return value === null || value === undefined || Number.isNaN(value) ? "无法计算" : value.toFixed(digits);
}

function analyze({ assessment, responses }, options) {
  const questionsByDimension = new Map();
  for (const dimension of assessment.dimensions) questionsByDimension.set(dimension.key, []);
  for (const question of assessment.questions) {
    if (!questionsByDimension.has(question.dimension)) continue;
    questionsByDimension.get(question.dimension).push(question);
  }
  const reverseFactor = 6; // Likert 1-5 的反向重编码：6 - 值（与计分引擎 REVERSE_FACTOR 同口径）

  // 1) 维度内部一致性：逐维取「该维题目全部有作答」的记录，反向题先重编码
  const reliability = assessment.dimensions.map((dimension) => {
    const questions = questionsByDimension.get(dimension.key) ?? [];
    const rows = [];
    for (const response of responses) {
      const row = questions.map((question) => {
        const value = response.answers[question.index];
        if (typeof value !== "number") return null;
        return question.reverseScored ? reverseFactor - value : value;
      });
      if (row.some((value) => value === null)) continue;
      rows.push(row);
    }
    return summarizeDimension(dimension.key, questions.map((question) => question.index), rows);
  });

  // 2) 维度间相关：每人最后一次结果的六维标准分
  const latest = latestPerStudent(responses);
  const scoreRows = latest.filter((response) =>
    assessment.dimensions.every((dimension) => typeof response.scores[dimension.key] === "number")
  );
  const dimensionKeys = assessment.dimensions.map((dimension) => dimension.key);
  const correlationMatrix = dimensionKeys.map((rowKey) =>
    dimensionKeys.map((colKey) => {
      if (rowKey === colKey) return 1;
      return pearsonCorrelation(
        scoreRows.map((response) => response.scores[rowKey]),
        scoreRows.map((response) => response.scores[colKey])
      );
    })
  );

  // 3) 重测信度：同一匿名键的相邻两次完成，间隔 ≥ minRetestDays；按维度算相关
  const byStudent = new Map();
  for (const response of responses) {
    if (!byStudent.has(response.studentKey)) byStudent.set(response.studentKey, []);
    byStudent.get(response.studentKey).push(response);
  }
  const pairLists = Object.fromEntries(dimensionKeys.map((key) => [key, []]));
  let pairCount = 0;
  for (const list of byStudent.values()) {
    const sorted = [...list].sort((left, right) => left.completedAt.localeCompare(right.completedAt));
    for (let i = 1; i < sorted.length; i += 1) {
      const first = sorted[i - 1];
      const second = sorted[i];
      const gap = daysBetween(first.completedAt, second.completedAt);
      if (gap === null || gap < options.minRetestDays) continue;
      pairCount += 1;
      for (const key of dimensionKeys) {
        if (typeof first.scores[key] !== "number" || typeof second.scores[key] !== "number") continue;
        pairLists[key].push([first.scores[key], second.scores[key]]);
      }
    }
  }
  const retest = dimensionKeys.map((key) => {
    const pairs = pairLists[key];
    const firstScores = pairs.map(([first]) => first);
    const secondScores = pairs.map(([, second]) => second);
    return { dimension: key, pairCount: pairs.length, r: pearsonCorrelation(firstScores, secondScores) };
  });

  // 4) 百分位常模：每人一次（最后一次），样本量决定档位
  const norms = dimensionKeys.map((key) => {
    const values = scoreRows.map((response) => response.scores[key]).filter((value) => typeof value === "number");
    const table = percentileTable(values);
    return { dimension: key, table, band: normSampleBand(values.length) };
  });

  return {
    reliability,
    correlationMatrix,
    dimensionKeys,
    correlationSampleSize: scoreRows.length,
    retest,
    retestPairStudents: byStudent.size,
    pairCount,
    norms,
    completedCount: responses.length,
    studentCount: byStudent.size,
  };
}

function renderMarkdown(analysis, meta, options) {
  const labelOf = (key) => meta.dimensions.find((dimension) => dimension.key === key)?.label ?? key;
  const lines = [];
  lines.push(`# 量表信效度验证报告（${meta.name || meta.code}）`);
  lines.push("");
  lines.push(`> 由 \`scripts/validate-assessment.mjs\`（#227）自动生成于 ${new Date().toLocaleString("sv-SE", { timeZone: "Asia/Shanghai" })}。`);
  lines.push("> 本报告只含聚合统计，不含任何学生身份信息或单条作答明细。O*NET Tools Developer License 要求对改编产品做信效度验证，结论需经指导教师审阅。");
  lines.push("");
  lines.push("## 1. 样本");
  lines.push("");
  lines.push(`- 量表：\`${meta.code}\`${meta.scaleVersion ? `（量表版本 ${meta.scaleVersion}）` : ""}，${meta.questions.length} 题 / ${meta.dimensions.length} 维`);
  lines.push(
    meta.itemsPerAttempt > 0 && meta.itemsPerAttempt < meta.questions.length
      ? `- 施测口径：每次作答 **${meta.itemsPerAttempt}** 题（#282 分层抽题，每人只答到题库的一部分）`
      : "- 施测口径：全量作答（`items_per_attempt = 0`，题库即本轮）"
  );
  lines.push(`- 完成记录数：**${analysis.completedCount}**；去重后的匿名被试数：**${analysis.studentCount}**`);
  lines.push(`- 参与维度相关与常模分析的样本（六维齐全）：**${analysis.correlationSampleSize}**`);
  lines.push(`- 常模最小样本量要求：${NORM_MIN_SAMPLE}（推荐 ${NORM_RECOMMENDED_SAMPLE}）`);
  lines.push("");
  lines.push("## 2. 内部一致性（Cronbach's α）与题总相关");
  lines.push("");
  lines.push(`判定线：α ≥ 0.7 可接受、≥ 0.8 良好；校正题总相关（CITC）建议 ≥ ${CITC_MIN}。`);
  lines.push("");
  // #282 之后每次只答题库的一部分，逐题一致性统计要求同一套题目在被试间可比，抽样卷直接算必然全为 0 样本
  const sampled = meta.itemsPerAttempt > 0 && meta.itemsPerAttempt < meta.questions.length;
  if (sampled && analysis.reliability.every((item) => item.sampleSize === 0)) {
    lines.push(
      `本次数据是分层抽题口径（每人 ${meta.itemsPerAttempt} 题 / 题库 ${meta.questions.length} 题），` +
        "没有人答满某一维的全部题目，α 与 CITC **在这批数据上不可计算**——这是口径限制，不是题库缺陷。"
    );
    lines.push("");
    lines.push("题目质量回收请改用**全量作答**的试测数据（把 `assessments.items_per_attempt` 临时置 0 施测，或按 #284 班级试测方案取全量卷）。");
  } else {
    lines.push("| 维度 | 题数 | 有效样本 | α | 判定 | CITC 低于阈值或无法计算的题号 |");
    lines.push("|---|---|---|---|---|---|");
    for (const item of analysis.reliability) {
      lines.push(
        `| ${labelOf(item.dimension)}（${item.dimension}） | ${item.itemCount} | ${item.sampleSize} | ${fmt(item.alpha)} | ${item.band ? BAND_LABELS[item.band] : "无法计算"} | ${item.lowCitc.length > 0 ? item.lowCitc.join("、") : "—"} |`
      );
    }
  }
  lines.push("");
  lines.push("## 3. 维度间相关（区分效度参考）");
  lines.push("");
  if (analysis.correlationSampleSize < 2) {
    lines.push("样本不足（< 2），无法计算维度间相关。");
  } else {
    lines.push(`样本：${analysis.correlationSampleSize} 人（每人最后一次结果）。`);
    lines.push("");
    lines.push(`| 维度 | ${analysis.dimensionKeys.map((key) => `${labelOf(key)}`).join(" | ")} |`);
    lines.push(`|---|${analysis.dimensionKeys.map(() => "---").join("|")}|`);
    analysis.dimensionKeys.forEach((rowKey, rowIndex) => {
      const cells = analysis.dimensionKeys.map((_, colIndex) => {
        if (rowIndex === colIndex) return "1";
        return fmt(analysis.correlationMatrix[rowIndex][colIndex]);
      });
      lines.push(`| ${labelOf(rowKey)} | ${cells.join(" | ")} |`);
    });
    lines.push("");
    lines.push("> 参考：同一量表内六维之间应为中等正相关；若某两维相关接近 0 或为负，需复核该维题目是否测到了不同构念。");
  }
  lines.push("");
  lines.push("## 4. 重测信度");
  lines.push("");
  lines.push(
    `口径：同一被试相邻两次完成、间隔 ≥ ${options.minRetestDays} 天；判定线 r ≥ ${RETEST_ACCEPTABLE}。共 ${analysis.pairCount} 对可配对记录（涉及 ${analysis.retestPairStudents} 名匿名被试）。`
  );
  lines.push("");
  if (analysis.pairCount === 0) {
    lines.push("暂无满足间隔要求的重测配对——需要同一批学生间隔一周以上完成两次测评后再跑一次本脚本。");
  } else {
    lines.push("| 维度 | 配对样本 | r | 判定 |");
    lines.push("|---|---|---|---|");
    for (const item of analysis.retest) {
      const verdict = item.r === null ? "无法计算" : item.r >= RETEST_ACCEPTABLE ? "达标" : "未达标";
      lines.push(`| ${labelOf(item.dimension)}（${item.dimension}） | ${item.pairCount} | ${fmt(item.r)} | ${verdict} |`);
    }
  }
  lines.push("");
  lines.push("## 5. 百分位常模（候选）");
  lines.push("");
  lines.push("| 维度 | 样本 | P10 | P25 | P50 | P75 | P90 | 样本量档位 |");
  lines.push("|---|---|---|---|---|---|---|---|");
  for (const item of analysis.norms) {
    const table = item.table;
    const bandLabel =
      item.band === "recommended" ? "推荐（≥100）" : item.band === "minimum" ? "刚够（≥60）" : "不足（<60，仅供内部参考）";
    lines.push(
      `| ${labelOf(item.dimension)}（${item.dimension}） | ${table?.sampleSize ?? 0} | ${table ? fmt(table.p10, 1) : "—"} | ${table ? fmt(table.p25, 1) : "—"} | ${table ? fmt(table.p50, 1) : "—"} | ${table ? fmt(table.p75, 1) : "—"} | ${table ? fmt(table.p90, 1) : "—"} | ${bandLabel} |`
    );
  }
  lines.push("");
  lines.push("> 样本量不足时**不得对外发布常模**，也不应把百分位写进学生端展示；常模替换实现见方案文档「常模实施预案」。");
  lines.push("");
  lines.push("## 6. 判定汇总");
  lines.push("");
  const alphaOk = analysis.reliability.every((item) => item.alpha !== null && item.alpha >= 0.7);
  const citcOk = analysis.reliability.every((item) => item.lowCitc.length === 0);
  const retestOk = analysis.retest.every((item) => item.r !== null && item.r >= RETEST_ACCEPTABLE);
  const normOk = analysis.norms.every((item) => item.band !== "insufficient");
  lines.push(`- 内部一致性：${alphaOk ? "达标" : "**未全部达标**"}（${analysis.reliability.length} 维 α ≥ 0.7）`);
  lines.push(`- 题总相关：${citcOk ? "达标" : "**存在低 CITC 题**，见第 2 节"}`);
  lines.push(`- 重测信度：${analysis.pairCount === 0 ? "数据不足" : retestOk ? "达标" : "**未全部达标**"}（r ≥ ${RETEST_ACCEPTABLE}）`);
  lines.push(`- 常模样本量：${normOk ? "达到最低要求" : "**不足（< 60）**，暂不发布常模"}`);
  lines.push(`- 校标效度（与英文原版得分相关）：本脚本不覆盖——需同一批学生双答（中文改编版 + 英文原版）后单独分析。`);
  lines.push("");
  lines.push("## 7. 局限与声明");
  lines.push("");
  lines.push("- 样本来自单校/单班级时代表性有限，结论只适用于同类人群；扩大样本后应重跑本脚本。");
  lines.push("- α 与重测相关是**内部一致性 / 稳定性**证据，不构成内容效度与效标关联效度的完整证明；后者需专家审题与外部校标（见方案文档）。");
  lines.push("- 本报告是数据处理结果，不是验证结论；对外使用需指导教师 / 学科负责人审阅签字。");
  lines.push("- O*NET 内容依据 O*NET Tools Developer License（CC BY 4.0 数据库）使用，分发时需保留署名与「修改未经 USDOL/ETA 审核、认可或测试」的声明。");
  lines.push("");
  return lines.join("\n");
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db && !args.export) fail("请指定数据来源：--db <sqlite 路径> 或 --export <json 路径>（--help 查看用法）");
  if (!Number.isFinite(args.minRetestDays) || args.minRetestDays < 0) fail("--min-interval-days 必须是非负数");

  const dataset = args.export ? loadFromExport(path.resolve(args.export)) : loadFromDb(path.resolve(args.db), args.code);
  if (dataset.assessment.dimensions.length === 0) fail("量表的维度定义为空，无法分析");
  if (dataset.assessment.questions.length === 0) fail("题库为空，无法分析");

  const analysis = analyze(dataset, { minRetestDays: args.minRetestDays });
  const markdown = renderMarkdown(analysis, dataset.assessment, { minRetestDays: args.minRetestDays });

  if (args.out) {
    const outPath = path.resolve(args.out);
    writeFileSync(outPath, markdown, "utf8");
    console.log(`✓ 报告已写入 ${outPath}`);
  } else {
    console.log(markdown);
  }

  if (dataset.responses.length === 0) {
    console.warn("⚠ 没有已完成记录：报告只有空表与说明。等有真实作答数据后再跑一次。");
  }

  if (args.strict) {
    const alphaOk = analysis.reliability.every((item) => item.alpha !== null && item.alpha >= 0.7);
    const retestOk = analysis.retest.every((item) => item.r !== null && item.r >= RETEST_ACCEPTABLE);
    const normOk = analysis.norms.every((item) => item.band !== "insufficient");
    if (!alphaOk || !retestOk || !normOk) {
      console.error("✗ --strict：存在未达标项（见报告第 6 节）");
      process.exit(2);
    }
  }
}

main();
