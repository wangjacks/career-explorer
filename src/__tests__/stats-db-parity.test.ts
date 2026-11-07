import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildCompletionStatsSql } from "../lib/completion-query";

/**
 * CI 没有 MySQL 实例，无法跑双适配器行为对照（实机复核并入 #204）。
 * 这里锁住两适配器必须同构的部分：按 classes.id 分组、共享映射入口、名册按 class_id，
 * 以及禁止再用班名 COALESCE 当分组键。
 */
const ADAPTERS = ["src/lib/db-sqlite.ts", "src/lib/db-mysql.ts"];

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
}

/** 按花括号配平取出某个方法的源码，避免断言越界读到相邻方法 */
function methodBody(text: string, name: string): string {
  const start = text.indexOf(name);
  expect(start, `${name} 未出现在源码里`).toBeGreaterThanOrEqual(0);
  const open = text.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === "{") depth += 1;
    if (text[i] === "}") {
      depth -= 1;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return text.slice(start);
}

describe("SQLite / MySQL 分班统计同构（#260）", () => {
  it.each(ADAPTERS)("%s 不再用班名 COALESCE 充当分组键", (path) => {
    const text = source(path);
    expect(text).not.toContain("COALESCE(c.name, '未分班')");
    expect(text).not.toContain("COALESCE(c.name, \"未分班\")");
  });

  it.each(ADAPTERS)("%s 趋势与对比都按 c.id 分组", (path) => {
    const text = source(path);
    expect(text).toContain("GROUP BY d, c.id, c.name");
    expect(text).toContain("GROUP BY c.id, c.name");
    expect(text).toContain("c.id AS class_id");
  });

  it.each(ADAPTERS)("%s 统一走共享映射，不在适配器内各自换算", (path) => {
    const text = source(path);
    expect(text).toContain("fillClassTrend(");
    expect(text).toContain("mapCompareRows(");
  });

  it.each(ADAPTERS)("%s 名册按 classId 取数，未分班走 c.id IS NULL", (path) => {
    const text = source(path);
    expect(text).toContain("getClassRoster(classId: number | null)");
    expect(text).toContain("AND c.id IS NULL");
    expect(text).toContain("AND c.id = ?");
  });

  it.each(ADAPTERS)("%s 完成矩阵共用 completion-query 的 SQL 与行映射", (path) => {
    const text = source(path);
    expect(text).toContain("buildCompletionStatsSql(");
    expect(text).toContain("mapCompletionStatsRows(");
  });

  it("完成矩阵 SQL 由共享构造器生成，两适配器同构", () => {
    const { sql, params } = buildCompletionStatsSql([5, 9], [7]);
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("GROUP BY u.class_id, c.name");
    expect(sql).toContain("GROUP BY r.assessment_id, u.class_id");
    expect(params).toEqual([7, 5, 9, 7]);
  });

  it.each(ADAPTERS)("%s 人格分布查询只取三列且过滤口径一致（#312）", (path) => {
    const text = source(path);
    for (const fragment of [
      "getDimensionalResultScores(",
      "SELECT r.user_id AS user_id, r.scores_json AS scores_json, r.completed_at AS completed_at",
      "r.assessment_id = ?",
      "r.status = 'completed'",
      "r.is_current = 1",
      "u.role = 'student'",
      "ORDER BY r.user_id",
    ]) {
      expect(text).toContain(fragment);
    }
    // 逐人快照不搬运作答内容 / 身份字段
    expect(text).not.toContain("r.answers_json AS answers_json");
  });

  /**
   * #352 评审 #4：组长写入的存在性判据两库都必须用 SELECT。
   * 实测（本机 MySQL 8.0.46）mysql2 默认带 CLIENT_FOUND_ROWS，同值 UPDATE 的 affectedRows 仍为 1，
   * 所以旧写法在默认配置下不会 500；但那条标志只是驱动默认值，判据不该依赖它——
   * 一旦有人传 `flags: "-FOUND_ROWS"`，同值写入返回 0 就会误报「该组不存在」。
   */
  it.each(ADAPTERS)("%s 组长更新用 SELECT 判存在，不拿受影响行数当存在性", (path) => {
    // 只比代码体，注释里允许解释两种口径的差异
    const code = methodBody(source(path), "updateClassGroupLeader(")
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .replace(/\/\/.*$/gm, "");
    expect(code).toContain("SELECT 1 AS one FROM class_groups WHERE class_id = ? AND group_no = ? LIMIT 1");
    expect(code).toContain('throw new Error("该组不存在")');
    expect(code).not.toContain("affectedRows");
    expect(code).not.toContain(".changes");
  });
});
