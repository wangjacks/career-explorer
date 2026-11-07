/**
 * `assessment_results.items_json` 抽题快照的解析与序列化（#282 建立、#285 拆成独立叶子模块）。
 *
 * 全项目只有这一处解析 / 序列化：路由、抽题器、只读统计脚本都从这里取，避免「报告里一种解析、
 * 路由里另一种解析」。本文件**不 import 任何模块**，因此 `scripts/assessment-item-stats.mjs`
 * 可以直接用 Node 的 TS 类型剥离加载它（Node ESM 不支持无扩展名的相对导入）。
 */

/** `assessment_results.items_json` 的快照形态：`indexes` 按呈现顺序 */
export interface ItemsSnapshot {
  v: 1;
  pool: string;
  indexes: number[];
}

/**
 * 解析抽题快照（全项目唯一的 `items_json` 解析点，调用方不要自己再 JSON.parse）。
 * 容忍空值、空数组与脏 JSON：解析失败或索引为空一律返回 null——**旧数据读作「全库即本轮」**，
 * 由调用方（`planAttempt`）走「已答 ∪ 确定性补抽」的兼容路径。
 */
export function parseItemsSnapshot(raw: string | null | undefined): ItemsSnapshot | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as { v?: unknown; pool?: unknown; indexes?: unknown };
  if (candidate.v !== 1 || typeof candidate.pool !== "string" || !candidate.pool) return null;
  if (!Array.isArray(candidate.indexes)) return null;
  const seen = new Set<number>();
  const indexes = candidate.indexes.filter(
    (index): index is number => {
      // 只认正整数题号，且**同卷去重**：脏快照里的重复题号会让计分引擎判定「题目序号重复」而抛错
      if (typeof index !== "number" || !Number.isInteger(index) || index < 1) return false;
      if (seen.has(index)) return false;
      seen.add(index);
      return true;
    }
  );
  if (indexes.length === 0) return null;
  return { v: 1, pool: candidate.pool, indexes };
}

/** 序列化抽题快照（写草稿与完成记录用；全项目唯一的写点，与 `parseItemsSnapshot` 成对） */
export function buildItemsSnapshot(indexes: readonly number[], poolFingerprint: string): string {
  return JSON.stringify({ v: 1, pool: poolFingerprint, indexes: [...indexes] } satisfies ItemsSnapshot);
}
