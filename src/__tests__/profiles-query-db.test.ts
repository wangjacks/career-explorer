import { describe, it, expect } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { SqliteAdapter } from "../lib/db-sqlite";
import { IPIP_NEO_FFI_CODE, RIASEC_CODE } from "../lib/assessment-data";

/**
 * 数据列表的**服务端**筛选 / 排序 / 分页（#295）。
 *
 * 这是本 Issue 的核心验收：数据超过一页时，按兴趣测评字母（含「未测」）、搜索、标签筛选都必须
 * 返回**跨页的全部命中行**，而不是只过滤当前页 20 行。SQL 由两适配器共用
 * `buildSubmittedProfilesSql` 生成，这里跑真实 SQLite 用例；MySQL 侧同构。
 */

function makeTmpDb(): string {
  const dir = mkdtempSync(path.join(tmpdir(), "career-profiles-query-"));
  return path.join(dir, "test.db");
}

function cleanup(dbPath: string) {
  rmSync(path.dirname(dbPath), { recursive: true, force: true });
}

interface Seeded {
  dbPath: string;
  adapter: SqliteAdapter;
  assessmentId: number;
  ipipAssessmentId: number;
  /** 学号 → 用户 id */
  ids: Map<string, number>;
}

/** IPIP 大五维度顺序（N,E,O,A,C）的得分快照：`[key, standard]` 简写 */
function ipipScores(entries: [string, number][]) {
  return JSON.stringify(entries.map(([key, standard]) => ({ key, standard })));
}

/**
 * 场景（共 25 名已提交学生，默认每页 20 条 → 第二页 5 人，跨页 bug 必现）：
 * - 25 号学生（提交时间最早，落在第 2 页）三字码 `IAR`；
 * - 24 号学生三字码 `SIA`（用来验证 I / A 也能命中非首字母）；
 * - 23 号学生未测；22 号学生只有草稿（也算未测）；21 号学生旧版本被替换（只认当前版本）；
 * - 标签：1–3 号有 ["运动","游戏"]，4–6 号有 ["阅读"]，其余无标签。
 *
 * #330 追加的人格结果（IPIP，dimensional，无三字码）：25 号 C 偏低、24 号 C 偏高、
 * 1 号快照顺序与 dimensions_json 不一致（用来验证「同时校验 key」不会误筛）、2 号只有草稿。
 */
function seed(): Seeded {
  const dbPath = makeTmpDb();
  const adapter = new SqliteAdapter(dbPath);
  adapter.init();
  const classId = adapter.insertClass("2025级1班", "INV-295-001");
  const assessmentId = adapter.getAssessmentByCode(RIASEC_CODE)!.id;
  const ipipAssessmentId = adapter.getAssessmentByCode(IPIP_NEO_FFI_CODE)!.id;

  const ids = new Map<string, number>();
  const submittedAt = new Map<string, string>();
  for (let i = 1; i <= 25; i += 1) {
    const userCode = `20250505${String(1000 + i).padStart(4, "0")}`;
    const userId = adapter.insertUser({
      user_code: userCode,
      role: "student",
      name: `学生${String(i).padStart(2, "0")}`,
      class_id: classId,
    });
    ids.set(userCode, userId);
    const tags =
      i <= 3 ? JSON.stringify(["运动", "游戏"]) : i <= 6 ? JSON.stringify(["阅读"]) : JSON.stringify([]);
    adapter.upsertSubmission(userCode, tags, "", "", null, 1);
    // 25 号最早提交（第 2 页），1 号最晚提交（第 1 页）；直接改时间，保证排序确定
    submittedAt.set(userCode, `2026-10-${String(1 + (25 - i)).padStart(2, "0")} 10:00:00`);
  }
  const raw = new Database(dbPath);
  const update = raw.prepare("UPDATE users SET submitted_at = ? WHERE user_code = ?");
  for (const [userCode, time] of submittedAt) update.run(time, userCode);

  const complete = (userCode: string, typeCode: string | null) =>
    adapter.completeAssessmentResult({
      userId: ids.get(userCode)!,
      assessmentId,
      answersJson: "{}",
      // `"[]"` = 整库即轮的旧口径（与 #282 之后 dev 上其余 DB 用例一致）：
      // 这里只关心兴趣测评筛选能否跨页命中，不需要真造一份抽题快照
      itemsJson: "[]",
      scoresJson: null,
      typeCode,
    });
  // 25 号 = IAR（第 2 页）
  complete("202505051025", "IAR");
  // 24 号 = SIA（第 2 页；I / A 位于非首位）
  complete("202505051024", "SIA");
  // 23 号未测（没有任何结果）
  // 22 号只有草稿
  adapter.upsertAssessmentDraft(ids.get("202505051022")!, assessmentId, JSON.stringify({ 1: 4 }), "[]");
  // 21 号：先完成 RIA 再完成 ECS，旧版本 is_current=0，只应算 ECS
  complete("202505051021", "RIA");
  complete("202505051021", "ECS");
  // 20 号：三字码非法（null）→ 按「未测」处理
  complete("202505051020", null);

  const completeIpip = (userCode: string, scoresJson: string) =>
    adapter.completeAssessmentResult({
      userId: ids.get(userCode)!,
      assessmentId: ipipAssessmentId,
      answersJson: "{}",
      itemsJson: "[]",
      scoresJson,
      typeCode: null,
    });
  // 24 号：尽责性偏高（C=80，第 5 维，index 4）
  completeIpip("202505051024", ipipScores([["N", 20], ["E", 40], ["O", 55], ["A", 60], ["C", 80]]));
  // 25 号：尽责性偏低（C=30）
  completeIpip("202505051025", ipipScores([["N", 70], ["E", 45], ["O", 50], ["A", 62], ["C", 30]]));
  // 1 号：快照顺序与 dimensions_json 不一致（C 在 index 0）→ 按 index 4 取到 A，
  // key 校验失败 → 不应被「C 偏高」筛到（旧快照不按位置误判）
  completeIpip("202505051001", ipipScores([["C", 85], ["N", 25], ["E", 35], ["O", 45], ["A", 55]]));
  // 2 号：只有人格草稿
  adapter.upsertAssessmentDraft(ids.get("202505051002")!, ipipAssessmentId, JSON.stringify({ 1: 4 }), "[]");
  raw.close();

  return { dbPath, adapter, assessmentId, ipipAssessmentId, ids };
}

const CODE_25 = "202505051025";
const CODE_24 = "202505051024";
const CODE_23 = "202505051023";
const CODE_22 = "202505051022";
const CODE_21 = "202505051021";
const CODE_20 = "202505051020";
const CODE_19 = "202505051019";
const CODE_18 = "202505051018";

describe("getSubmittedProfiles 服务端筛选（#295）", () => {
  it("不传筛选参数时与改造前一致：提交时间倒序、默认分页、total=全体", () => {
    const { dbPath, adapter } = seed();
    const first = adapter.getSubmittedProfiles(1, 20);
    expect(first.total).toBe(25);
    expect(first.rows).toHaveLength(20);
    expect(first.rows[0].user_code).toBe("202505051001"); // 1 号最近提交
    const second = adapter.getSubmittedProfiles(2, 20);
    expect(second.rows).toHaveLength(5);
    expect(second.rows[0].user_code).toBe("202505051021");
    expect(second.rows[4].user_code).toBe(CODE_25); // 25 号最早提交，落在第 2 页
    adapter.close();
    cleanup(dbPath);
  });

  it("兴趣测评筛选跨页生效：第 2 页的 IAR 学生在第 1 页筛选就能拿到", () => {
    const { dbPath, adapter } = seed();
    const result = adapter.getSubmittedProfiles(1, 20, { lead: "I" });
    expect(result.total).toBe(2);
    expect(result.rows.map((row) => row.user_code)).toEqual([CODE_24, CODE_25]);
    expect(result.rows[1].user_code).toBe(CODE_25); // 默认排序下它在第 2 页，证明不再是「当页过滤」
    adapter.close();
    cleanup(dbPath);
  });

  it("兴趣测评语义 = 三字码任意位置包含：SIA 在 S / I / A 都命中", () => {
    const { dbPath, adapter } = seed();
    expect(adapter.getSubmittedProfiles(1, 20, { lead: "S" }).rows.map((row) => row.user_code)).toEqual([
      CODE_21,
      CODE_24,
    ]);
    expect(adapter.getSubmittedProfiles(1, 20, { lead: "I" }).rows.map((row) => row.user_code)).toEqual([
      CODE_24,
      CODE_25,
    ]);
    expect(adapter.getSubmittedProfiles(1, 20, { lead: "A" }).rows.map((row) => row.user_code)).toEqual([
      CODE_24,
      CODE_25,
    ]);
    adapter.close();
    cleanup(dbPath);
  });

  it("「未测」= 没有当前有效结果：无结果 / 只有草稿 / 三字码非法都算未测；旧版本不算", () => {
    const { dbPath, adapter } = seed();
    const result = adapter.getSubmittedProfiles(1, 25, { lead: "none" });
    const codes = new Set(result.rows.map((row) => row.user_code));
    // 1–19 号没测、20 三字码 null、22 只有草稿、23 没测 → 共 22 人未测
    expect(result.total).toBe(22);
    for (const code of [CODE_20, CODE_22, CODE_23]) expect(codes.has(code)).toBe(true);
    // 21 号的旧版本 RIA 已被当前版本 ECS 取代：算已测（E 型），不在未测里
    expect(codes.has(CODE_21)).toBe(false);
    expect(adapter.getSubmittedProfiles(1, 25, { lead: "E" }).rows.map((row) => row.user_code)).toEqual([CODE_21]);
    adapter.close();
    cleanup(dbPath);
  });

  it("字母筛选只接受合法三字码：非法值只进未测，合法值的前后空白不影响匹配", () => {
    const { dbPath, adapter, assessmentId, ids } = seed();
    const complete = (userCode: string, typeCode: string) =>
      adapter.completeAssessmentResult({
        userId: ids.get(userCode)!,
        assessmentId,
        answersJson: "{}",
        itemsJson: "[]",
        scoresJson: null,
        typeCode,
      });
    complete(CODE_19, "XRA");
    complete(CODE_18, " RIA ");

    for (const lead of ["R", "I", "A", "S", "E", "C"] as const) {
      const codes = adapter.getSubmittedProfiles(1, 25, { lead }).rows.map((row) => row.user_code);
      expect(codes).not.toContain(CODE_19);
    }
    expect(adapter.getSubmittedProfiles(1, 25, { lead: "none" }).rows.map((row) => row.user_code)).toContain(
      CODE_19
    );

    for (const lead of ["R", "I", "A"] as const) {
      const codes = adapter.getSubmittedProfiles(1, 25, { lead }).rows.map((row) => row.user_code);
      expect(codes).toContain(CODE_18);
    }
    expect(adapter.getSubmittedProfiles(1, 25, { lead: "none" }).rows.map((row) => row.user_code)).not.toContain(
      CODE_18
    );

    adapter.close();
    cleanup(dbPath);
  });

  it("搜索跨页生效：按学号 / 姓名关键字都能命中第 2 页的学生", () => {
    const { dbPath, adapter } = seed();
    expect(adapter.getSubmittedProfiles(1, 20, { q: "1025" }).rows.map((row) => row.user_code)).toEqual([
      CODE_25,
    ]);
    expect(adapter.getSubmittedProfiles(1, 20, { q: "学生25" }).rows.map((row) => row.user_code)).toEqual([
      CODE_25,
    ]);
    // 通配符按字面量处理：`%` 不会变成「匹配所有人」
    expect(adapter.getSubmittedProfiles(1, 20, { q: "%" }).total).toBe(0);
    adapter.close();
    cleanup(dbPath);
  });

  it("标签筛选跨页生效，且多标签为 AND 语义", () => {
    const { dbPath, adapter } = seed();
    const sports = adapter.getSubmittedProfiles(1, 20, { tags: ["运动"] });
    expect(sports.total).toBe(3);
    expect(sports.rows.map((row) => row.user_code).sort()).toEqual([
      "202505051001",
      "202505051002",
      "202505051003",
    ]);
    const both = adapter.getSubmittedProfiles(1, 20, { tags: ["运动", "阅读"] });
    expect(both.total).toBe(0); // 没有学生同时拥有两组标签
    adapter.close();
    cleanup(dbPath);
  });

  it("筛选 + 分页组合：total / 分页边界按过滤后结果算（不是当页行数）", () => {
    const { dbPath, adapter } = seed();
    const leadNone = adapter.getSubmittedProfiles(1, 2, { lead: "none", sortKey: "studentId", sortDir: "asc" });
    expect(leadNone.total).toBe(22);
    expect(leadNone.rows.map((row) => row.user_code)).toEqual(["202505051001", "202505051002"]);
    const page2 = adapter.getSubmittedProfiles(2, 2, { lead: "none", sortKey: "studentId", sortDir: "asc" });
    expect(page2.rows.map((row) => row.user_code)).toEqual(["202505051003", "202505051004"]);
    // 22 人 / 每页 2 → 正好 11 页，最后一页是 1022 / 1023
    const lastPage = adapter.getSubmittedProfiles(11, 2, { lead: "none", sortKey: "studentId", sortDir: "asc" });
    expect(lastPage.rows.map((row) => row.user_code)).toEqual([CODE_22, CODE_23]);
    adapter.close();
    cleanup(dbPath);
  });

  it("排序下推：按学号 / 姓名升序时跨页顺序稳定（同值按学号破平）", () => {
    const { dbPath, adapter } = seed();
    const byCodeAsc = adapter.getSubmittedProfiles(1, 20, { sortKey: "studentId", sortDir: "asc" });
    expect(byCodeAsc.rows[0].user_code).toBe("202505051001");
    expect(byCodeAsc.rows.at(-1)!.user_code).toBe("202505051020");
    const page2 = adapter.getSubmittedProfiles(2, 20, { sortKey: "studentId", sortDir: "asc" });
    expect(page2.rows.map((row) => row.user_code)).toEqual([
      "202505051021",
      "202505051022",
      "202505051023",
      "202505051024",
      "202505051025",
    ]);

    const byNameDesc = adapter.getSubmittedProfiles(1, 3, { sortKey: "studentName", sortDir: "desc" });
    expect(byNameDesc.rows.map((row) => row.name)).toEqual(["学生25", "学生24", "学生23"]);
    adapter.close();
    cleanup(dbPath);
  });

  it("筛选与排序叠加：lead + 标签 + 关键字可同时生效", () => {
    const { dbPath, adapter } = seed();
    const combined = adapter.getSubmittedProfiles(1, 20, {
      lead: "none",
      tags: ["运动"],
      q: "学生",
    });
    // 1–3 号有运动标签且都还没测 → 三个条件同时命中
    expect(combined.total).toBe(3);
    expect(combined.rows.map((row) => row.user_code).sort()).toEqual([
      "202505051001",
      "202505051002",
      "202505051003",
    ]);
    adapter.close();
    cleanup(dbPath);
  });
});

describe("getSubmittedProfiles 双测评筛选（#330）", () => {
  const IPIP_SCALE = IPIP_NEO_FFI_CODE;
  /** my IPIP 维度顺序：N,E,O,A,C → 尽责性 C 是第 5 维（index 4） */
  const C_INDEX = 4;

  it("兴趣多选 = 同时包含：S+A+I 只命中 SIA，不会命中 IAR（缺 S）", () => {
    const { dbPath, adapter } = seed();
    const result = adapter.getSubmittedProfiles(1, 25, { interest: { mode: "letters", keys: ["S", "A", "I"] } });
    expect(result.total).toBe(1);
    expect(result.rows.map((row) => row.user_code)).toEqual([CODE_24]);

    const sa = adapter.getSubmittedProfiles(1, 25, { interest: { mode: "letters", keys: ["S", "A"] } });
    expect(sa.rows.map((row) => row.user_code)).toEqual([CODE_24]);
    adapter.close();
    cleanup(dbPath);
  });

  it("兴趣多选跨页生效：第 2 页的行在第 1 页就能筛到（total 为过滤后命中数）", () => {
    const { dbPath, adapter } = seed();
    const firstPage = adapter.getSubmittedProfiles(1, 20, {
      interest: { mode: "letters", keys: ["A", "I"] },
      sortKey: "studentId",
      sortDir: "asc",
    });
    // 24 号 SIA / 25 号 IAR（都在默认第 2 页）；21 号当前码 ECS 不含 A/I
    expect(firstPage.total).toBe(2);
    expect(firstPage.rows.map((row) => row.user_code)).toEqual([CODE_24, CODE_25]);
    adapter.close();
    cleanup(dbPath);
  });

  it("人格已测 / 未测：只认当前结果（草稿与他人量表结果都不算）", () => {
    const { dbPath, adapter } = seed();
    const assessed = adapter.getSubmittedProfiles(1, 25, {
      personality: { mode: "any" },
      personalitySql: { scaleCode: IPIP_SCALE },
    });
    // 1 / 24 / 25 号有 IPIP 结果；2 号只有草稿，其余没测
    expect(assessed.total).toBe(3);
    expect(new Set(assessed.rows.map((row) => row.user_code))).toEqual(
      new Set(["202505051001", CODE_24, CODE_25])
    );

    const missing = adapter.getSubmittedProfiles(1, 25, {
      personality: { mode: "none" },
      personalitySql: { scaleCode: IPIP_SCALE },
    });
    expect(missing.total).toBe(22);
    expect(missing.rows.map((row) => row.user_code)).not.toContain(CODE_24);
    adapter.close();
    cleanup(dbPath);
  });

  it("人格单维度偏高：按维度下标 + key 双重校验（旧快照顺序不一致不误筛）", () => {
    const { dbPath, adapter } = seed();
    const high = adapter.getSubmittedProfiles(1, 25, {
      personality: { mode: "dimension", key: "C", dir: "high" },
      personalitySql: { scaleCode: IPIP_SCALE, dimensionIndex: C_INDEX },
    });
    // 24 号 C=80 命中；1 号快照顺序不一致（index 4 实际是 A）不应命中
    expect(high.total).toBe(1);
    expect(high.rows.map((row) => row.user_code)).toEqual([CODE_24]);

    const low = adapter.getSubmittedProfiles(1, 25, {
      personality: { mode: "dimension", key: "C", dir: "low" },
      personalitySql: { scaleCode: IPIP_SCALE, dimensionIndex: C_INDEX },
    });
    expect(low.total).toBe(1);
    expect(low.rows.map((row) => row.user_code)).toEqual([CODE_25]);
    adapter.close();
    cleanup(dbPath);
  });

  it("人格维度 + 搜索 / 标签可叠加，筛选与分页组合按过滤后结果算", () => {
    const { dbPath, adapter } = seed();
    const combined = adapter.getSubmittedProfiles(1, 1, {
      personality: { mode: "dimension", key: "C", dir: "high" },
      personalitySql: { scaleCode: IPIP_SCALE, dimensionIndex: C_INDEX },
      q: "学生24",
    });
    expect(combined.total).toBe(1);
    expect(combined.rows.map((row) => row.user_code)).toEqual([CODE_24]);

    // 21 号（档案）与 24 号同班但兴趣不同：兴趣 + 标签组合仍按 AND 叠加
    const interestAndTag = adapter.getSubmittedProfiles(1, 20, {
      interest: { mode: "letters", keys: ["S", "I"] },
      tags: ["阅读"],
    });
    expect(interestAndTag.total).toBe(0); // 24 号没有「阅读」标签
    adapter.close();
    cleanup(dbPath);
  });
});
