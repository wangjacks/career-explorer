import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * CI 没有 MySQL 实例，无法跑双适配器行为对照（实机复核并入 #204）。
 * 这里锁住两适配器必须同构的部分：按 classes.id 分组、共享映射入口、名册按 class_id，
 * 以及禁止再用班名 COALESCE 当分组键。
 */
const ADAPTERS = ["src/lib/db-sqlite.ts", "src/lib/db-mysql.ts"];

function source(path: string): string {
  return readFileSync(join(process.cwd(), path), "utf8");
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
});
