import { describe, it, expect, afterEach } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import { SqliteAdapter } from "../lib/db-sqlite";
import type { BackupData } from "../lib/db";

const tmpDirs: string[] = [];
/** 每个测试用独立目录；班级序号保证同一库内学号不重复 */
let classSeq = 0;

function makeDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-group-test-"));
  tmpDirs.push(dir);
  return dir;
}

function makeAdapter(): SqliteAdapter {
  const adapter = new SqliteAdapter(path.join(makeDir(), "test.db"));
  adapter.init();
  return adapter;
}

afterEach(() => {
  classSeq = 0;
  while (tmpDirs.length) {
    const dir = tmpDirs.pop() as string;
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // Windows 上 sqlite 文件句柄偶发未释放；清理失败不影响断言结果
    }
  }
});

/** 建一个班 + n 个学生；学号为 12 位（4 位年份 + 2 位班序 + 6 位序号），保证库内唯一 */
function seedClass(adapter: SqliteAdapter, name: string, studentCount: number) {
  classSeq += 1;
  const seq = classSeq;
  const classId = adapter.insertClass(name, `CODE${seq}`) as number;
  const ids: number[] = [];
  const codes: string[] = [];
  for (let i = 1; i <= studentCount; i++) {
    const code = `2026${String(seq).padStart(2, "0")}${String(i).padStart(6, "0")}`;
    codes.push(code);
    ids.push(adapter.insertUser({ user_code: code, role: "student", name: `学生${i}`, class_id: classId }));
  }
  return { classId, ids, codes };
}

/** 组一个「单批次」入参，减少用例里的样板 */
function batchInput(
  classId: number,
  entries: { userId: number; userCode: string; name: string }[][],
  cohesion = 0.3
) {
  return {
    classId,
    strategy: "idf-cosine",
    featureSources: JSON.stringify([{ key: "tags", kind: "set", weight: 1 }]),
    groupSize: 5,
    studentCount: entries.flat().length,
    taggedCount: 0,
    metrics: JSON.stringify({ overall: 0.42 }),
    actorId: 7,
    actorName: "测试教师",
    actorRole: "teacher",
    groups: entries.map((members, i) => ({ groupNo: i + 1, cohesion, members })),
  };
}

describe("分组五表与适配器方法（#101）", () => {
  it("五张表都已建立", () => {
    const dbPath = path.join(makeDir(), "test.db");
    const adapter = new SqliteAdapter(dbPath);
    adapter.init();

    const db = new Database(dbPath, { readonly: true });
    const names = (db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all() as {
      name: string;
    }[]).map((r) => r.name);
    db.close();
    adapter.close();

    for (const t of [
      "class_groups",
      "class_group_members",
      "group_batches",
      "group_batch_groups",
      "group_batch_members",
    ]) {
      expect(names).toContain(t);
    }
  });

  it("replaceClassGrouping 是整体覆盖：旧组与旧成员不残留，且允许空组", () => {
    const adapter = makeAdapter();
    const { classId, ids } = seedClass(adapter, "A", 5);

    adapter.replaceClassGrouping(classId, [
      { group_no: 1, user_ids: [ids[0], ids[1]] },
      { group_no: 2, user_ids: [ids[2]] },
    ]);
    expect(adapter.getClassGroups(classId).map((g) => g.group_no)).toEqual([1, 2]);
    expect(adapter.getClassGroupMembers(classId).length).toBe(3);

    // 覆盖为「一个空组 + 一个新组」：旧成员行必须消失
    adapter.replaceClassGrouping(classId, [
      { group_no: 1, user_ids: [] },
      { group_no: 2, user_ids: [ids[3], ids[4]] },
    ]);
    expect(adapter.getClassGroups(classId).map((g) => g.group_no)).toEqual([1, 2]);
    const members = adapter.getClassGroupMembers(classId);
    expect(members.length).toBe(2);
    expect(new Set(members.map((m) => m.user_id))).toEqual(new Set([ids[3], ids[4]]));
    adapter.close();
  });

  it("replaceClassGrouping 清空：传空数组后该班没有任何组", () => {
    const adapter = makeAdapter();
    const { classId, ids } = seedClass(adapter, "A", 3);
    adapter.replaceClassGrouping(classId, [{ group_no: 1, user_ids: ids }]);
    adapter.replaceClassGrouping(classId, []);
    expect(adapter.getClassGroups(classId).length).toBe(0);
    expect(adapter.getClassGroupMembers(classId).length).toBe(0);
    adapter.close();
  });

  it("同一学生不能同时属于两个组（UNIQUE(user_id) 拦住）", () => {
    const adapter = makeAdapter();
    const { classId, ids } = seedClass(adapter, "A", 3);
    expect(() =>
      adapter.replaceClassGrouping(classId, [
        { group_no: 1, user_ids: [ids[0]] },
        { group_no: 2, user_ids: [ids[0]] },
      ])
    ).toThrow();
    adapter.close();
  });

  it("同一班内组号唯一（UNIQUE(class_id, group_no) 拦住）", () => {
    const adapter = makeAdapter();
    const { classId } = seedClass(adapter, "A", 3);
    adapter.insertGroupEntry(classId, 1);
    expect(() => adapter.insertGroupEntry(classId, 1)).toThrow();
    adapter.close();
  });

  it("移动成员：换组是改归属，不新增行；目标组不存在则报错", () => {
    const adapter = makeAdapter();
    const { classId, ids } = seedClass(adapter, "A", 4);
    adapter.replaceClassGrouping(classId, [
      { group_no: 1, user_ids: [ids[0], ids[1]] },
      { group_no: 2, user_ids: [ids[2]] },
    ]);

    adapter.moveGroupMember(classId, ids[0], 2);
    const members = adapter.getClassGroupMembers(classId);
    expect(members.length).toBe(3);
    const g2 = adapter.getClassGroups(classId).find((g) => g.group_no === 2) as { id: number };
    expect((members.find((m) => m.user_id === ids[0]) as { group_id: number }).group_id).toBe(g2.id);

    expect(() => adapter.moveGroupMember(classId, ids[0], 99)).toThrow("目标组不存在");
    adapter.close();
  });

  it("未入组的学生可直接移入某个组（转班后重排的场景）", () => {
    const adapter = makeAdapter();
    const { classId, ids } = seedClass(adapter, "A", 3);
    adapter.replaceClassGrouping(classId, [{ group_no: 1, user_ids: [ids[0]] }]);
    adapter.moveGroupMember(classId, ids[1], 1); // ids[1] 从未入组
    expect(new Set(adapter.getClassGroupMembers(classId).map((m) => m.user_id))).toEqual(
      new Set([ids[0], ids[1]])
    );
    adapter.close();
  });

  it("insertGroupBatch 追加历史批次（头 + 组 + 成员），可读回明细与快照", () => {
    const adapter = makeAdapter();
    const { classId, ids, codes } = seedClass(adapter, "A", 3);
    const batchId = adapter.insertGroupBatch(
      batchInput(classId, [
        [
          { userId: ids[0], userCode: codes[0], name: "学生1" },
          { userId: ids[1], userCode: codes[1], name: "学生2" },
        ],
        [{ userId: ids[2], userCode: codes[2], name: "学生3" }],
      ])
    );

    const batches = adapter.getGroupBatches(classId);
    expect(batches.length).toBe(1);
    expect(batches[0].id).toBe(batchId);
    expect(batches[0].created_by_name).toBe("测试教师");
    expect(JSON.parse(String(batches[0].feature_sources))[0].key).toBe("tags");

    const detail = adapter.getGroupBatchDetail(batchId);
    expect(detail.batch?.id).toBe(batchId);
    expect(detail.groups.map((g) => g.group_no)).toEqual([1, 2]);
    expect(detail.groups.find((g) => g.group_no === 1)?.cohesion).toBe(0.3);
    expect(detail.members.length).toBe(3);
    expect(detail.members.map((m) => m.name)).toContain("学生1");
    adapter.close();
  });

  it("同批次内一个学生只能出现一次（UNIQUE(batch_id, user_id) 拦住）", () => {
    const adapter = makeAdapter();
    const { classId, ids, codes } = seedClass(adapter, "A", 2);
    expect(() =>
      adapter.insertGroupBatch(
        batchInput(classId, [
          [{ userId: ids[0], userCode: codes[0], name: "甲" }],
          [{ userId: ids[0], userCode: codes[0], name: "甲" }],
        ])
      )
    ).toThrow();
    adapter.close();
  });

  it("历史批次可多份累加（新→旧返回）", () => {
    const adapter = makeAdapter();
    const { classId, ids, codes } = seedClass(adapter, "A", 2);
    const members = [
      { userId: ids[0], userCode: codes[0], name: "甲" },
      { userId: ids[1], userCode: codes[1], name: "乙" },
    ];
    const first = adapter.insertGroupBatch(batchInput(classId, [members], 0.1));
    const second = adapter.insertGroupBatch(batchInput(classId, [members], 0.9));
    expect(adapter.getGroupBatches(classId).map((b) => b.id)).toEqual([second, first]);
    adapter.close();
  });

  it("getStudentGroupRef 返回本人所在组；未分组返回 undefined", () => {
    const adapter = makeAdapter();
    const { classId, ids } = seedClass(adapter, "A", 3);
    expect(adapter.getStudentGroupRef(ids[0])).toBeUndefined();
    adapter.replaceClassGrouping(classId, [
      { group_no: 1, user_ids: [ids[0], ids[1]] },
      { group_no: 2, user_ids: [ids[2]] },
    ]);
    expect(adapter.getStudentGroupRef(ids[0])).toEqual({ class_id: classId, group_no: 1 });
    expect(adapter.getStudentGroupRef(ids[2])).toEqual({ class_id: classId, group_no: 2 });
    adapter.close();
  });

  it("areStudentsInSameCurrentGroup：同组为真，跨组/跨班/未分组为假", () => {
    const adapter = makeAdapter();
    const a = seedClass(adapter, "A", 3);
    const b = seedClass(adapter, "B", 2);
    adapter.replaceClassGrouping(a.classId, [
      { group_no: 1, user_ids: [a.ids[0], a.ids[1]] },
      { group_no: 2, user_ids: [a.ids[2]] },
    ]);
    // B 班也用组号 1：跨班比较只能按 group_id 判定，按组号会误放行
    adapter.replaceClassGrouping(b.classId, [{ group_no: 1, user_ids: [b.ids[0], b.ids[1]] }]);

    expect(adapter.areStudentsInSameCurrentGroup(a.ids[0], a.ids[1])).toBe(true);
    expect(adapter.areStudentsInSameCurrentGroup(a.ids[1], a.ids[0])).toBe(true);
    expect(adapter.areStudentsInSameCurrentGroup(a.ids[0], a.ids[2])).toBe(false);
    expect(adapter.areStudentsInSameCurrentGroup(a.ids[0], b.ids[0])).toBe(false);
    expect(adapter.areStudentsInSameCurrentGroup(a.ids[0], 999)).toBe(false);
    adapter.close();
  });

  it("删学生：清掉当前成员行，但历史批次保留快照", () => {
    const adapter = makeAdapter();
    const { classId, ids, codes } = seedClass(adapter, "A", 2);
    adapter.replaceClassGrouping(classId, [{ group_no: 1, user_ids: ids }]);
    adapter.insertGroupBatch(
      batchInput(classId, [
        [
          { userId: ids[0], userCode: codes[0], name: "学生1" },
          { userId: ids[1], userCode: codes[1], name: "学生2" },
        ],
      ])
    );

    expect(adapter.deleteStudents([codes[0]])).toBe(1);
    expect(adapter.getClassGroupMembers(classId).length).toBe(1);
    const detail = adapter.getGroupBatchDetail(adapter.getGroupBatches(classId)[0].id);
    expect(detail.members.length).toBe(2); // 历史快照仍在
    adapter.close();
  });

  it("转班：摘掉旧班归属，且不会撞 UNIQUE(user_id)", () => {
    const adapter = makeAdapter();
    const a = seedClass(adapter, "A", 2);
    const b = seedClass(adapter, "B", 2);
    adapter.replaceClassGrouping(a.classId, [{ group_no: 1, user_ids: a.ids }]);
    adapter.replaceClassGrouping(b.classId, [{ group_no: 1, user_ids: b.ids }]);

    adapter.updateUser(a.ids[0], { class_id: b.classId });
    expect(adapter.getClassGroupMembers(a.classId).map((m) => m.user_id)).toEqual([a.ids[1]]);

    // 转入后能被排进 B 班的分组（不撞唯一约束）
    expect(() => adapter.moveGroupMember(b.classId, a.ids[0], 1)).not.toThrow();
    expect(adapter.getStudentGroupRef(a.ids[0])).toEqual({ class_id: b.classId, group_no: 1 });
    adapter.close();
  });

  it("删班级：该班的当前分组与历史批次一并清理，其他班不受影响", () => {
    const adapter = makeAdapter();
    const a = seedClass(adapter, "A", 2);
    const b = seedClass(adapter, "B", 2);
    for (const c of [a, b]) {
      adapter.replaceClassGrouping(c.classId, [{ group_no: 1, user_ids: c.ids }]);
      adapter.insertGroupBatch(
        batchInput(
          c.classId,
          [
            c.ids.map((id, i) => ({ userId: id, userCode: c.codes[i], name: `n${i}` })),
          ]
        )
      );
    }

    adapter.deleteClass(a.classId);
    expect(adapter.getClassGroups(a.classId).length).toBe(0);
    expect(adapter.getGroupBatches(a.classId).length).toBe(0);
    expect(adapter.getClassGroups(b.classId).length).toBe(1);
    expect(adapter.getGroupBatches(b.classId).length).toBe(1);
    expect(
      adapter.getGroupBatchDetail(adapter.getGroupBatches(b.classId)[0].id).members.length
    ).toBe(2);
    adapter.close();
  });

  it("备份含分组五表；恢复后回填；旧备份（无这些字段）恢复后为未分组", () => {
    const adapter = makeAdapter();
    const { classId, ids, codes } = seedClass(adapter, "A", 2);
    adapter.replaceClassGrouping(classId, [{ group_no: 1, user_ids: ids }]);
    adapter.insertGroupBatch(
      batchInput(classId, [
        [
          { userId: ids[0], userCode: codes[0], name: "甲" },
          { userId: ids[1], userCode: codes[1], name: "乙" },
        ],
      ])
    );

    const dump = adapter.backup();
    expect(dump.version).toBe(5);
    expect(dump.class_groups?.length).toBe(1);
    expect(dump.class_group_members?.length).toBe(2);
    expect(dump.group_batches?.length).toBe(1);
    expect(dump.group_batch_groups?.length).toBe(1);
    expect(dump.group_batch_members?.length).toBe(2);

    adapter.restore(dump);
    expect(adapter.getClassGroups(classId).length).toBe(1);
    expect(adapter.getClassGroupMembers(classId).length).toBe(2);
    expect(adapter.getGroupBatchDetail(adapter.getGroupBatches(classId)[0].id).groups[0].cohesion).toBe(0.3);

    // 旧备份没有分组字段：users / classes 是整表替换的，留着旧分组行就是留下指向已不存在学生的归属
    const legacy = { ...dump } as BackupData;
    delete legacy.class_groups;
    delete legacy.class_group_members;
    delete legacy.group_batches;
    delete legacy.group_batch_groups;
    delete legacy.group_batch_members;
    adapter.restore(legacy);
    expect(adapter.getClassGroups(classId)).toEqual([]);
    expect(adapter.getClassGroupMembers(classId)).toEqual([]);
    expect(adapter.getGroupBatches(classId)).toEqual([]);
    adapter.close();
  });

  it("旧备份的名单已变化：恢复后不会残留幽灵成员行", () => {
    const adapter = makeAdapter();
    const { classId, ids } = seedClass(adapter, "A", 3);
    adapter.replaceClassGrouping(classId, [{ group_no: 1, user_ids: ids }]);
    const dump = adapter.backup();
    // 模拟「这份备份之后名单里少了一个人」的旧档：缺分组字段 + users 已不含丙
    const legacy = {
      ...dump,
      users: dump.users.filter((u) => u.id !== ids[2]),
    } as BackupData;
    delete legacy.class_groups;
    delete legacy.class_group_members;
    delete legacy.group_batches;
    delete legacy.group_batch_groups;
    delete legacy.group_batch_members;

    adapter.restore(legacy);
    const members = adapter.getClassGroupMembers(classId);
    expect(members).toEqual([]);
    // 关键：不会有成员行的 user_id 落在恢复后的名单之外
    const alive = new Set(legacy.users.map((u) => u.id));
    expect(members.filter((m) => !alive.has(m.user_id))).toEqual([]);
    adapter.close();
  });

  it("迁移幂等：重复 init 不报错且数据不丢", () => {
    const adapter = makeAdapter();
    const { classId, ids } = seedClass(adapter, "A", 2);
    adapter.replaceClassGrouping(classId, [{ group_no: 1, user_ids: ids }]);
    adapter.init();
    adapter.init();
    expect(adapter.getClassGroups(classId).length).toBe(1);
    expect(adapter.getClassGroupMembers(classId).length).toBe(2);
    adapter.close();
  });
});
