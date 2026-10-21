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
 * #313：`class-roster` 新增的按 id 路径必须与既有按班名路径**同口径**，
 * 而且班级改名后仍然指向同一个班——按班名匹配在改名瞬间会命中不到（这正是加 `classId` 的理由）。
 */
describe("班级名册按 id（#313，真实 SQLite）", () => {
  it("classId 与班名两条路径数据一致；改名后 classId 仍正确，按旧名不再命中", () => {
    const dbPath = makeTmpDb();
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const classA = adapter.insertClass("2025级1班", "INV-A-001");
    adapter.insertClass("2025级2班", "INV-B-002");
    const insert = (user_code: string, name: string, class_id: number | null) =>
      adapter.insertUser({ user_code, name, role: "student", class_id });

    insert("202505050102", "乙", classA);
    insert("202505050101", "甲", classA);
    // 未分班学生不属于任何班级名册
    insert("202505050301", "己", null);

    const byName = adapter.getClassRoster("2025级1班");
    const byId = adapter.getClassRosterById(classA);
    expect(byId).toEqual(byName);
    expect(byId.map((row) => row.user_code)).toEqual(["202505050101", "202505050102"]);

    adapter.updateClass(classA, { name: "2025级1班（新）" });
    expect(adapter.getClassRoster("2025级1班")).toEqual([]);
    expect(adapter.getClassRosterById(classA)).toEqual(byId);
    expect(adapter.getClassRoster("2025级1班（新）")).toEqual(byId);

    expect(adapter.getClassById(classA)?.name).toBe("2025级1班（新）");
    expect(adapter.getClassById(9999)).toBeUndefined();

    adapter.close();
    cleanup(dbPath);
  });
});
