import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-class-roster-"));
  return path.join(dir, "test.db");
}

function cleanup(dbPath: string) {
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

/**
 * #313：`class-roster` 新增的按 id 通道必须与既有「班名 → class_id」通道**同口径**，
 * 而且班级改名后仍然指向同一个班——按班名匹配在改名瞬间会命中不到（这正是加 `classId` 的理由）。
 */
describe("班级名册按 id（#313，真实 SQLite）", () => {
  it("按 id 与按班名解析出的 class_id 同口径；改名后 id 通道仍正确、旧名不再命中", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const classA = adapter.insertClass("2025级1班", "INV-A-001");
    adapter.insertClass("2025级2班", "INV-B-002");
    const insert = (user_code: string, name: string, class_id: number | null) =>
      adapter.insertUser({ user_code, name, role: "student", class_id });

    insert("202505050102", "乙", classA);
    insert("202505050101", "甲", classA);
    // 未分班学生走独立通道（classId = null），不属于任何班级名册
    insert("202505050301", "己", null);

    const byId = adapter.getClassRoster(classA);
    expect(byId.map((row) => row.user_code)).toEqual(["202505050101", "202505050102"]);

    // 同名解析路径：班名 → class_id → 名册，与直接按 id 完全一致
    const resolved = adapter.getClassByName("2025级1班");
    expect(resolved?.id).toBe(classA);
    expect(adapter.getClassRoster(resolved!.id)).toEqual(byId);

    // 改名：旧名不再命中，id 通道不受影响
    adapter.updateClass(classA, { name: "2025级1班（新）" });
    expect(adapter.getClassByName("2025级1班")).toBeUndefined();
    expect(adapter.getClassById(classA)?.name).toBe("2025级1班（新）");
    expect(adapter.getClassRoster(classA)).toEqual(byId);

    // 未分班通道只含未分班学生，不把真实班级的学生合并进来
    expect(adapter.getClassRoster(null).map((row) => row.user_code)).toEqual(["202505050301"]);
    expect(adapter.getClassById(9999)).toBeUndefined();

    adapter.close();
    cleanup(dbPath);
  });
});
