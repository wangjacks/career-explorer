import { describe, it, expect } from "vitest";
import { loadAssessmentResultsData, type ResultsFetcher } from "../lib/assessment-results-loader";

interface Route {
  ok?: boolean;
  status?: number;
  body: unknown;
}

/** 计数桩：记录每次请求的地址，按前缀返回预置响应 */
function makeFetcher(routes: Record<string, Route>): { fetcher: ResultsFetcher; calls: string[] } {
  const calls: string[] = [];
  const fetcher: ResultsFetcher = async (input) => {
    calls.push(input);
    const key = Object.keys(routes).find((prefix) => input.startsWith(prefix));
    if (!key) throw new Error(`unexpected fetch: ${input}`);
    const route = routes[key];
    return { ok: route.ok ?? true, status: route.status ?? 200, json: async () => route.body };
  };
  return { fetcher, calls };
}

const LIST_BODY = {
  assessments: [
    {
      code: "riasec",
      name: "霍兰德职业兴趣测评",
      scoringMode: "typological",
      questionCount: 30,
      poolSize: 120,
      scaleVersion: "1.0",
      dimensions: [{ key: "S", label: "社会型" }],
      typeCode: "SIA",
      completedAt: "2026-10-20 10:00",
    },
    {
      code: "ipip-neo-ffi",
      name: "大五人格测评",
      scoringMode: "dimensional",
      questionCount: 50,
      poolSize: 50,
      scaleVersion: "1.0",
      dimensions: [{ key: "C", label: "尽责性" }],
      typeCode: null,
      completedAt: "2026-10-20 09:00",
    },
  ],
};

const HOLLAND_RESULT = {
  assessment: { code: "riasec", name: "霍兰德职业兴趣测评", dimensions: [{ key: "S", label: "社会型" }] },
  current: { id: 1, typeCode: "SIA", scores: [], completedAt: "2026-10-20 10:00", isCurrent: true },
  history: [],
  inProgress: null,
};

const BIG_FIVE_RESULT = {
  assessment: { code: "ipip-neo-ffi", name: "大五人格测评", dimensions: [{ key: "C", label: "尽责性" }] },
  current: { id: 2, typeCode: null, scores: [], completedAt: "2026-10-20 09:00", isCurrent: true },
  history: [],
  inProgress: null,
};

describe("loadAssessmentResultsData：一轮请求", () => {
  it("清单 1 次 + 每套结果 1 次 + 推荐职业 1 次（霍兰德有当前结果）", async () => {
    const { fetcher, calls } = makeFetcher({
      "/api/shared/assessment/list": { body: LIST_BODY },
      "/api/shared/assessment/results?code=riasec": { body: HOLLAND_RESULT },
      "/api/shared/assessment/results?code=ipip-neo-ffi": { body: BIG_FIVE_RESULT },
      "/api/shared/assessment/careers": {
        body: {
          careers: [{ code: "15-1252.00", name: "Software Developers", nameZh: "软件开发工程师", cluster: "计算机与数学", educationLevel: "本科" }],
          attribution: "O*NET CC BY 4.0",
        },
      },
    });

    const data = await loadAssessmentResultsData(fetcher);

    expect(calls).toEqual([
      "/api/shared/assessment/list",
      "/api/shared/assessment/results?code=riasec",
      "/api/shared/assessment/results?code=ipip-neo-ffi",
      "/api/shared/assessment/careers?limit=6",
    ]);
    expect(data.scales.map((item) => item.code)).toEqual(["riasec", "ipip-neo-ffi"]);
    expect(Object.keys(data.payloads).sort()).toEqual(["ipip-neo-ffi", "riasec"]);
    expect(data.failedCodes).toEqual([]);
    expect(data.careers).toHaveLength(1);
    expect(data.careers[0].displayName).toBe("软件开发工程师");
    expect(data.careersAttribution).toBe("O*NET CC BY 4.0");
    expect(data.listFailed).toBe(false);
    expect(data.careersFailed).toBe(false);
  });

  it("霍兰德没有当前结果时不请求推荐职业（少一轮）", async () => {
    const { fetcher, calls } = makeFetcher({
      "/api/shared/assessment/list": { body: { assessments: [LIST_BODY.assessments[0]] } },
      "/api/shared/assessment/results?code=riasec": {
        body: { ...HOLLAND_RESULT, current: null },
      },
    });

    const data = await loadAssessmentResultsData(fetcher);

    expect(calls.filter((url) => url.includes("/careers"))).toEqual([]);
    expect(data.careers).toEqual([]);
  });

  it("单套结果失败只记进 failedCodes，其它量表照常返回", async () => {
    const { fetcher } = makeFetcher({
      "/api/shared/assessment/list": { body: LIST_BODY },
      "/api/shared/assessment/results?code=riasec": { body: HOLLAND_RESULT },
      "/api/shared/assessment/results?code=ipip-neo-ffi": { ok: false, status: 500, body: { error: "boom" } },
      "/api/shared/assessment/careers": { body: { careers: [] } },
    });

    const data = await loadAssessmentResultsData(fetcher);

    expect(data.failedCodes).toEqual(["ipip-neo-ffi"]);
    expect(data.payloads.riasec).toBeTruthy();
    expect(data.payloads["ipip-neo-ffi"]).toBeUndefined();
  });

  it("清单失败时整体降级：不再逐套请求，listFailed=true", async () => {
    const { fetcher, calls } = makeFetcher({
      "/api/shared/assessment/list": { ok: false, status: 500, body: { error: "boom" } },
    });

    const data = await loadAssessmentResultsData(fetcher);

    expect(calls).toEqual(["/api/shared/assessment/list"]);
    expect(data.listFailed).toBe(true);
    expect(data.scales).toEqual([]);
  });

  it("推荐职业失败静默降级：careersFailed=true、职业务为空、不影响结果", async () => {
    const { fetcher } = makeFetcher({
      "/api/shared/assessment/list": { body: { assessments: [LIST_BODY.assessments[0]] } },
      "/api/shared/assessment/results?code=riasec": { body: HOLLAND_RESULT },
      "/api/shared/assessment/careers": { ok: false, status: 500, body: { error: "boom" } },
    });

    const data = await loadAssessmentResultsData(fetcher);

    expect(data.careersFailed).toBe(true);
    expect(data.careers).toEqual([]);
    expect(data.payloads.riasec).toBeTruthy();
  });

  it("清单返回脏数据时按空清单处理（不抛错）", async () => {
    const { fetcher, calls } = makeFetcher({
      "/api/shared/assessment/list": { body: { assessments: "not-an-array" } },
    });

    const data = await loadAssessmentResultsData(fetcher);

    expect(calls).toEqual(["/api/shared/assessment/list"]);
    expect(data.scales).toEqual([]);
    expect(data.listFailed).toBe(false);
  });
});
