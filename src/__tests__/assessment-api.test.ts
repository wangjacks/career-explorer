import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";

/** 指向临时 SQLite：本文件走**真实数据层 + 真实计分引擎 + 真实抽题**，只把 db-config 里写死的库路径换掉 */
const state = vi.hoisted(() => ({ dbPath: "" }));

vi.mock("@/lib/db-config", () => ({
  getConfig: () => ({
    installed: true,
    type: "sqlite",
    sqlite: { path: state.dbPath },
    mysql: { host: "127.0.0.1", port: 3306, user: "root", password: "", database: "unused" },
  }),
  isInstalled: () => true,
  setConfig: () => {},
}));

import { signToken } from "@/lib/token";
import { closeDb, getAssessmentQuestionsByCode, insertUser, queryAuditLogs } from "@/lib/db";
import {
  ASSESSMENT_ANCHORS,
  IPIP_ASSESSMENT,
  IPIP_DIMENSIONS,
  IPIP_NEO_FFI_CODE,
  IPIP_QUESTIONS,
  RIASEC_ASSESSMENT,
  RIASEC_CODE,
  RIASEC_DIMENSIONS,
  RIASEC_QUESTIONS,
  NEAR_DUPLICATE_GROUPS,
  getAssessmentAnchors,
} from "@/lib/assessment-data";
import { parseItemsSnapshot } from "@/lib/assessment-sampling";
import { GET as startGet } from "@/app/api/shared/assessment/start/route";
import { POST as answerPost } from "@/app/api/shared/assessment/answer/route";
import { POST as submitPost } from "@/app/api/shared/assessment/submit/route";
import { GET as resultsGet } from "@/app/api/shared/assessment/results/route";
import { GET as listGet } from "@/app/api/shared/assessment/list/route";

const BASE = "http://localhost:3000";
/** 题库总量、每次作答题数与每维题数（#281 起 120 题库 / #282 每次 30 题），数字一律取自种子常量 */
const BANK_SIZE = RIASEC_QUESTIONS.length;
const ROUND_SIZE = RIASEC_ASSESSMENT.itemsPerAttempt;
const PER_DIMENSION = ROUND_SIZE / RIASEC_DIMENSIONS.length;
const DIMENSION_KEYS = RIASEC_DIMENSIONS.map((d) => d.key);

/** 题号 → 题库行，用于校验卷子的分层形状（维度、来源） */
const bankByIndex = new Map(RIASEC_QUESTIONS.map((q) => [q.index, q]));
/**
 * #284 回退后每维只剩 10 道官方题：排除上一轮 5 题后，C / E 两维剩余题里仍有近重复组，
 * 第二轮起这两维允许个别重题；其余维度必须完全换新。
 */
const GROUP_CONSTRAINED_DIMENSIONS = new Set(
  NEAR_DUPLICATE_GROUPS.flat().map((index) => bankByIndex.get(index)!.dimension)
);

function getRequest(pathname: string, token?: string): NextRequest {
  const headers: Record<string, string> = {};
  if (token) headers.cookie = `auth_token=${token}`;
  return new NextRequest(new URL(pathname, BASE), { headers });
}

function postRequest(pathname: string, body: unknown, token?: string): NextRequest {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (token) headers.cookie = `auth_token=${token}`;
  return new NextRequest(new URL(pathname, BASE), { method: "POST", headers, body: JSON.stringify(body) });
}

async function startBody(token: string) {
  const res = await startGet(getRequest(`/api/shared/assessment/start?code=${RIASEC_CODE}`, token));
  expect(res.status).toBe(200);
  const body = await res.json();
  /** 本轮题号，按呈现顺序 */
  body.roundIndexes = (body.questions as { index: number }[]).map((q) => q.index);
  return body;
}

/** 按题号清单逐题作答（每题一次 answer 调用，与答题页行为一致） */
async function answerAll(token: string, indexes: readonly number[], value: number) {
  for (const index of indexes) {
    const res = await answerPost(
      postRequest("/api/shared/assessment/answer", { code: RIASEC_CODE, questionIndex: index, value }, token)
    );
    expect(res.status).toBe(200);
  }
}

/** 校验一张卷子的分层形状：每维固定题数、只用已放行来源、近重复组同卷至多一题、不出现 3 连同维 */
function expectPaperShape(indexes: readonly number[]) {
  expect(indexes).toHaveLength(ROUND_SIZE);
  expect(new Set(indexes).size).toBe(ROUND_SIZE);
  expect(indexes.every((index) => bankByIndex.has(index))).toBe(true);

  for (const key of DIMENSION_KEYS) {
    const inDimension = indexes.filter((index) => bankByIndex.get(index)!.dimension === key);
    expect(inDimension, `维度 ${key} 应有 ${PER_DIMENSION} 题`).toHaveLength(PER_DIMENSION);
    // #284 回退：原创题未通过专家评审与试测，整批不进抽题池；每维 5 题全部来自 O*NET 官方题
    expect(
      inDimension.every((index) => bankByIndex.get(index)!.origin !== "cn-original"),
      `维度 ${key} 不应抽到未放行的原创题`
    ).toBe(true);
  }
  for (const group of NEAR_DUPLICATE_GROUPS) {
    expect(indexes.filter((index) => group.includes(index)).length, `近重复组 ${group.join("/")}`).toBeLessThanOrEqual(1);
  }
  let run = 1;
  for (let i = 1; i < indexes.length; i += 1) {
    run = bankByIndex.get(indexes[i])!.dimension === bankByIndex.get(indexes[i - 1])!.dimension ? run + 1 : 1;
    expect(run, `第 ${i + 1} 题起出现同维度连抽`).toBeLessThanOrEqual(2);
  }
}

let tempDir = "";
const users: Record<
  "A" | "B" | "C" | "D",
  { uid: number; token: string; code: string; name: string }
> = {
  A: { uid: 0, token: "", code: "202505050101", name: "张三" },
  B: { uid: 0, token: "", code: "202505050102", name: "李四" },
  C: { uid: 0, token: "", code: "202505050103", name: "王五" },
  D: { uid: 0, token: "", code: "202505050104", name: "赵六" },
};
let teacherToken = "";

/** 学生 A 第一轮（本文件的主线）：题号清单在多个用例间传递 */
let round1: number[] = [];

beforeAll(async () => {
  tempDir = mkdtempSync(path.join(tmpdir(), "career-assessment-api-"));
  state.dbPath = path.join(tempDir, "test.db");

  users.A.uid = await insertUser({ user_code: users.A.code, role: "student", name: users.A.name });
  users.B.uid = await insertUser({ user_code: users.B.code, role: "student", name: users.B.name });
  users.C.uid = await insertUser({ user_code: users.C.code, role: "student", name: users.C.name });
  users.D.uid = await insertUser({ user_code: users.D.code, role: "student", name: users.D.name });
  users.A.token = await signToken({ role: "student", uid: users.A.uid, name: users.A.name });
  users.B.token = await signToken({ role: "student", uid: users.B.uid, name: users.B.name });
  users.C.token = await signToken({ role: "student", uid: users.C.uid, name: users.C.name });
  users.D.token = await signToken({ role: "student", uid: users.D.uid, name: users.D.name });
  teacherToken = await signToken({ role: "teacher", uid: 999, name: "王老师" });
});

afterAll(async () => {
  await closeDb();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("鉴权（#223：路由自鉴权，只认会话本人）", () => {
  const endpoints: { name: string; call: (token?: string) => Promise<Response> }[] = [
    { name: "start", call: (token) => startGet(getRequest(`/api/shared/assessment/start?code=${RIASEC_CODE}`, token)) },
    {
      name: "answer",
      call: (token) => answerPost(postRequest("/api/shared/assessment/answer", { code: RIASEC_CODE, questionIndex: 1, value: 4 }, token)),
    },
    { name: "submit", call: (token) => submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, token)) },
    { name: "results", call: (token) => resultsGet(getRequest(`/api/shared/assessment/results?code=${RIASEC_CODE}`, token)) },
    { name: "list", call: (token) => listGet(getRequest("/api/shared/assessment/list", token)) },
  ];

  it.each(endpoints)("$name：未登录 401、无效 token 401、教师 403", async ({ call }) => {
    expect((await call()).status).toBe(401);
    expect((await call("not-a-token")).status).toBe(401);
    expect((await call(teacherToken)).status).toBe(403);
  });
});

describe("进入答题页：本轮 30 题的卷子（#282）", () => {
  it("下发分层抽出的本轮题目 + 题库口径，不暴露维度，也不写任何库", async () => {
    const body = await startBody(users.A.token);
    round1 = body.roundIndexes;

    expectPaperShape(round1);
    expect(body.questions[0]).toEqual({ index: round1[0], prompt: bankByIndex.get(round1[0])!.prompt });
    expect(body.questions[0]).not.toHaveProperty("dimension");

    expect(body.assessment.questionCount).toBe(ROUND_SIZE);
    expect(body.assessment.poolSize).toBe(BANK_SIZE);
    expect(body.assessment.itemsPerAttempt).toBe(ROUND_SIZE);
    expect(body.assessment.scoringMode).toBe("typological");
    expect(body.assessment.anchors).toEqual(ASSESSMENT_ANCHORS[RIASEC_CODE]);
    expect(body.assessment.anchors).toHaveLength(5);
    expect(body.assessment.dimensions.map((d: { key: string }) => d.key)).toEqual(DIMENSION_KEYS);
    expect(body.assessment.attribution).toContain("O*NET");
    expect(body.assessment.disclaimer).toContain("不作为心理诊断");
    expect(body.draft).toBeNull();
    expect(body.progress).toEqual({ answered: 0, total: ROUND_SIZE, percent: 0 });
    expect(body.resumeIndex).toBe(round1[0]);

    // 只打开页面不建草稿（#223 不变量在抽题后仍成立）
    const raw = new Database(state.dbPath);
    expect((raw.prepare("SELECT COUNT(*) as c FROM assessment_results").get() as { c: number }).c).toBe(0);
    raw.close();
  });

  it("确定性派生：同一轮反复进入得到同一张卷子", async () => {
    const again = await startBody(users.A.token);
    expect(again.roundIndexes).toEqual(round1);
    // 不同学生的卷子各自派生（同 attemptNo 也不同种子），且都是合法的一张卷子
    const bodyB = await startBody(users.B.token);
    expectPaperShape(bodyB.roundIndexes);
    expect(bodyB.progress).toEqual({ answered: 0, total: ROUND_SIZE, percent: 0 });
  });

  it("非法作答一律 400（题号 / 取值 / 题库外题号），未知量表 404", async () => {
    const cases: { body: Record<string, unknown>; status: number }[] = [
      { body: { code: RIASEC_CODE, questionIndex: 0, value: 4 }, status: 400 },
      { body: { code: RIASEC_CODE, questionIndex: 1, value: 6 }, status: 400 },
      { body: { code: RIASEC_CODE, questionIndex: 1, value: "4" }, status: 400 },
      { body: { code: RIASEC_CODE, questionIndex: BANK_SIZE + 1, value: 4 }, status: 400 },
      { body: { code: "unknown", questionIndex: 1, value: 4 }, status: 404 },
    ];
    for (const item of cases) {
      const res = await answerPost(postRequest("/api/shared/assessment/answer", item.body, users.A.token));
      expect(res.status).toBe(item.status);
    }
  });

  it("题号在题库里但不在本轮卷子里 → 400，失败审计不落选项值", async () => {
    const outside = Array.from({ length: BANK_SIZE }, (_, i) => i + 1).find((index) => !round1.includes(index))!;
    const res = await answerPost(
      postRequest("/api/shared/assessment/answer", { code: RIASEC_CODE, questionIndex: outside, value: 5 }, users.A.token)
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain("本轮");

    const audit = await queryAuditLogs({ page: 1, pageSize: 20, action: "assessment:answer" });
    const rejected = audit.rows.find((row) => row.status === "failed" && JSON.parse(row.metadata ?? "{}").reason === "question-not-in-round");
    expect(rejected, "本轮外的作答应有 failed 审计").toBeDefined();
    const metadata = JSON.parse(rejected!.metadata ?? "{}");
    expect(metadata.questionIndex).toBe(outside);
    expect(metadata).not.toHaveProperty("value");
  });
});

describe("草稿续答：快照即本轮口径", () => {
  it("每题作答即落草稿并写抽题快照；重复进入按上次题号续答", async () => {
    const first = await answerPost(
      postRequest("/api/shared/assessment/answer", { code: RIASEC_CODE, questionIndex: round1[0], value: 4 }, users.A.token)
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({
      saved: true,
      progress: { answered: 1, total: ROUND_SIZE },
      nextIndex: round1[1],
    });

    await answerAll(users.A.token, round1.slice(1, 10), 3);

    const resumed = await startBody(users.A.token);
    expect(resumed.roundIndexes).toEqual(round1); // 续答不换题
    expect(resumed.progress).toEqual({ answered: 10, total: ROUND_SIZE, percent: 33 });
    expect(resumed.resumeIndex).toBe(round1[10]);
    expect(resumed.draft.answers[String(round1[0])]).toBe(4);
    expect(resumed.draft.answers[String(round1[9])]).toBe(3);

    // 草稿行带快照：题号即本轮呈现顺序
    const raw = new Database(state.dbPath);
    const draftRow = raw
      .prepare("SELECT items_json FROM assessment_results WHERE user_id = ? AND draft_slot = 1")
      .get(users.A.uid) as { items_json: string };
    raw.close();
    expect(parseItemsSnapshot(draftRow.items_json)!.indexes).toEqual(round1);
  });

  it("草稿进行中反复进入不推进轮次：attemptNo 只由完成记录数派生", async () => {
    const before = await startBody(users.A.token);
    const again = await startBody(users.A.token);
    expect(again.roundIndexes).toEqual(before.roundIndexes);
    expect(again.progress).toEqual(before.progress);

    // 此刻 A 还没有任何完成记录，进行中的 10 次作答都记在第 1 轮
    const audit = await queryAuditLogs({ page: 1, pageSize: 50, action: "assessment:answer" });
    const successRows = audit.rows.filter((row) => row.status === "success");
    expect(successRows.length).toBeGreaterThan(0);
    expect(successRows.every((row) => JSON.parse(row.metadata ?? "{}").attemptNo === 1)).toBe(true);
  });

  it("未答完 → 400 并回带本轮缺失题号，且记失败审计", async () => {
    const res = await submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, users.A.token));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("未作答");
    expect(body.missingIndexes).toEqual(round1.slice(10));

    const failed = await queryAuditLogs({ page: 1, pageSize: 20, action: "assessment:submit" });
    expect(failed.rows.some((row) => row.status === "failed")).toBe(true);
  });
});

describe("提交与结果落库", () => {
  it("本轮 30 题全答后提交：每维 5 题口径与引擎一致（全 4 分 → 六维 75 / RIA）", async () => {
    // 统一覆盖成 4 分：六维并列时按 R,I,A,S,E,C 破平
    await answerAll(users.A.token, round1, 4);
    const res = await submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, users.A.token));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.result.typeCode).toBe("RIA");
    expect(body.result.questionCount).toBe(ROUND_SIZE);
    expect(body.result.poolSize).toBe(BANK_SIZE);
    expect(body.result.attemptNo).toBe(1);
    expect(body.result.scores).toHaveLength(DIMENSION_KEYS.length);
    expect(
      body.result.scores.every(
        (s: { standard: number; questionCount: number }) => s.standard === 75 && s.questionCount === PER_DIMENSION
      )
    ).toBe(true);
    expect(body.result.completedAt).toBeTruthy();
    expect(body.result.disclaimer).toContain("不作为心理诊断");
  });

  it("结果查询：当前结果带当轮题量，历史与进度口径一致，并记读取审计", async () => {
    const res = await resultsGet(getRequest("/api/shared/assessment/results", users.A.token));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.current.typeCode).toBe("RIA");
    expect(body.current.isCurrent).toBe(true);
    expect(body.current.questionCount).toBe(ROUND_SIZE);
    expect(body.current.scores.map((s: { key: string }) => s.key)).toEqual(DIMENSION_KEYS);
    expect(body.history).toHaveLength(1);
    expect(body.history[0].id).toBe(body.current.id);
    expect(body.inProgress).toBeNull(); // 提交后草稿已转成完成记录
    expect(body.assessment.enabled).toBe(true); // #222 测评中心据此给「开始 / 继续作答」入口
    expect(body.assessment.scoringMode).toBe("typological"); // #292 档案页据此分流结果卡
    expect(body.assessment.questionCount).toBe(ROUND_SIZE);
    expect(body.assessment.poolSize).toBe(BANK_SIZE);

    // 启用量表清单只有一个家（#291 的 /list）：结果接口始终只回一套量表，
    // 档案页（#292）先按清单拿 code，再逐套按 ?code= 取结果
    expect(body.assessments).toBeUndefined();

    const audit = await queryAuditLogs({ page: 1, pageSize: 20, action: "assessment:results" });
    expect(audit.total).toBeGreaterThan(0);
    expect(JSON.parse(audit.rows[0].metadata ?? "{}")).toMatchObject({ hasCurrent: true });
  });

  it("作答审计只记进度与本轮口径不记选项（选项是个人数据，不重复落审计表）", async () => {
    const audit = await queryAuditLogs({ page: 1, pageSize: 50, action: "assessment:answer" });
    expect(audit.total).toBeGreaterThan(30);
    for (const row of audit.rows) {
      const metadata = JSON.parse(row.metadata ?? "{}");
      expect(metadata).not.toHaveProperty("value");
    }
    const success = audit.rows.find((row) => row.status === "success")!;
    const metadata = JSON.parse(success.metadata ?? "{}");
    expect(metadata).toHaveProperty("answered");
    expect(metadata).toHaveProperty("total", ROUND_SIZE);
    expect(metadata).toHaveProperty("attemptNo", 1);
    expect(metadata).toHaveProperty("pool");
    expect(audit.rows.every((row) => row.actor_user_code === users.A.code)).toBe(true);
  });
});

describe("重复测评：换一张卷子而不丢历史", () => {
  it("第二轮换卷：除近重复受限的维度外不与第一轮重题，提交后生成新版本且历史题量各自留档", async () => {
    const start2 = await startBody(users.A.token);
    const round2 = start2.roundIndexes;
    expectPaperShape(round2);
    // 可抽的 60 道官方题每维 10 道、每轮 5 道：C / E 两维排除后仍被近重复组挤占，允许个别重题
    const repeated = round2.filter((index: number) => round1.includes(index));
    expect(repeated.every((index: number) => GROUP_CONSTRAINED_DIMENSIONS.has(bankByIndex.get(index)!.dimension))).toBe(
      true
    );
    expect(round2).not.toEqual(round1);
    // 草稿已随提交转成完成记录，新一轮进入时进度归零
    expect(start2.progress).toEqual({ answered: 0, total: ROUND_SIZE, percent: 0 });
    expect(start2.draft).toBeNull();

    // 全部答 2 分：原始分 10 / 量程 5-25 → 标准分 25，六维并列仍按 R,I,A,S,E,C 破平
    await answerAll(users.A.token, round2, 2);
    const res = await submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, users.A.token));
    expect(res.status).toBe(200);
    const submitted = await res.json();
    expect(submitted.result.typeCode).toBe("RIA");
    expect(submitted.result.attemptNo).toBe(2);
    expect(submitted.result.scores.every((s: { standard: number }) => s.standard === 25)).toBe(true);

    const body = await startBody(users.A.token);
    const results = await resultsGet(getRequest(`/api/shared/assessment/results?code=${RIASEC_CODE}`, users.A.token));
    const resultsBody = await results.json();
    expect(resultsBody.history).toHaveLength(2);
    expect(resultsBody.history[0].isCurrent).toBe(true);
    expect(resultsBody.history[0].questionCount).toBe(ROUND_SIZE);
    expect(resultsBody.history[1].isCurrent).toBe(false);
    expect(resultsBody.history[1].scores.every((s: { standard: number }) => s.standard === 75)).toBe(true);
    // 第三轮只保证不与第二轮重复（近重复受限维度除外），可以回到第一轮的题
    expectPaperShape(body.roundIndexes);
    expect(
      body.roundIndexes
        .filter((index: number) => round2.includes(index))
        .every((index: number) => GROUP_CONSTRAINED_DIMENSIONS.has(bankByIndex.get(index)!.dimension))
    ).toBe(true);
    expect(body.roundIndexes).not.toEqual(round2);
  });
});

describe("学生之间互不可见", () => {
  it("B 的草稿与结果不受 A 影响；B 的读取不会带出 A 的数据", async () => {
    const startBodyB = await startBody(users.B.token);
    expect(startBodyB.draft).toBeNull();
    expect(startBodyB.progress).toEqual({ answered: 0, total: ROUND_SIZE, percent: 0 });

    const resultsB = await resultsGet(getRequest(`/api/shared/assessment/results?code=${RIASEC_CODE}`, users.B.token));
    const resultsBody = await resultsB.json();
    expect(resultsBody.current).toBeNull();
    expect(resultsBody.history).toEqual([]);
    expect(resultsBody.inProgress).toBeNull();

    // A 的结果不受影响
    const resultsA = await resultsGet(getRequest(`/api/shared/assessment/results?code=${RIASEC_CODE}`, users.A.token));
    const bodyA = await resultsA.json();
    expect(bodyA.current.typeCode).toBe("RIA");
    expect(bodyA.history).toHaveLength(2);
  });
});

describe("在途草稿兼容（#282：升级前建的整库草稿不作废）", () => {
  it("无快照的在途草稿：本轮 = 已答题 ∪ 补抽到每维题数，补齐后可提交", async () => {
    // 直接造一份「升级前」的草稿：题号 1–12（每维 2 题）、items_json 仍是默认空数组
    const raw = new Database(state.dbPath);
    const now = "2026-10-20 09:00:00";
    const answers = Object.fromEntries(Array.from({ length: 12 }, (_, i) => [i + 1, 3]));
    raw
      .prepare(
        `INSERT INTO assessment_results
           (user_id, assessment_id, status, answers_json, items_json, is_current, draft_slot, started_at, updated_at)
         SELECT ?, id, 'in_progress', ?, '[]', 0, 1, ?, ? FROM assessments WHERE code = ?`
      )
      .run(users.C.uid, JSON.stringify(answers), now, now, RIASEC_CODE);
    raw.close();

    const body = await startBody(users.C.token);
    const round = body.roundIndexes as number[];
    const legacyAnswered = Array.from({ length: 12 }, (_, i) => i + 1);
    // 已答的 12 题全部留在本轮里（一道不作废），补抽把每维凑满 5 题
    expect(round.filter((index: number) => legacyAnswered.includes(index)).sort((a, b) => a - b)).toEqual(
      legacyAnswered
    );
    expect(round).toHaveLength(ROUND_SIZE);
    expectPaperShape(round);
    expect(body.draft.answers["1"]).toBe(3);
    expect(body.progress).toEqual({ answered: 12, total: ROUND_SIZE, percent: 40 });
    // 续答落点 = 本轮呈现顺序里第一道未答的题
    expect(body.resumeIndex).toBe(round.find((index: number) => !legacyAnswered.includes(index)));

    await answerAll(users.C.token, round.filter((index: number) => !legacyAnswered.includes(index)), 5);
    const res = await submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, users.C.token));
    expect(res.status).toBe(200);
    const submitted = await res.json();
    expect(submitted.result.questionCount).toBe(ROUND_SIZE);
    expect(submitted.result.attemptNo).toBe(1);
  });
});

describe("量表停用", () => {
  it("停用后 start / answer / submit 拒绝（403），历史结果仍可读", async () => {
    const raw = new Database(state.dbPath);
    raw.prepare("UPDATE assessments SET enabled = 0 WHERE code = ?").run(RIASEC_CODE);
    raw.close();

    try {
      expect((await startGet(getRequest(`/api/shared/assessment/start?code=${RIASEC_CODE}`, users.A.token))).status).toBe(403);
      const answerRes = await answerPost(
        postRequest("/api/shared/assessment/answer", { code: RIASEC_CODE, questionIndex: round1[0], value: 4 }, users.A.token)
      );
      expect(answerRes.status).toBe(403);
      const submitRes = await submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, users.A.token));
      expect(submitRes.status).toBe(403);

      // 被拒的写同样落审计（#110 口径）：停用后仍在提交，运维侧要能看到
      for (const action of ["assessment:answer", "assessment:submit"]) {
        const audit = await queryAuditLogs({ page: 1, pageSize: 20, action });
        const disabled = audit.rows.filter(
          (row) => row.status === "failed" && JSON.parse(row.metadata ?? "{}").reason === "assessment-disabled"
        );
        expect(disabled.length, `${action} 的停用拒绝应有 failed 审计`).toBeGreaterThan(0);
      }

      // 已有结果不能因为量表下线就读不到；但 #222 测评中心需要知道「已关闭」才能收掉作答入口
      const resultsRes = await resultsGet(getRequest(`/api/shared/assessment/results?code=${RIASEC_CODE}`, users.A.token));
      expect(resultsRes.status).toBe(200);
      const resultsBody = await resultsRes.json();
      expect(resultsBody.current.typeCode).toBe("RIA");
      expect(resultsBody.assessment.enabled).toBe(false);

      // 量表清单只有一个家（#291）：停用后清单不再列这套量表，档案页也就不再渲染它的结果卡
      const listRes = await listGet(getRequest("/api/shared/assessment/list", users.A.token));
      expect(listRes.status).toBe(200);
      const listBody = await listRes.json();
      expect(listBody.assessments.map((entry: { code: string }) => entry.code)).toEqual([IPIP_NEO_FFI_CODE]);
    } finally {
      const restore = new Database(state.dbPath);
      restore.prepare("UPDATE assessments SET enabled = 1 WHERE code = ?").run(RIASEC_CODE);
      restore.close();
    }
  });
});

describe("题库为参考数据的口径", () => {
  it("按 code 取到的题库仍是全量 120 题（抽题不改题库，只改每轮题号）", async () => {
    const questions = await getAssessmentQuestionsByCode(RIASEC_CODE);
    expect(questions).toHaveLength(BANK_SIZE);
    expect(questions.map((q) => q.question_index)).toEqual(Array.from({ length: BANK_SIZE }, (_, i) => i + 1));
  });
});

describe("作答锚点随量表下发（#289）", () => {
  it("两套量表的锚点都来自 ASSESSMENT_ANCHORS，未登记 code 回退到兴趣量表", () => {
    expect(ASSESSMENT_ANCHORS[RIASEC_CODE].map((a) => a.value)).toEqual([1, 2, 3, 4, 5]);
    expect(ASSESSMENT_ANCHORS[RIASEC_CODE][0].label).toBe("非常不愿意");
    expect(ASSESSMENT_ANCHORS[RIASEC_CODE][4].label).toBe("非常愿意");
    expect(ASSESSMENT_ANCHORS[IPIP_NEO_FFI_CODE][0].label).toBe("非常不同意");
    expect(ASSESSMENT_ANCHORS[IPIP_NEO_FFI_CODE][4].label).toBe("非常同意");
    expect(getAssessmentAnchors(RIASEC_CODE)).toBe(ASSESSMENT_ANCHORS[RIASEC_CODE]);
    expect(getAssessmentAnchors("unknown-scale")).toBe(ASSESSMENT_ANCHORS[RIASEC_CODE]);
  });
});

describe("多量表作答链路（#289）", () => {
  it("不带 code 进入仍是霍兰德（老入口行为不变）", async () => {
    const res = await startGet(getRequest("/api/shared/assessment/start", users.D.token));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assessment.code).toBe(RIASEC_CODE);
    expect(body.assessment.scoringMode).toBe("typological");
  });

  it("code=ipip-neo-ffi：同意度锚点、全量 50 题、提交结果 dimensional 且无三字码", async () => {
    const res = await startGet(
      getRequest(`/api/shared/assessment/start?code=${IPIP_NEO_FFI_CODE}`, users.D.token)
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.assessment.code).toBe(IPIP_NEO_FFI_CODE);
    expect(body.assessment.name).toBe(IPIP_ASSESSMENT.name);
    expect(body.assessment.scoringMode).toBe("dimensional");
    expect(body.assessment.anchors).toEqual(ASSESSMENT_ANCHORS[IPIP_NEO_FFI_CODE]);
    expect(body.questions).toHaveLength(IPIP_QUESTIONS.length);
    expect(body.assessment.questionCount).toBe(IPIP_QUESTIONS.length);
    expect(body.assessment.poolSize).toBe(IPIP_QUESTIONS.length);
    expect(body.progress).toEqual({ answered: 0, total: IPIP_QUESTIONS.length, percent: 0 });
    expect(body.questions[0]).not.toHaveProperty("dimension");

    for (const question of body.questions as { index: number }[]) {
      const answered = await answerPost(
        postRequest(
          "/api/shared/assessment/answer",
          { code: IPIP_NEO_FFI_CODE, questionIndex: question.index, value: 4 },
          users.D.token
        )
      );
      expect(answered.status).toBe(200);
    }

    const submitted = await submitPost(
      postRequest("/api/shared/assessment/submit", { code: IPIP_NEO_FFI_CODE }, users.D.token)
    );
    expect(submitted.status).toBe(200);
    const payload = await submitted.json();
    expect(payload.result.scoringMode).toBe("dimensional");
    expect(payload.result.typeCode).toBeNull();
    expect(payload.result.questionCount).toBe(IPIP_QUESTIONS.length);
    expect(payload.result.scores.map((s: { key: string }) => s.key)).toEqual(
      IPIP_DIMENSIONS.map((dimension) => dimension.key)
    );
    for (const score of payload.result.scores as { questionCount: number; answered: number; standard: number }[]) {
      expect(score.questionCount).toBe(10);
      expect(score.answered).toBe(10);
      expect(score.standard).toBeGreaterThanOrEqual(0);
      expect(score.standard).toBeLessThanOrEqual(100);
    }

    // 结果查询按 code 返回该量表的结果（#292 档案页据此渲染大五卡）
    const results = await resultsGet(
      getRequest(`/api/shared/assessment/results?code=${IPIP_NEO_FFI_CODE}`, users.D.token)
    );
    expect(results.status).toBe(200);
    const resultsBody = await results.json();
    expect(resultsBody.assessment.scoringMode).toBe("dimensional");
    expect(resultsBody.current.typeCode).toBeNull();
    expect(resultsBody.current.questionCount).toBe(IPIP_QUESTIONS.length);
    expect(resultsBody.current.scores.map((s: { key: string }) => s.key)).toEqual(
      IPIP_DIMENSIONS.map((dimension) => dimension.key)
    );
    expect(resultsBody.history).toHaveLength(1);
    // 按 code 的单套查询只回这一套量表：清单一律来自 /list（#291）
    expect(resultsBody.assessments).toBeUndefined();
  });
});

describe("测评中心多量表列表（#291）", () => {
  interface ListItem {
    code: string;
    name: string;
    questionCount: number;
    poolSize: number;
    scoringMode: string;
    scaleVersion: string;
    dimensions: { key: string; label: string }[];
    status: string;
    typeCode: string | null;
    completedAt: string;
    historyCount: number;
    inProgress: { answered: number; total: number; updatedAt: string } | null;
    attribution: string;
    licenseText: string;
    disclaimer: string;
  }

  async function listBody(token: string): Promise<{ assessments: ListItem[] }> {
    const res = await listGet(getRequest("/api/shared/assessment/list", token));
    expect(res.status).toBe(200);
    return res.json();
  }

  it("两套启用量表各一行：本人状态、题量口径与结果字段逐套下发", async () => {
    // A 的霍兰德已完成两轮；大五还没做过
    const body = await listBody(users.A.token);
    expect(body.assessments.map((entry) => entry.code)).toEqual([RIASEC_CODE, IPIP_NEO_FFI_CODE]);

    const riasec = body.assessments[0];
    expect(riasec).toMatchObject({
      status: "completed",
      typeCode: "RIA",
      historyCount: 2,
      questionCount: ROUND_SIZE,
      poolSize: BANK_SIZE,
      scoringMode: "typological",
      inProgress: null,
    });
    expect(riasec.completedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(riasec.scaleVersion).toBe(RIASEC_ASSESSMENT.scaleVersion);
    expect(riasec.dimensions.map((dimension) => dimension.key)).toEqual(DIMENSION_KEYS);
    // 授权与免责随列表下发，测评中心页底的授权卡不依赖 results 接口
    expect(riasec.attribution).toContain("O*NET");
    expect(riasec.licenseText.trim()).not.toBe("");
    expect(riasec.disclaimer).toContain("不作为心理诊断");

    const ipip = body.assessments[1];
    expect(ipip).toMatchObject({
      status: "not-started",
      typeCode: null,
      completedAt: "",
      historyCount: 0,
      questionCount: IPIP_QUESTIONS.length,
      poolSize: IPIP_QUESTIONS.length,
      scoringMode: "dimensional",
      inProgress: null,
    });
    expect(ipip.dimensions).toEqual(IPIP_DIMENSIONS);
  });

  it("dimensional 量表完成后状态为已完成、三字码为 null（不因无三字码被当成未开始）", async () => {
    const body = await listBody(users.D.token);
    const ipip = body.assessments.find((entry) => entry.code === IPIP_NEO_FFI_CODE)!;
    expect(ipip.status).toBe("completed");
    expect(ipip.typeCode).toBeNull();
    expect(ipip.completedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);
    expect(ipip.historyCount).toBe(1);

    // D 没做过霍兰德：同一份响应里两套量表的状态互不影响
    const riasec = body.assessments.find((entry) => entry.code === RIASEC_CODE)!;
    expect(riasec.status).toBe("not-started");
  });

  it("在途草稿：进行中进度按本轮题量、updatedAt 供「最近活跃」排序", async () => {
    const started = await startBody(users.B.token);
    const answered = await answerPost(
      postRequest(
        "/api/shared/assessment/answer",
        { code: RIASEC_CODE, questionIndex: started.roundIndexes[0], value: 4 },
        users.B.token
      )
    );
    expect(answered.status).toBe(200);

    const body = await listBody(users.B.token);
    const riasec = body.assessments.find((entry) => entry.code === RIASEC_CODE)!;
    expect(riasec.status).toBe("in-progress");
    expect(riasec.inProgress).toMatchObject({ answered: 1, total: ROUND_SIZE });
    expect(riasec.inProgress?.updatedAt.trim()).not.toBe("");

    // 另一套量表仍是未开始：草稿不会串到别的量表
    const ipip = body.assessments.find((entry) => entry.code === IPIP_NEO_FFI_CODE)!;
    expect(ipip.status).toBe("not-started");
    expect(ipip.inProgress).toBeNull();
  });

  it("只返回启用的量表：停用大五后列表只剩霍兰德（单量表页不回归）", async () => {
    const raw = new Database(state.dbPath);
    raw.prepare("UPDATE assessments SET enabled = 0 WHERE code = ?").run(IPIP_NEO_FFI_CODE);
    raw.close();

    try {
      const body = await listBody(users.A.token);
      expect(body.assessments.map((entry) => entry.code)).toEqual([RIASEC_CODE]);

      // 清单里没有 ≠ 读不到：停用量表的历史结果仍按 `?code=` 可读（档案页不显示，接口不丢数据）
      const disabled = await resultsGet(
        getRequest(`/api/shared/assessment/results?code=${IPIP_NEO_FFI_CODE}`, users.D.token)
      );
      expect(disabled.status).toBe(200);
      const disabledBody = await disabled.json();
      expect(disabledBody.assessment.enabled).toBe(false);
      expect(disabledBody.current.typeCode).toBeNull();
      expect(disabledBody.history).toHaveLength(1);
    } finally {
      const restore = new Database(state.dbPath);
      restore.prepare("UPDATE assessments SET enabled = 1 WHERE code = ?").run(IPIP_NEO_FFI_CODE);
      restore.close();
    }
  });

  it("每次读取都记审计：只记条数与量表 code，不记任何作答内容", async () => {
    const audit = await queryAuditLogs({ page: 1, pageSize: 20, action: "assessment:list" });
    expect(audit.total).toBeGreaterThan(0);
    const rows = audit.rows.filter((entry) => entry.actor_user_code === users.A.code && entry.status === "success");
    // 之后还有「停用大五」那次单量表读取，这里锁定两套量表都在时的那条
    const row = rows.find((entry) => JSON.parse(entry.metadata ?? "{}").count === 2);
    expect(row, "应有一条读到两套量表的审计").toBeDefined();
    const metadata = JSON.parse(row!.metadata ?? "{}");
    expect(metadata).toEqual({ count: 2, codes: [RIASEC_CODE, IPIP_NEO_FFI_CODE] });
    expect(metadata).not.toHaveProperty("answers");
  });
});

/**
 * 档案页结果区的取数链路（#292）：清单只有一个来源（`/list`），逐套按 `?code=` 取结果。
 * 这里锁住「清单有几套就取几套、每套只回自己、没做过的量表回空结果」——页面不依赖
 * `results` 附带清单，因此清单接口的字段一旦和结果接口分叉，这条链路会先在这里断掉。
 */
describe("档案页结果区取数链路（#292）", () => {
  it("先拿清单再逐套取结果：每套只回自己，未做过的量表回空结果", async () => {
    const listRes = await listGet(getRequest("/api/shared/assessment/list", users.A.token));
    expect(listRes.status).toBe(200);
    const { assessments } = (await listRes.json()) as { assessments: { code: string; status: string }[] };
    expect(assessments.map((entry) => entry.code)).toEqual([RIASEC_CODE, IPIP_NEO_FFI_CODE]);

    const payloads = await Promise.all(
      assessments.map(async (entry) => {
        const res = await resultsGet(getRequest(`/api/shared/assessment/results?code=${entry.code}`, users.A.token));
        expect(res.status).toBe(200);
        return res.json();
      })
    );

    // 逐套一一对应：`assessment.code` 就是请求的那个 code，且不再附带清单
    expect(payloads.map((payload) => payload.assessment.code)).toEqual(assessments.map((entry) => entry.code));
    for (const payload of payloads) {
      expect(payload.assessments).toBeUndefined();
    }

    // A 只做完了霍兰德：大五那套 current 为 null、history 为空（档案页据此不渲染结果卡）
    const riasec = payloads[0];
    expect(riasec.assessment.scoringMode).toBe("typological");
    expect(riasec.current.typeCode).toBe("RIA");
    expect(riasec.history.length).toBeGreaterThan(0);

    const ipip = payloads[1];
    expect(ipip.assessment.scoringMode).toBe("dimensional");
    expect(ipip.current).toBeNull();
    expect(ipip.history).toEqual([]);
    expect(ipip.inProgress).toBeNull();
  });
});
