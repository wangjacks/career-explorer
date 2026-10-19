#!/usr/bin/env node
/**
 * O*NET 职业库离线导入脚本（#226）。
 *
 * 用途：把 O*NET 数据库发布包里跟「兴趣匹配」有关的三张表解析成 `src/lib/onet-data.ts`，
 * 让运行时**不依赖任何外部文件/网络**；数据库里的 `onet_occupations` 表在初始化时由该模块
 * 幂等重灌（见两适配器的 `seedOnetOccupations`）。
 *
 * 为什么锁定 30.2：O*NET 从 30.3 起把职业级 Interest 分（`Interests.txt`）从数据库发布包里移除了，
 * 30.2 是**最后一个仍带 RIASEC 六型职业分**的发布版（30.0–30.2 的数据字典仍有 interests 域）。
 *
 * 用法：
 *   # 1) 下载并解压文本版发布包（约 13MB，CC BY 4.0）
 *   #    https://www.onetcenter.org/dl_files/database/db_30_2_text.zip
 *   # 2) 生成数据模块
 *   node scripts/import-onet.mjs C:\path\to\db_30_2_text
 *
 * 输出字段：
 *   - code        O*NET-SOC Code（如 15-1252.00）
 *   - title       英文职业名（`Occupation Data.txt`）
 *   - interestCode O*NET 官方兴趣高码（由 `Interests.txt` 的 First/Second/Third Interest High-Point
 *                 指标推导，字母序即高到低；部分职业只有 1–2 位，因为后续维度并列）
 *   - 六型分       Realistic / Investigative / Artistic / Social / Enterprising / Conventional（1–7）
 *   - jobZone     `Job Zones.txt` 的 1–5（1 表示几乎不需要准备）
 *
 * 只收录六型分与 Job Zone 齐全的职业（30.2 共 923 个；发布包里另有 93 个无 Interest 数据的职业不收录）。
 * 中文译名**不写进生成文件**（重新生成时会丢），统一维护在 `src/lib/onet-name-zh.ts`。
 */

import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

const RIASEC = [
  { element: "Realistic", key: "R" },
  { element: "Investigative", key: "I" },
  { element: "Artistic", key: "A" },
  { element: "Social", key: "S" },
  { element: "Enterprising", key: "E" },
  { element: "Conventional", key: "C" },
];

const HIGH_POINTS = ["First Interest High-Point", "Second Interest High-Point", "Third Interest High-Point"];

function fail(message) {
  console.error(`✗ ${message}`);
  process.exit(1);
}

/** 读取制表符分隔的 O*NET 文本表，返回以表头为键的对象数组 */
function readTable(releaseDir, fileName) {
  const filePath = join(releaseDir, fileName);
  let text;
  try {
    text = readFileSync(filePath, "utf8");
  } catch {
    fail(`读不到 ${filePath}（请先解压 O*NET 文本版发布包）`);
  }
  const lines = text.split(/\r?\n/).filter((line) => line.length > 0);
  if (lines.length < 2) fail(`${fileName} 只有 ${lines.length} 行，不像 O*NET 数据表`);
  const header = lines[0].split("\t");
  const required = header.length;
  return lines.slice(1).map((line) => {
    const cells = line.split("\t");
    if (cells.length < required) fail(`${fileName} 有一行列数不足：${line.slice(0, 80)}`);
    const row = {};
    header.forEach((name, index) => {
      row[name] = cells[index];
    });
    return row;
  });
}

function round2(value) {
  return Math.round(value * 100) / 100;
}

/** 数值按两位小数输出，整数不补 .00，减小生成文件体积、让 diff 稳定 */
function num(value) {
  const rounded = round2(value);
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(2);
}

function main() {
  const args = process.argv.slice(2);
  const releaseDir = args.find((arg) => !arg.startsWith("--"));
  if (!releaseDir) {
    fail("用法：node scripts/import-onet.mjs <解压后的 O*NET 文本版目录> [--out <输出路径>] [--version 30.2]");
  }
  const outIndex = args.indexOf("--out");
  const outPath = outIndex >= 0 ? resolve(args[outIndex + 1]) : resolve("src/lib/onet-data.ts");
  const versionIndex = args.indexOf("--version");
  const version = versionIndex >= 0 ? args[versionIndex + 1] : "30.2";

  const interests = readTable(releaseDir, "Interests.txt");
  const occupations = readTable(releaseDir, "Occupation Data.txt");
  const jobZones = readTable(releaseDir, "Job Zones.txt");

  const titles = new Map(occupations.map((row) => [row["O*NET-SOC Code"], row.Title]));
  const zones = new Map(jobZones.map((row) => [row["O*NET-SOC Code"], Number(row["Job Zone"])]));

  // 按职业聚合六型分与官方高码
  const byCode = new Map();
  for (const row of interests) {
    const code = row["O*NET-SOC Code"];
    if (!byCode.has(code)) byCode.set(code, new Map());
    byCode.get(code).set(row["Element Name"], row["Data Value"]);
  }

  const records = [];
  for (const [code, elements] of byCode) {
    const title = titles.get(code);
    const jobZone = zones.get(code);
    if (!title || !Number.isInteger(jobZone)) continue; // 无标题 / 无 Job Zone 的职业不收录

    const scores = RIASEC.map(({ element }) => Number(elements.get(element)));
    if (scores.some((value) => !Number.isFinite(value) || value < 1 || value > 7)) {
      fail(`${code} 的六型分异常：${scores.join(", ")}`);
    }

    const interestCode = HIGH_POINTS.map((name) => Number(elements.get(name) ?? 0))
      .filter((index) => index >= 1 && index <= 6)
      .map((index) => RIASEC[index - 1].key)
      .join("");
    if (!interestCode) fail(`${code} 缺少兴趣高码`);

    records.push({ code, title, interestCode, scores, jobZone });
  }

  records.sort((a, b) => (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));

  const seen = new Set();
  for (const record of records) {
    if (seen.has(record.code)) fail(`职业 code 重复：${record.code}`);
    seen.add(record.code);
    if (!/^\d{2}-\d{4}\.\d{2}$/.test(record.code)) fail(`职业 code 格式异常：${record.code}`);
    if (record.jobZone < 1 || record.jobZone > 5) fail(`${record.code} 的 Job Zone 越界：${record.jobZone}`);
  }

  const rows = records
    .map(({ code, title, interestCode, scores, jobZone }) => {
      const escapedTitle = title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
      return `  ["${code}", "${escapedTitle}", "${interestCode}", ${scores.map(num).join(", ")}, ${jobZone}],`;
    })
    .join("\n");

  const output = `/**
 * O*NET 职业库数据快照（自动生成，请勿手改）。
 *
 * 来源：O*NET Database ${version}（美国劳工部就业与培训署），依照 CC BY 4.0 使用。
 * 发布页：https://www.onetcenter.org/database.html
 * 授权说明：https://www.onetcenter.org/license_db.html
 * 生成命令：node scripts/import-onet.mjs <解压后的 O*NET 文本版目录> --version ${version}
 *
 * 只收录六型分与 Job Zone 齐全的职业（${records.length} 个）。发布包中另有缺少 Interest 数据的新职业未收录。
 * 中文译名维护在 src/lib/onet-name-zh.ts（重新生成本文件不会覆盖译名）。
 *
 * 元组布局：[code, title, interestCode, R, I, A, S, E, C, jobZone]
 *   - interestCode 是 O*NET 官方兴趣高码（First/Second/Third Interest High-Point 推导，可能只有 1–2 位）
 *   - 六型分为 O*NET 原始 1–7 分
 */

export const ONET_DATASET_VERSION = "${version}";
export const ONET_DATASET_TITLE = "O*NET Database ${version}";
export const ONET_DATASET_URL = "https://www.onetcenter.org/database.html";
export const ONET_LICENSE_URL = "https://www.onetcenter.org/license_db.html";

/** 生成文件里一行职业数据的元组形状（顺序与下方数组一致） */
export type OnetOccupationTuple = readonly [
  code: string,
  title: string,
  interestCode: string,
  realistic: number,
  investigative: number,
  artistic: number,
  social: number,
  enterprising: number,
  conventional: number,
  jobZone: number,
];

export const ONET_OCCUPATIONS: readonly OnetOccupationTuple[] = [
${rows}
];
`;

  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, output, "utf8");
  console.log(`✓ ${records.length} 个职业 → ${outPath}（O*NET ${version}）`);
  const zoneDist = {};
  for (const record of records) zoneDist[record.jobZone] = (zoneDist[record.jobZone] ?? 0) + 1;
  console.log(`  Job Zone 分布：${JSON.stringify(zoneDist)}`);
  console.log(`  兴趣高码长度分布：${JSON.stringify(records.reduce((acc, r) => ({ ...acc, [r.interestCode.length]: (acc[r.interestCode.length] ?? 0) + 1 }), {}))}`);
}

main();
