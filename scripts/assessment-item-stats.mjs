#!/usr/bin/env node
/**
 * 题目质量回收的只读统计脚本（#285）。
 *
 * 用法：
 *   node scripts/assessment-item-stats.mjs --db ./data/career.db [--code riasec] [--out items.csv]
 *   node scripts/assessment-item-stats.mjs --export ./item-responses.json [--out items.csv]
 *
 * 数据来源只有 `assessment_results` 的**完成记录**：`items_json` 抽题快照 + `answers_json` 作答。
 * 只读打开 SQLite（`readonly: true`），不写任何表、不碰 `updated_at`；MySQL 部署先按
 * `docs/assessment-validation.md` §7.4 导出匿名 JSON，再用 `--export` 跑。
 *
 * 隐私：SQL 不取 user_id，CSV 只有题目级聚合（题号 / 来源 / 样本量 / 均值 / 标准差 / r_it / α），
 * 不含姓名、学号、班级或任何单条作答明细。
 *
 * 统计口径、阈值与 CSV 生成在 `src/lib/assessment-item-stats.ts`（有单测），本脚本只做取数与排版。
 * 淘汰结论必须来自真实作答数据（单题 n ≥ 50）；演示数据、主观印象不能作为退役依据。
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import Database from "better-sqlite3";
import {
  ALPHA_FORM_MIN_SAMPLE,
  DIMENSION_ALPHA_MIN,
  ITEM_MEAN_CEILING,
  ITEM_MEAN_FLOOR,
  ITEM_MIN_SAMPLE,
  ITEM_RIT_MIN,
  SOURCE_MEAN_GAP_MAX,
  analyzeItemQuality,
  toItemCsv,
} from "../src/lib/assessment-item-stats.ts";
import {
  RIASEC_CODE,
  SAMPLING_EXCLUDED_ORIGINS,
  SAMPLING_RETIRED_INDEXES,
} from "../src/lib/assessment-data.ts";
import { parseItemsSnapshot } from "../src/lib/assessment-snapshot.ts";

const DEFAULT_CODE = "riasec";
const ALLOWED_ORIGINS = new Set(["onet-mini", "onet-sf", "cn-original", "ipip"]);

function parseArgs(argv) {
  const args = { db: "", export: "", code: DEFAULT_CODE, out: "", strict: false };
  for (let i = 0; i < argv.length; i += 1) {
    const current = argv[i];
    const next = argv[i + 1];
    if (current === "--db") {
      args.db = next ?? "";
      i += 1;
    } else if (current === "--export") {
      args.export = next ?? "";
      i += 1;
    } else if (current === "--code") {
      args.code = next ?? DEFAULT_CODE;
      i += 1;
    } else if (current === "--out") {
      args.out = next ?? "";
      i += 1;
    } else if (current === "--strict") {
      args.strict = true;
    } else if (current === "--help" || current === "-h") {
      console.log(
        "用法：node scripts/assessment-item-stats.mjs (--db <sqlite> | --export <json>) [--code riasec] [--out <csv>] [--strict]"
      );
      console.log("  只读统计逐题均值 / 标准差 / r_it / 维度 α，输出 CSV；不含任何学生身份信息。");
      process.exit(0);
    }
  }
  return args;
}

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

function parseJson(raw) {
  try {
    return JSON.parse(raw ?? "null");
  } catch {
    return null;
  }
}

/** 题号 → 1–5 作答：与 `validate-assessment.mjs` 同一清洗口径，脏值直接丢弃 */
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

function parseDimensions(raw) {
  const parsed = parseJson(raw);
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item.key === "string" && typeof item.label === "string")
    .map((item) => ({ key: item.key, label: item.label }));
}

function normalizeQuestion(row) {
  const index = Number(row?.index ?? row?.question_index);
  const dimension = row?.dimension;
  const origin = row?.origin ?? "cn-original";
  if (!Number.isInteger(index) || index < 1) return null;
  if (typeof dimension !== "string" || !dimension) return null;
  if (!ALLOWED_ORIGINS.has(origin)) return null;
  return {
    index,
    dimension,
    origin,
    // SQLite 返回 0/1，匿名 JSON 用布尔值；两种都接受
    reverseScored: Boolean(row?.reverseScored ?? row?.reverse_scored ?? false),
    version: Number.isInteger(row?.version) && row.version > 0 ? row.version : 1,
    prompt: typeof row?.prompt === "string" ? row.prompt : "",
  };
}

/**
 * 从 SQLite 只读取数。刻意不 SELECT `user_id`：脚本没有「按人」分析的需求，
 * 少取一列就少一份个人数据的搬运面。
 */
function loadFromDb(dbPath, code) {
  if (!existsSync(dbPath)) fail(`找不到数据库文件：${dbPath}`);
  const db = new Database(dbPath, { readonly: true });
  try {
    const assessment = db.prepare("SELECT * FROM assessments WHERE code = ?").get(code);
    if (!assessment) fail(`数据库里没有 code=${code} 的量表（先启动一次应用完成建表与种子）`);
    const itemsPerAttempt = Number(assessment.items_per_attempt ?? 0);
    const dimensions = parseDimensions(assessment.dimensions_json);
    if (dimensions.length === 0) fail(`量表 ${code} 的 dimensions_json 为空，无法分组`);
    const questions = db
      .prepare(
        `SELECT question_index, dimension, origin, reverse_scored, version, prompt
           FROM assessment_questions
          WHERE assessment_id = ?
          ORDER BY question_index`
      )
      .all(assessment.id)
      .map(normalizeQuestion)
      .filter(Boolean);
    if (questions.length === 0) fail(`量表 ${code} 的题库为空，无法统计`);
    const bankIndexes = questions.map((question) => question.index);
    const bankSet = new Set(bankIndexes);
    const rows = db
      .prepare(
        `SELECT answers_json, items_json
           FROM assessment_results
          WHERE assessment_id = ? AND status = 'completed'
          ORDER BY id`
      )
      .all(assessment.id);

    const attempts = [];
    let skippedNoSnapshot = 0;
    let skippedEmpty = 0;
    for (const row of rows) {
      const answers = toNumberMap(parseJson(row.answers_json));
      const snapshot = parseItemsSnapshot(row.items_json);
      let indexes = snapshot?.indexes;
      if (!indexes) {
        // 抽样量表的完成记录必须有快照；没有就无法判断本轮题集，宁可跳过也不猜。
        // 全量作答的量表（items_per_attempt = 0）快照为空是合法的旧数据：整库即本轮。
        if (itemsPerAttempt > 0) {
          skippedNoSnapshot += 1;
          continue;
        }
        indexes = bankIndexes;
      }
      const round = indexes.filter((index) => bankSet.has(index));
      if (round.length === 0) {
        skippedEmpty += 1;
        continue;
      }
      attempts.push({ indexes: round, answers });
    }

    return {
      assessment: {
        code: assessment.code,
        name: assessment.name ?? "",
        scaleVersion: assessment.scale_version ?? "",
        itemsPerAttempt,
        dimensions,
      },
      questions,
      attempts,
      skippedAttemptCount: skippedNoSnapshot + skippedEmpty,
      skippedNoSnapshot,
      skippedEmpty,
    };
  } finally {
    db.close();
  }
}

/**
 * 匿名导出 JSON（MySQL 部署 / 研究者复核用）：
 * {
 *   "assessment": { "code", "name", "scaleVersion", "itemsPerAttempt", "dimensions": [{key,label}] },
 *   "questions": [{ "index", "dimension", "origin", "reverseScored", "version", "prompt" }],
 *   "attempts": [{ "indexes": [..], "answers": { "1": 4, ... } }]
 * }
 * `attempts` 不带 studentKey：逐题统计不需要被试配对，也就没有可识别信息。
 * `answers` 保留**原始** 1–5 作答；`reverseScored` 必填（DB 侧取自 `reverse_scored`），
 * 由 `src/lib/assessment-item-stats.ts` 统一按 6 − 值 转换后再统计。
 */
function loadFromExport(filePath) {
  if (!existsSync(filePath)) fail(`找不到导出文件：${filePath}`);
  const payload = parseJson(readFileSync(filePath, "utf8"));
  if (!payload || typeof payload !== "object") fail("导出文件不是合法 JSON 对象");
  const assessment = payload.assessment ?? {};
  const dimensions = Array.isArray(assessment.dimensions)
    ? assessment.dimensions
        .filter((item) => item && typeof item.key === "string" && typeof item.label === "string")
        .map((item) => ({ key: item.key, label: item.label }))
    : [];
  if (dimensions.length === 0) fail("导出文件缺少 assessment.dimensions");
  const questions = Array.isArray(payload.questions)
    ? payload.questions.map(normalizeQuestion).filter(Boolean)
    : [];
  if (questions.length === 0) fail("导出文件缺少 questions（至少一题）");
  const itemsPerAttempt = Number(assessment.itemsPerAttempt ?? assessment.items_per_attempt ?? 0);
  const bankIndexes = questions.map((question) => question.index);
  const bankSet = new Set(bankIndexes);
  const attempts = [];
  let skippedNoSnapshot = 0;
  let skippedEmpty = 0;
  for (const item of Array.isArray(payload.attempts) ? payload.attempts : []) {
    if (!item || typeof item !== "object") continue;
    const answers = toNumberMap(item.answers);
    let indexes = Array.isArray(item.indexes) ? item.indexes : null;
    if (!indexes) {
      if (itemsPerAttempt > 0) {
        skippedNoSnapshot += 1;
        continue;
      }
      indexes = bankIndexes;
    }
    const round = indexes.filter(
      (index) => Number.isInteger(index) && bankSet.has(index)
    );
    if (round.length === 0) {
      skippedEmpty += 1;
      continue;
    }
    attempts.push({ indexes: round, answers });
  }
  return {
    assessment: {
      code: assessment.code ?? DEFAULT_CODE,
      name: assessment.name ?? "",
      scaleVersion: assessment.scaleVersion ?? assessment.scale_version ?? "",
      itemsPerAttempt,
      dimensions,
    },
    questions,
    attempts,
    skippedAttemptCount: skippedNoSnapshot + skippedEmpty,
    skippedNoSnapshot,
    skippedEmpty,
  };
}

/** 给人看的运行摘要走 stderr，stdout 只留 CSV（可直接重定向给 Excel / pandas） */
function printSummary(report, dataset) {
  const statusCount = { active: 0, "origin-gated": 0, retired: 0 };
  const verdictCount = { keep: 0, retire: 0, insufficient: 0 };
  for (const item of report.items) {
    statusCount[item.samplingStatus] += 1;
    verdictCount[item.verdict] += 1;
  }
  console.error(
    `  完成记录：${report.attemptCount} 条参与统计，${report.skippedAttemptCount} 条跳过` +
      (dataset.skippedNoSnapshot > 0 ? `（其中 ${dataset.skippedNoSnapshot} 条缺有效抽题快照）` : "")
  );
  console.error(
    `  题目：${report.items.length} 题（在用 ${statusCount.active} / 来源未放行 ${statusCount["origin-gated"]} / 已退役 ${statusCount.retired}）`
  );
  console.error(
    `  逐题判定：达标 ${verdictCount.keep} / 建议淘汰 ${verdictCount.retire} / 样本不足 ${verdictCount.insufficient}`
  );
  for (const dimension of report.dimensions) {
    const alpha = dimension.alpha === null ? "无法计算" : dimension.alpha.toFixed(3);
    console.error(
      `  维度 ${dimension.key}：单题 n≥${ITEM_MIN_SAMPLE} 的 ${dimension.analyzedItems}/${dimension.itemCount} 题，` +
        `α 可计算 ${dimension.alphaForms}/${dimension.alphaFormTotal} 组（每组至少 ${ALPHA_FORM_MIN_SAMPLE} 人；` +
        `加权 α ${alpha}，低于 ${DIMENSION_ALPHA_MIN} 的 ${dimension.alphaFormsBelow} 组）`
    );
  }
  const retire = report.items.filter((item) => item.verdict === "retire");
  if (retire.length > 0) {
    console.error(
      `  ⚠ 建议淘汰：${retire
        .map((item) => `${item.index}（${item.flags.join("|")}）`)
        .join("、")}`
    );
  }
  const review = report.dimensions.filter((dimension) => dimension.verdict === "review");
  if (review.length > 0) {
    console.error(`  ⚠ 需复查题池的维度：${review.map((dimension) => dimension.key).join("、")}`);
  }
  const sourceReview = report.dimensions.filter(
    (dimension) => dimension.sourceVerdict === "review-original"
  );
  if (sourceReview.length > 0) {
    console.error(
      `  ⚠ 来源差异超过 ${SOURCE_MEAN_GAP_MAX} 分、需整批复评原创题的维度：${sourceReview
        .map((dimension) => dimension.key)
        .join("、")}`
    );
  }
  if (report.attemptCount === 0) {
    console.error("  ⚠ 没有可分析的完成记录：CSV 只有表头。等有真实作答数据后再跑一次。");
  }
  if (SAMPLING_EXCLUDED_ORIGINS.has("cn-original") && dataset.assessment.code === RIASEC_CODE) {
    console.error(
      "  ⚠ 原创题当前未放行（#284）：来源差异只覆盖官方题，原创题复评前须先恢复放行。"
    );
  }
  if (SAMPLING_RETIRED_INDEXES.size === 0 && dataset.assessment.code === RIASEC_CODE) {
    console.error("  退役台账为空：尚未执行过换题（回收结论必须来自真实数据，不能凭演示数据填）。");
  }
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.db && !args.export) {
    fail("请指定数据来源：--db <sqlite 路径> 或 --export <json 路径>（--help 查看用法）");
  }
  if (args.db && args.export) fail("--db 与 --export 只能选一个");

  const dataset = args.export
    ? loadFromExport(path.resolve(args.export))
    : loadFromDb(path.resolve(args.db), args.code);
  // 放行门与退役台账只属于 RIASEC；题号在量表间会重复，其它量表按空集标注
  const isRiasec = dataset.assessment.code === RIASEC_CODE;
  const report = analyzeItemQuality({
    questions: dataset.questions,
    attempts: dataset.attempts,
    dimensions: dataset.assessment.dimensions,
    excludedOrigins: isRiasec ? SAMPLING_EXCLUDED_ORIGINS : new Set(),
    retiredIndexes: isRiasec ? SAMPLING_RETIRED_INDEXES : new Set(),
    skippedAttemptCount: dataset.skippedAttemptCount,
  });
  const csv = toItemCsv(report);

  if (args.out) {
    const outPath = path.resolve(args.out);
    // BOM：中文表头 / 题面在 Excel 里直接双击打开不乱码；纯 stdout 不加，方便管道处理
    writeFileSync(outPath, `\uFEFF${csv}`, "utf8");
    console.error(`✓ CSV 已写入 ${outPath}`);
  } else {
    process.stdout.write(csv);
  }
  printSummary(report, dataset);

  if (args.strict) {
    const hasRetire = report.items.some((item) => item.verdict === "retire");
    const hasReview = report.dimensions.some(
      (dimension) => dimension.verdict === "review" || dimension.sourceVerdict === "review-original"
    );
    if (hasRetire || hasReview) {
      console.error(
        `✗ --strict：存在建议淘汰题或需复查维度（阈值：均值 ${ITEM_MEAN_FLOOR}–${ITEM_MEAN_CEILING}、r_it ≥ ${ITEM_RIT_MIN}、α ≥ ${DIMENSION_ALPHA_MIN}）`
      );
      process.exitCode = 2;
    }
  }
}

main();
