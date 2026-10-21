/**
 * 教师端「人格轮廓」统计口径（#312）：纯函数，把逐人结果快照归并成五维三档计数。
 *
 * 数据边界：入参只有 `{ user_id, scores_json, completed_at }`，输出只有计数与维度标签——
 * **个人分数绝不外泄**（没有 raw / standard / 逐人明细 / 平均分 / 排名）。接口响应里能搜到的
 * 只有 `low / medium / high` 三个整数。
 *
 * 口径：
 * - 维度顺序恒为量表定义顺序（`assessments.dimensions_json`，当前 N/E/O/A/C），**不按分值排序**，
 *   避免教师误以为「排第一的是好的」；定义里的维度全部输出，计数为 0 也保留。
 * - 三档优先读快照里已落库的 `band`；旧快照缺 `band` 时用 `bandOf(standard)` 兜底（阈值 66.7 / 33.3）。
 * - 脏数据只影响它自己那一行：整条 JSON 解析失败、缺维度、`standard` 非有限数值都计入
 *   `invalidCount`，不进分布。这样 `low + medium + high` 恒等于 `已测人数 - invalidCount`，
 *   界面不会出现 `NaN`，也不会因为一条坏记录让整张卡 500。
 */

import type { DimensionalResultScoreRow } from "./db";
import { bandOf, type ScoreBand } from "./assessment-scoring";

/** 量表定义里的一个维度（顺序即展示顺序） */
export interface DimensionalBandsDimension {
  key: string;
  label: string;
  low: number;
  medium: number;
  high: number;
}

export interface DimensionalBandsResult {
  dimensions: DimensionalBandsDimension[];
  /** 快照不可解析/缺维度/标准分非数字的**人数**（同一学生多条当前记录按一人计） */
  invalidCount: number;
  /** 最近一次提交时间（原样返回库内 TEXT）；没有人提交时为 null */
  lastSubmittedAt: string | null;
}

/** 空文本/空白的时间视为「没有时间」（库里 TEXT 列历史上有空串脏数据） */
function normalizeTime(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * 归一量表维度定义：保留定义顺序、剔除空 key 与重复 key。
 *
 * 路由的 `assessment.dimensions` 与三档计数共用这一份口径；否则 `dimensions_json` 有重复 key 时，
 * 元信息会比分布多出一项。
 */
export function normalizeDimensionalDefinitions(
  dimensions: readonly { key: string; label: string }[]
): { key: string; label: string }[] {
  const definitions: { key: string; label: string }[] = [];
  const seenKeys = new Set<string>();
  for (const dimension of dimensions) {
    if (typeof dimension.key !== "string" || dimension.key === "") continue;
    if (seenKeys.has(dimension.key)) continue;
    seenKeys.add(dimension.key);
    definitions.push({ key: dimension.key, label: dimension.label });
  }
  return definitions;
}

function readBand(value: unknown): ScoreBand | null {
  return value === "high" || value === "medium" || value === "low" ? value : null;
}

/** 快照 JSON → `key → 原始条目`；解析失败/非数组返回 null（整行判脏） */
function readScoreEntries(raw: string | null | undefined): Map<string, Record<string, unknown>> | null {
  if (typeof raw !== "string" || raw.trim() === "") return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return null;
    const entries = new Map<string, Record<string, unknown>>();
    for (const item of parsed) {
      if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
      const entry = item as Record<string, unknown>;
      const key = entry.key;
      // 同一维度重复出现时只认第一条：快照由计分引擎按定义顺序生成，重复属于脏数据
      if (typeof key !== "string" || key === "" || entries.has(key)) continue;
      entries.set(key, entry);
    }
    return entries;
  } catch (err) {
    console.error("Big five scores parse error:", err);
    return null;
  }
}

/**
 * 逐人快照 → 五维三档计数。
 *
 * 同一学生若出现多条 `is_current` 记录（数据异常），只认 `completed_at` 最新的一条，
 * 与 `getCompletionStats` 的 `COUNT(DISTINCT user_id)` 分母保持一致。
 */
export function parseDimensionalBands(
  rows: readonly DimensionalResultScoreRow[],
  dimensions: readonly { key: string; label: string }[]
): DimensionalBandsResult {
  // 定义顺序唯一来源；脏定义（空 key/重复 key）逐项剔除，不整份失败
  const definitions = normalizeDimensionalDefinitions(dimensions);

  const latestByUser = new Map<number, DimensionalResultScoreRow>();
  for (const row of rows) {
    const existing = latestByUser.get(row.user_id);
    if (!existing) {
      latestByUser.set(row.user_id, row);
      continue;
    }
    const nextTime = normalizeTime(row.completed_at) ?? "";
    const currentTime = normalizeTime(existing.completed_at) ?? "";
    if (nextTime > currentTime) latestByUser.set(row.user_id, row);
  }

  let lastSubmittedAt: string | null = null;
  for (const row of latestByUser.values()) {
    const time = normalizeTime(row.completed_at);
    if (time !== null && (lastSubmittedAt === null || time > lastSubmittedAt)) {
      lastSubmittedAt = time;
    }
  }

  const counts = definitions.map((dimension) => ({
    ...dimension,
    low: 0,
    medium: 0,
    high: 0,
  }));

  // 没有可用的维度定义时，所有行都无法归档；按 invalid 计，避免「有已测人数却 0 脏数据」掩盖配置错误
  if (definitions.length === 0) {
    return { dimensions: counts, invalidCount: latestByUser.size, lastSubmittedAt };
  }

  let invalidCount = 0;
  for (const row of latestByUser.values()) {
    const entries = readScoreEntries(row.scores_json);
    if (entries === null) {
      invalidCount += 1;
      continue;
    }

    // 先整行校验再落计数：任一维度缺失/标准分非法都整行判脏，避免分布只加了一部分
    const bands: ScoreBand[] = [];
    let valid = true;
    for (const definition of definitions) {
      const entry = entries.get(definition.key);
      if (!entry) {
        valid = false;
        break;
      }
      const standard = entry.standard;
      if (typeof standard !== "number" || !Number.isFinite(standard)) {
        valid = false;
        break;
      }
      bands.push(readBand(entry.band) ?? bandOf(standard));
    }
    if (!valid) {
      invalidCount += 1;
      continue;
    }

    bands.forEach((band, index) => {
      counts[index][band] += 1;
    });
  }

  return { dimensions: counts, invalidCount, lastSubmittedAt };
}
