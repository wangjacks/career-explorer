import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "fs";
import { tmpdir } from "os";
import path from "path";
import Database from "better-sqlite3";
import { NextRequest } from "next/server";

/** 指向临时 SQLite：本文件走**真实数据层 + 真实计分引擎**，只把 db-config 里写死的库路径换掉 */
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
import { closeDb, insertUser, queryAuditLogs } from "@/lib/db";
import { RIASEC_CODE, RIASEC_QUESTIONS } from "@/lib/assessment-data";
import { LIKERT_ANCHORS } from "@/lib/assessment-flow";
import { GET as startGet } from "@/app/api/shared/assessment/start/route";
import { POST as answerPost } from "@/app/api/shared/assessment/answer/route";
import { POST as submitPost } from "@/app/api/shared/assessment/submit/route";
import { GET as resultsGet } from "@/app/api/shared/assessment/results/route";

const BASE = "http://localhost:3000";
/** 题库总量与每维题数（#281 起 120 / 20） */
const BANK_SIZE = RIASEC_QUESTIONS.length;
const PER_DIMENSION = BANK_SIZE / 6;

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

let tempDir = "";
const users: Record<"A" | "B", { uid: number; token: string; code: string; name: string }> = {
  A: { uid: 0, token: "", code: "202505050101", name: "张三" },
  B: { uid: 0, token: "", code: "202505050102", name: "李四" },
};
let teacherToken = "";

/** 连续答一段题号（每题一次 answer 调用，与答题页行为一致） */
async function answerRange(token: string, from: number, to: number, value: number) {
  for (let index = from; index <= to; index += 1) {
    const res = await answerPost(
      postRequest("/api/shared/assessment/answer", { code: RIASEC_CODE, questionIndex: index, value }, token)
    );
    expect(res.status).toBe(200);
  }
}

beforeAll(async () => {
  // #281：题库扩到 120，作答接口当前仍按「全库即本轮」下发（分层抽题在后续 Issue）
  tempDir = mkdtempSync(path.join(tmpdir(), "career-assessment-api-"));
  state.dbPath = path.join(tempDir, "test.db");

  users.A.uid = await insertUser({ user_code: users.A.code, role: "student", name: users.A.name });
  users.B.uid = await insertUser({ user_code: users.B.code, role: "student", name: users.B.name });
  users.A.token = await signToken({ role: "student", uid: users.A.uid, name: users.A.name });
  users.B.token = await signToken({ role: "student", uid: users.B.uid, name: users.B.name });
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
  ];

  it.each(endpoints)("$name：未登录 401、无效 token 401、教师 403", async ({ call }) => {
    expect((await call()).status).toBe(401);
    expect((await call("not-a-token")).status).toBe(401);
    expect((await call(teacherToken)).status).toBe(403);
  });
});

describe("进入答题页与草稿续答", () => {
  it("下发全量 120 题、量表元信息与空进度；不暴露题目维度（避免暗示答案）", async () => {
    const res = await startGet(getRequest(`/api/shared/assessment/start?code=${RIASEC_CODE}`, users.A.token));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.questions).toHaveLength(BANK_SIZE);
    expect(body.questions.map((q: { index: number }) => q.index)).toEqual(
      Array.from({ length: BANK_SIZE }, (_, i) => i + 1)
    );
    expect(body.questions[0]).toEqual({ index: 1, prompt: "动手制作厨房橱柜" });
    expect(body.questions[0]).not.toHaveProperty("dimension");
    expect(body.assessment.dimensions.map((d: { key: string }) => d.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(body.assessment.attribution).toContain("O*NET");
    expect(body.assessment.disclaimer).toContain("不作为心理诊断");
    expect(body.draft).toBeNull();
    expect(body.progress).toEqual({ answered: 0, total: BANK_SIZE, percent: 0 });
    expect(body.resumeIndex).toBe(1);
  });

  it("每题作答即落草稿：重复进入按上次题号续答", async () => {
    const first = await answerPost(
      postRequest("/api/shared/assessment/answer", { code: RIASEC_CODE, questionIndex: 1, value: 4 }, users.A.token)
    );
    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ saved: true, progress: { answered: 1, total: BANK_SIZE }, nextIndex: 2 });

    await answerRange(users.A.token, 2, 10, 3);

    const resumed = await startGet(getRequest(`/api/shared/assessment/start?code=${RIASEC_CODE}`, users.A.token));
    const body = await resumed.json();
    expect(body.progress).toEqual({ answered: 10, total: BANK_SIZE, percent: 8 });
    expect(body.resumeIndex).toBe(11);
    expect(body.draft.answers["1"]).toBe(4);
    expect(body.draft.answers["10"]).toBe(3);
  });

  it("非法作答一律 400（题号 / 取值 / 题库外题号），未知量表 404", async () => {
    const cases: { body: Record<string, unknown>; status: number }[] = [
      { body: { code: RIASEC_CODE, questionIndex: 0, value: 4 }, status: 400 },
      { body: { code: RIASEC_CODE, questionIndex: 1, value: 6 }, status: 400 },
      { body: { code: RIASEC_CODE, questionIndex: 1, value: "4" }, status: 400 },
      { body: { code: RIASEC_CODE, questionIndex: 121, value: 4 }, status: 400 },
      { body: { code: "unknown", questionIndex: 1, value: 4 }, status: 404 },
    ];
    for (const item of cases) {
      const res = await answerPost(postRequest("/api/shared/assessment/answer", item.body, users.A.token));
      expect(res.status).toBe(item.status);
    }
  });
});

describe("提交与结果落库", () => {
  it("未答完 → 400 并回带缺失题号，且记失败审计", async () => {
    const res = await submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, users.A.token));
    expect(res.status).toBe(400);
    const body = await res.json();
    expect(body.error).toContain("未作答");
    expect(body.missingIndexes).toHaveLength(BANK_SIZE - 10);
    expect(body.missingIndexes[0]).toBe(11);

    const failed = await queryAuditLogs({ page: 1, pageSize: 20, action: "assessment:submit" });
    expect(failed.rows.some((row) => row.status === "failed")).toBe(true);
  });

  it("120 题全答后提交：三字码与引擎一致（全 4 分 → 六维 75 / RIA）", async () => {
    // 统一覆盖成 4 分（上面的续答用例留了几道 3 分）：六维并列时按 R,I,A,S,E,C 破平
    await answerRange(users.A.token, 1, BANK_SIZE, 4);
    const res = await submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, users.A.token));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.result.typeCode).toBe("RIA");
    expect(body.result.questionCount).toBe(BANK_SIZE);
    expect(body.result.scores).toHaveLength(6);
    expect(
      body.result.scores.every(
        (s: { standard: number; questionCount: number }) => s.standard === 75 && s.questionCount === PER_DIMENSION
      )
    ).toBe(true);
    expect(body.result.completedAt).toBeTruthy();
    expect(body.result.disclaimer).toContain("不作为心理诊断");
  });

  it("结果查询：当前结果 + 历史版本 + 六维得分快照，并记读取审计", async () => {
    const res = await resultsGet(getRequest(`/api/shared/assessment/results?code=${RIASEC_CODE}`, users.A.token));
    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.current.typeCode).toBe("RIA");
    expect(body.current.isCurrent).toBe(true);
    expect(body.current.scores.map((s: { key: string }) => s.key)).toEqual(["R", "I", "A", "S", "E", "C"]);
    expect(body.history).toHaveLength(1);
    expect(body.history[0].id).toBe(body.current.id);
    expect(body.inProgress).toBeNull(); // 提交后草稿已转成完成记录
    expect(body.assessment.attribution).toContain("O*NET");
    // #222 测评中心据此决定给不给「开始 / 继续作答」入口
    expect(body.assessment.enabled).toBe(true);

    const audit = await queryAuditLogs({ page: 1, pageSize: 20, action: "assessment:results" });
    expect(audit.total).toBeGreaterThan(0);
    expect(JSON.parse(audit.rows[0].metadata ?? "{}")).toMatchObject({ hasCurrent: true });
  });

  it("作答审计只记进度不记选项（选项是个人数据，不重复落审计表）", async () => {
    const audit = await queryAuditLogs({ page: 1, pageSize: 50, action: "assessment:answer" });
    expect(audit.total).toBeGreaterThan(30);
    // 成功与失败的行都不落选项值
    for (const row of audit.rows) {
      const metadata = JSON.parse(row.metadata ?? "{}");
      expect(metadata).not.toHaveProperty("value");
    }
    const metadata = JSON.parse(audit.rows[0].metadata ?? "{}");
    expect(metadata).toHaveProperty("answered");
    expect(metadata).toHaveProperty("total");
    expect(audit.rows.every((row) => row.actor_user_code === users.A.code)).toBe(true);
  });
});

describe("重复测评：生成新版本而不丢历史", () => {
  it("再答一轮并提交 → 新版本成为当前版本，旧版本保留为历史", async () => {
    // 全部答 2 分：原始分 10 / 量程 5-25 → 标准分 25，六维并列仍按 R,I,A,S,E,C 破平
    await answerRange(users.A.token, 1, BANK_SIZE, 2);
    const res = await submitPost(postRequest("/api/shared/assessment/submit", { code: RIASEC_CODE }, users.A.token));
    expect(res.status).toBe(200);
    const submitted = await res.json();
    expect(submitted.result.typeCode).toBe("RIA");
    expect(submitted.result.scores.every((s: { standard: number }) => s.standard === 25)).toBe(true);

    const results = await resultsGet(getRequest(`/api/shared/assessment/results?code=${RIASEC_CODE}`, users.A.token));
    const body = await results.json();
    expect(body.history).toHaveLength(2);
    expect(body.history[0].id).toBe(body.current.id);
    expect(body.history[0].isCurrent).toBe(true);
    expect(body.history[1].isCurrent).toBe(false);
    expect(body.history[1].completedAt).toBeTruthy(); // 旧版本快照仍在
    expect(body.history[1].scores.every((s: { standard: number }) => s.standard === 75)).toBe(true);
  });
});

describe("学生之间互不可见", () => {
  it("B 的草稿与结果不受 A 影响；B 的读取不会带出 A 的数据", async () => {
    const startB = await startGet(getRequest(`/api/shared/assessment/start?code=${RIASEC_CODE}`, users.B.token));
    const startBody = await startB.json();
    expect(startBody.draft).toBeNull();
    expect(startBody.progress).toEqual({ answered: 0, total: BANK_SIZE, percent: 0 });
    expect(startBody.resumeIndex).toBe(1);

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

describe("量表停用", () => {
  it("停用后 start / answer / submit 拒绝（403），历史结果仍可读", async () => {
    const raw = new Database(state.dbPath);
    raw.prepare("UPDATE assessments SET enabled = 0 WHERE code = ?").run(RIASEC_CODE);
    raw.close();

    try {
      expect((await startGet(getRequest(`/api/shared/assessment/start?code=${RIASEC_CODE}`, users.A.token))).status).toBe(403);
      const answerRes = await answerPost(
        postRequest("/api/shared/assessment/answer", { code: RIASEC_CODE, questionIndex: 1, value: 4 }, users.A.token)
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
    } finally {
      const restore = new Database(state.dbPath);
      restore.prepare("UPDATE assessments SET enabled = 1 WHERE code = ?").run(RIASEC_CODE);
      restore.close();
    }
  });
});

describe("作答锚点", () => {
  it("答题页展示的 5 档锚点与引擎量程一致（不愿→愿意，兴趣量表口径）", () => {
    expect(LIKERT_ANCHORS).toHaveLength(5);
    expect(LIKERT_ANCHORS[0]).toEqual({ value: 1, label: "非常不愿意" });
    expect(LIKERT_ANCHORS[4]).toEqual({ value: 5, label: "非常愿意" });
  });
});
