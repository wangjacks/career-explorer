import { describe, it, expect } from "vitest";
import {
  DEFAULT_TOP_N,
  MAX_TOP_N,
  RIASEC_KEYS,
  cosineSimilarity,
  emptyRiasecVector,
  hollandWeights,
  normalizeHollandCode,
  normalizeOnetScores,
  normalizeStudentScores,
  parseRiasecVector,
  profileFromDimensionScores,
  rankCareers,
  type CareerCandidate,
  type RiasecVector,
} from "../lib/assessment-match";
import { getOnetOccupationSeeds } from "../lib/onet";

function vector(partial: Partial<RiasecVector>): RiasecVector {
  return { ...emptyRiasecVector(), ...partial };
}

function candidate(code: string, scores: Partial<RiasecVector>): CareerCandidate {
  return {
    code,
    name: `职业 ${code}`,
    nameZh: null,
    interestCode: "RIC",
    scores: vector(scores),
    jobZone: 4,
    educationLevel: "本科",
    cluster: "计算机与数学",
  };
}

describe("归一化", () => {
  it("O*NET 1–7 分折算到 0–1，越界钳制", () => {
    expect(normalizeOnetScores(vector({ R: 1, I: 4, A: 7, S: 0, E: 8, C: 5.5 }))).toEqual({
      R: 0,
      I: 0.5,
      A: 1,
      S: 0,
      E: 1,
      C: 0.75,
    });
  });

  it("学生 0–100 标准分折算到 0–1，越界钳制、NaN 归 0", () => {
    expect(normalizeStudentScores(vector({ R: 0, I: 50, A: 100, S: -10, E: 120, C: Number.NaN }))).toEqual({
      R: 0,
      I: 0.5,
      A: 1,
      S: 0,
      E: 1,
      C: 0,
    });
  });
});

describe("三字码", () => {
  it("规范化：大写、去重、只留 RIASEC、最多 3 位", () => {
    expect(normalizeHollandCode("sia")).toBe("SIA");
    expect(normalizeHollandCode("SIAX")).toBe("SIA");
    expect(normalizeHollandCode("SSSR")).toBe("SR");
    expect(normalizeHollandCode("ABC")).toBe("AC");
    expect(normalizeHollandCode("")).toBeNull();
    expect(normalizeHollandCode("XYZ")).toBeNull();
    expect(normalizeHollandCode(null)).toBeNull();
  });

  it("权重向量：3/2/1，未出现的维为 0", () => {
    expect(hollandWeights("SIA")).toEqual({ R: 0, I: 2, A: 1, S: 3, E: 0, C: 0 });
    expect(hollandWeights("RI")).toEqual({ R: 3, I: 2, A: 0, S: 0, E: 0, C: 0 });
    expect(hollandWeights("XYZ")).toBeNull();
  });
});

describe("余弦相似度", () => {
  it("同一方向为 1（与量级无关）", () => {
    expect(cosineSimilarity(vector({ R: 3, I: 2 }), vector({ R: 30, I: 20 }))).toBeCloseTo(1, 10);
  });

  it("互不重叠的维度为 0，对称且落在 [-1, 1]", () => {
    const a = vector({ R: 1 });
    const b = vector({ S: 1 });
    expect(cosineSimilarity(a, b)).toBe(0);
    expect(cosineSimilarity(a, b)).toBe(cosineSimilarity(b, a));
    const value = cosineSimilarity(vector({ R: 1, I: 2 }), vector({ R: 2, I: 1 }));
    expect(value).toBeGreaterThan(0);
    expect(value).toBeLessThanOrEqual(1);
  });

  it("零向量 / 非法值返回 0（不产生 NaN 污染排序）", () => {
    expect(cosineSimilarity(emptyRiasecVector(), vector({ R: 1 }))).toBe(0);
    expect(cosineSimilarity(vector({ R: Number.NaN }), vector({ R: 1 }))).toBe(0);
  });
});

describe("画像来源", () => {
  it("从测评结果的维度标准分构造六维画像（忽略非 RIASEC 维度、越界钳制）", () => {
    const profile = profileFromDimensionScores([
      { key: "R", standard: 75 },
      { key: "I", standard: 150 },
      { key: "S", standard: -5 },
      { key: "O", standard: 90 }, // 非 RIASEC 维度
    ]);
    expect(profile).toMatchObject({ R: 75, I: 100, A: 0, S: 0, E: 0, C: 0 });
  });

  it("六维全缺失或全 0 时返回 null（没有可匹配的信息）", () => {
    expect(profileFromDimensionScores([])).toBeNull();
    expect(profileFromDimensionScores(null)).toBeNull();
    expect(profileFromDimensionScores([{ key: "R", standard: 0 }])).toBeNull();
    expect(profileFromDimensionScores([{ key: "O", standard: 80 }])).toBeNull();
  });

  it("interests_json 解析失败返回空向量（脏数据不带病计分）", () => {
    expect(parseRiasecVector('{"R":3.5,"I":6}')).toEqual(vector({ R: 3.5, I: 6 }));
    expect(parseRiasecVector("not json")).toEqual(emptyRiasecVector());
    expect(parseRiasecVector(null)).toEqual(emptyRiasecVector());
  });
});

describe("rankCareers 排序口径", () => {
  const candidates = [
    candidate("A-0001", { R: 7, I: 6, A: 3, S: 2, E: 1, C: 3 }),
    candidate("B-0002", { R: 1, I: 2, A: 3, S: 7, E: 6, C: 2 }),
    candidate("C-0003", { R: 4, I: 4, A: 4, S: 4, E: 4, C: 4 }),
  ];

  it("按相似度降序，rank 从 1 连续递增", () => {
    const matches = rankCareers(vector({ R: 100, I: 90 }), candidates);
    expect(matches).toHaveLength(3);
    expect(matches.map((m) => m.rank)).toEqual([1, 2, 3]);
    expect(matches[0].code).toBe("A-0001");
    expect(matches[0].similarity).toBeGreaterThanOrEqual(matches[1].similarity);
    expect(matches[1].similarity).toBeGreaterThanOrEqual(matches[2].similarity);
  });

  it("相同相似度按 code 升序破平（确定性）", () => {
    const twins = [candidate("Z-9", { R: 5 }), candidate("A-1", { R: 5 })];
    const first = rankCareers(vector({ R: 100 }), twins);
    expect(first.map((m) => m.code)).toEqual(["A-1", "Z-9"]);
    // 多次调用结果完全一致，不依赖输入顺序
    expect(rankCareers(vector({ R: 100 }), [...twins].reverse()).map((m) => m.code)).toEqual(["A-1", "Z-9"]);
  });

  it("topN 默认 6、上限 20、下限 1", () => {
    const many = Array.from({ length: 30 }, (_, i) => candidate(`X-${String(i).padStart(4, "0")}`, { R: 5 }));
    expect(rankCareers(vector({ R: 100 }), many)).toHaveLength(DEFAULT_TOP_N);
    expect(rankCareers(vector({ R: 100 }), many, { topN: 25 })).toHaveLength(MAX_TOP_N);
    expect(rankCareers(vector({ R: 100 }), many, { topN: 0 })).toHaveLength(1);
    expect(rankCareers(vector({ R: 100 }), many, { topN: 3 })).toHaveLength(3);
  });

  it("学生画像为零向量时返回空数组（不硬凑推荐）", () => {
    expect(rankCareers(emptyRiasecVector(), candidates)).toEqual([]);
  });

  it("相似度保留 4 位小数", () => {
    const matches = rankCareers(vector({ R: 100 }), candidates);
    for (const match of matches) {
      expect(match.similarity).toBe(Math.round(match.similarity * 10000) / 10000);
      expect(match.similarity).toBeGreaterThanOrEqual(0);
      expect(match.similarity).toBeLessThanOrEqual(1);
    }
  });
});

describe("与真实 O*NET 数据联调（自匹配回环）", () => {
  // 六个兴趣类型各取一个代表职业（企业型用 General and Operations Managers，高码 EC）；
  // 把职业自己的 O*NET 分换算成「学生标准分」，应把自己排进前列
  const SAMPLES = [
    ["15-1252.00", "I"], // Software Developers
    ["29-1141.00", "S"], // Registered Nurses
    ["27-1024.00", "A"], // Graphic Designers
    ["47-2111.00", "R"], // Electricians
    ["43-3031.00", "C"], // Bookkeeping Clerks
    ["11-1021.00", "E"], // General and Operations Managers
  ] as const;

  const seeds = getOnetOccupationSeeds();
  const candidates: CareerCandidate[] = seeds.map((seed) => ({
    code: seed.code,
    name: seed.name,
    nameZh: seed.nameZh,
    interestCode: seed.interestCode,
    scores: seed.scores,
    jobZone: seed.jobZone,
    educationLevel: seed.educationLevel,
    cluster: seed.cluster,
  }));

  it.each(SAMPLES)("职业 %s 用自身分数做画像时排进 Top-3，且首位与官方高码首位一致", (code, expectedType) => {
    const seed = seeds.find((s) => s.code === code);
    expect(seed, `数据快照里应有 ${code}`).toBeDefined();
    // O*NET 1–7 → 学生 0–100（线性同构，匹配只看形状，换算不改变排序）
    const profile = emptyRiasecVector();
    for (const key of RIASEC_KEYS) profile[key] = ((seed!.scores[key] - 1) / 6) * 100;

    const matches = rankCareers(profile, candidates);
    expect(matches).toHaveLength(DEFAULT_TOP_N);
    // 自身相似度必须是 1，且必然在 Top-3（除非存在向量完全相同的职业）
    const self = matches.find((m) => m.code === code);
    expect(self, `${code} 应出现在 Top-${DEFAULT_TOP_N} 内`).toBeDefined();
    expect(self!.similarity).toBe(1);
    expect(matches.slice(0, 3).some((m) => m.code === code)).toBe(true);

    // 官方高码首位 = 该职业六型最高分维；用它做画像时推荐首位也应是同一类型的主导职业
    expect(seed!.interestCode[0]).toBe(expectedType);
    const topScores = matches[0].scores;
    const topDominant = RIASEC_KEYS.reduce((best, key) => (topScores[key] > topScores[best] ? key : best), "R");
    expect(matches[0].interestCode[0]).toBe(topDominant);
  });

  it("同一画像重复调用结果完全一致（可复现）", () => {
    const profile = vector({ R: 60, I: 90, A: 40, S: 30, E: 20, C: 50 });
    const first = rankCareers(profile, candidates);
    const second = rankCareers(profile, candidates);
    expect(second).toEqual(first);
    expect(first.map((m) => m.code)).toEqual(rankCareers(profile, [...candidates].reverse()).map((m) => m.code));
  });
});
