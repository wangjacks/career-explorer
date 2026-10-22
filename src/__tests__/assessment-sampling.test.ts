import { describe, expect, it } from "vitest";
import {
  NEAR_DUPLICATE_GROUPS,
  RIASEC_ASSESSMENT,
  RIASEC_DIMENSIONS,
  RIASEC_QUESTIONS,
  RIASEC_SCALE_VERSION,
  type QuestionOrigin,
} from "@/lib/assessment-data";
import {
  buildItemsSnapshot,
  deriveDrawSeed,
  drawItems,
  mulberry32,
  parseItemsSnapshot,
  planAttempt,
  poolFingerprint,
  type DrawItem,
  type PoolItem,
} from "@/lib/assessment-sampling";

/**
 * #282 抽题器的纯函数用例：路由层（`assessment-api.test.ts`）只验「一张卷子能不能答完」，
 * 这里验形状规则本身——配比、近重复、顺序修整、降级阶梯、快照解析与兼容路径。
 * 题库用真实种子（120 题，6 维各 5 官方 Mini + 5 官方 SF + 10 原创），小池子场景另造合成题库。
 */

const BANK: DrawItem[] = RIASEC_QUESTIONS.map((q) => ({
  index: q.index,
  dimension: q.dimension,
  origin: q.origin,
}));
const POOL: PoolItem[] = BANK.map((item) => ({ ...item, version: 1 }));
/** #284 回退后真正可抽的题：60 道 O*NET 官方题（30 Mini-IP + 30 SF） */
const ELIGIBLE: DrawItem[] = BANK.filter((item) => item.origin !== "cn-original");
const PER_DIMENSION = RIASEC_ASSESSMENT.itemsPerAttempt / RIASEC_DIMENSIONS.length;

const byIndex = new Map<number, DrawItem>(BANK.map((item) => [item.index, item]));
/**
 * #284 回退后每维只剩 10 道官方题：排除上一轮 5 题后，C / E 两维剩余题里仍有近重复组，
 * 抽满 5 题必须放宽排除集，因此这两维允许出现个别重题；其余维度必须完全换新。
 */
const GROUP_CONSTRAINED_DIMENSIONS = new Set(
  NEAR_DUPLICATE_GROUPS.flat().map((index) => byIndex.get(index)!.dimension)
);

/** 卷面形状断言：题量、每维题数、只用已放行来源、近重复同卷一题、无 3 连同维 */
function expectPaperShape(indexes: readonly number[], perDimension = PER_DIMENSION) {
  expect(indexes).toHaveLength(perDimension * RIASEC_DIMENSIONS.length);
  expect(new Set(indexes).size).toBe(indexes.length);
  expect(indexes.every((index) => byIndex.has(index))).toBe(true);

  for (const dimension of RIASEC_DIMENSIONS) {
    const items = indexes.map((index) => byIndex.get(index)!).filter((item) => item.dimension === dimension.key);
    expect(items, `维度 ${dimension.key} 题数`).toHaveLength(perDimension);
    // #284 回退：原创题未通过专家评审与试测，整批不进抽题池
    expect(
      items.every((item) => item.origin !== "cn-original"),
      `维度 ${dimension.key} 不应抽到未放行的原创题`
    ).toBe(true);
  }

  for (const group of NEAR_DUPLICATE_GROUPS) {
    // 同卷至多一题（随机卷完全可能一道都不碰到，这里不能要求必中）
    expect(group.filter((index) => indexes.includes(index)).length).toBeLessThanOrEqual(1);
  }

  let run = 1;
  for (let i = 1; i < indexes.length; i += 1) {
    run = byIndex.get(indexes[i])!.dimension === byIndex.get(indexes[i - 1])!.dimension ? run + 1 : 1;
    expect(run, `第 ${i + 1} 题起出现 ${run} 连同维度`).toBeLessThanOrEqual(2);
  }
}

/** 合成小题库：造降级场景用，避免依赖真实题面的分布 */
function fakeBank(
  specs: readonly { key: string; items: readonly (readonly [number, QuestionOrigin])[] }[]
): { items: DrawItem[]; dimensions: { key: string }[] } {
  return {
    items: specs.flatMap((spec) => spec.items.map(([index, origin]) => ({ index, origin, dimension: spec.key }))),
    dimensions: specs.map((spec) => ({ key: spec.key })),
  };
}

describe("题库指纹与抽题种子", () => {
  it("指纹与题号顺序无关，题面版本或量表版本一变就变", () => {
    const asSet = [...POOL];
    const reversed = asSet.slice().reverse();
    expect(poolFingerprint(reversed, RIASEC_SCALE_VERSION)).toBe(
      poolFingerprint(asSet, RIASEC_SCALE_VERSION)
    );

    const bumped = asSet.map((item) => (item.index === 1 ? { ...item, version: 2 } : item));
    expect(poolFingerprint(bumped, RIASEC_SCALE_VERSION)).not.toBe(
      poolFingerprint(asSet, RIASEC_SCALE_VERSION)
    );
    expect(poolFingerprint(asSet, "RIASEC-CN 3.0")).not.toBe(
      poolFingerprint(asSet, RIASEC_SCALE_VERSION)
    );
    expect(poolFingerprint(asSet.slice(1), RIASEC_SCALE_VERSION)).not.toBe(
      poolFingerprint(asSet, RIASEC_SCALE_VERSION)
    );
    // #284 放行状态也是题库指纹的一部分：验证通过、恢复原创题后旧卷子必须重派
    expect(poolFingerprint(asSet, RIASEC_SCALE_VERSION, new Set())).not.toBe(
      poolFingerprint(asSet, RIASEC_SCALE_VERSION)
    );
  });

  it("种子把「谁 + 哪个量表 + 哪个题库 + 第几轮」四元组都吃进去", () => {
    const fp = poolFingerprint(POOL, RIASEC_SCALE_VERSION);
    const base = deriveDrawSeed(1, 1, fp, 1);
    expect(deriveDrawSeed(2, 1, fp, 1)).not.toBe(base);
    expect(deriveDrawSeed(1, 2, fp, 1)).not.toBe(base);
    expect(deriveDrawSeed(1, 1, "other", 1)).not.toBe(base);
    expect(deriveDrawSeed(1, 1, fp, 2)).not.toBe(base);
    expect(deriveDrawSeed(1, 1, fp, 1)).toBe(base);
  });

  it("mulberry32 同种子同序列，取值恒在 [0,1)", () => {
    const a = mulberry32(12345);
    const b = mulberry32(12345);
    for (let i = 0; i < 200; i += 1) {
      const value = a();
      expect(value).toBe(b());
      expect(value).toBeGreaterThanOrEqual(0);
      expect(value).toBeLessThan(1);
    }
  });
});

describe("drawItems：卷面形状", () => {
  it("同一确定性种子重算得到完全相同的卷子（GET /start 才能保持只读）", () => {
    const options = { items: BANK, dimensions: RIASEC_DIMENSIONS, perDimension: PER_DIMENSION };
    expect(drawItems({ ...options, rng: () => 0.42 }).indexes).toEqual(
      drawItems({ ...options, rng: () => 0.42 }).indexes
    );
  });

  it("真实题库在多种子下都是「每维 5 题 + 只用官方题 + 近重复一题 + 无 3 连」且不带降级", () => {
    for (let seed = 0; seed < 30; seed += 1) {
      const draw = drawItems({
        items: BANK,
        dimensions: RIASEC_DIMENSIONS,
        perDimension: PER_DIMENSION,
        rng: mulberry32(deriveDrawSeed(1, 1, "fp", seed + 1)),
      });
      expect(draw.warnings).toEqual([]);
      expectPaperShape(draw.indexes);
    }
  });

  it("排除上一轮题号后重抽：除近重复受限的维度外完全换新，形状规则仍成立", () => {
    const first = drawItems({
      items: BANK,
      dimensions: RIASEC_DIMENSIONS,
      perDimension: PER_DIMENSION,
      rng: mulberry32(deriveDrawSeed(1, 1, "fp", 1)),
    });
    const second = drawItems({
      items: BANK,
      dimensions: RIASEC_DIMENSIONS,
      perDimension: PER_DIMENSION,
      excludeIndexes: new Set(first.indexes),
      rng: mulberry32(deriveDrawSeed(1, 1, "fp", 2)),
    });
    // #284 回退后每维只剩 10 道官方题：C / E 两维排除上轮 5 题后再被近重复组挤掉可选题目，
    // 阶梯只能放宽排除集；其余四维必须完全换新，两轮也不能是同一张卷子
    const repeated = second.indexes.filter((index) => first.indexes.includes(index));
    expect(repeated.every((index) => GROUP_CONSTRAINED_DIMENSIONS.has(byIndex.get(index)!.dimension))).toBe(true);
    expect(second.indexes).not.toEqual(first.indexes);
    expectPaperShape(second.indexes);
  });

  it("多种子轮换覆盖可抽题库：60 道官方题都至少出现过一次，原创题永不被抽中", () => {
    const seen = new Set<number>();
    for (let attemptNo = 1; attemptNo <= 60; attemptNo += 1) {
      for (const index of drawItems({
        items: BANK,
        dimensions: RIASEC_DIMENSIONS,
        perDimension: PER_DIMENSION,
        rng: mulberry32(deriveDrawSeed(9, 1, "fp", attemptNo)),
      }).indexes) {
        seen.add(index);
      }
    }
    expect(ELIGIBLE.filter((item) => !seen.has(item.index))).toEqual([]);
    expect([...seen].some((index) => byIndex.get(index)!.origin === "cn-original")).toBe(false);
  });

  it("1000 次抽题：同类可交换题的频率在 3σ 内一致（分层抽样不偏袒具体题目）", () => {
    const draws = 1000;
    const counts = new Map<number, number>(ELIGIBLE.map((item) => [item.index, 0]));
    for (let userId = 1; userId <= draws; userId += 1) {
      for (const index of drawItems({
        items: BANK,
        dimensions: RIASEC_DIMENSIONS,
        perDimension: PER_DIMENSION,
        rng: mulberry32(deriveDrawSeed(userId, 1, "fp", 1)),
      }).indexes) {
        counts.set(index, (counts.get(index) ?? 0) + 1);
      }
    }

    // **可交换类**内的频率必须一致：同维度、同来源侧（当前只有官方题）、同近重复组归属的题目对
    // 抽样器完全对称，谁都不该比同类兄弟更常考。类的整体概率可以偏离 0.25——近重复组压低的是
    // 整类（被压掉的额度会流回同维其他题），但类内出现系统差就是抽样器有偏。
    const groupIdOf = new Map<number, number>();
    NEAR_DUPLICATE_GROUPS.forEach((group, id) => {
      for (const index of group) groupIdOf.set(index, id);
    });
    const classes = new Map<string, number[]>();
    for (const item of ELIGIBLE) {
      const key = `${item.dimension}:${item.origin === "cn-original" ? "original" : "official"}:${groupIdOf.get(item.index) ?? "free"}`;
      const list = classes.get(key);
      if (list) list.push(counts.get(item.index) ?? 0);
      else classes.set(key, [counts.get(item.index) ?? 0]);
    }

    const sigma = Math.sqrt(draws * 0.25 * 0.75);
    for (const [key, values] of classes) {
      const mean = values.reduce((sum, count) => sum + count, 0) / values.length;
      for (const count of values) {
        expect(Math.abs(count - mean), `类 ${key} 内题频 ${count} 偏离均值 ${mean}`).toBeLessThanOrEqual(3 * sigma);
      }
    }

    // 总量守恒：均匀性不是靠放宽带宽凑出来的（每维恰好贡献 perDimension 题 × 抽样次数）
    expect([...counts.values()].reduce((sum, count) => sum + count, 0)).toBe(
      draws * PER_DIMENSION * RIASEC_DIMENSIONS.length
    );
  });
});

describe("drawItems：降级阶梯（只打 warning，绝不抛错）", () => {
  it("池里没有可抽的原创题（#284 回退）时不适用来源配比，不报配比 warning", () => {
    const synthetic = fakeBank([
      { key: "A", items: [[1, "onet-mini"], [2, "onet-sf"], [3, "onet-mini"], [4, "onet-sf"]] },
      { key: "B", items: [[5, "onet-mini"], [6, "onet-sf"], [7, "onet-mini"], [8, "onet-sf"]] },
    ]);
    const draw = drawItems({
      items: synthetic.items,
      dimensions: synthetic.dimensions,
      perDimension: 3,
      nearDuplicateGroups: [],
      rng: () => 0.4,
    });
    expect(draw.warnings).toEqual([]);
    expect(draw.indexes).toHaveLength(6);
  });

  it("恢复原创题后（验证通过）：原创不够时仍按阶梯放宽配比并记 warning", () => {
    const synthetic = fakeBank([
      { key: "A", items: [[1, "onet-mini"], [2, "onet-sf"], [3, "onet-mini"], [4, "cn-original"]] },
      { key: "B", items: [[5, "onet-mini"], [6, "onet-sf"], [7, "onet-mini"], [8, "cn-original"]] },
    ]);
    const draw = drawItems({
      items: synthetic.items,
      dimensions: synthetic.dimensions,
      perDimension: 3,
      nearDuplicateGroups: [],
      excludedOrigins: new Set(),
      rng: () => 0.4,
    });
    expect(draw.warnings).toContain("来源配比放宽：该维度无法按官方 2-3 + 原创 2-3 抽取");
    expect(draw.indexes).toHaveLength(6);
  });

  it("排除上轮后不足每维题数：放宽排除集凑数，允许与上轮重复", () => {
    const synthetic = fakeBank([
      { key: "A", items: [[1, "onet-mini"], [2, "onet-sf"], [3, "onet-mini"], [4, "onet-sf"], [5, "onet-mini"]] },
      { key: "B", items: [[6, "onet-mini"], [7, "onet-sf"], [8, "onet-mini"], [9, "onet-sf"], [10, "onet-mini"]] },
    ]);
    const draw = drawItems({
      items: synthetic.items,
      dimensions: synthetic.dimensions,
      perDimension: 3,
      // 每维排除 3 题只剩 2 题（不足每维 3 题）→ 阶梯必须走到「放宽排除集」而不是少抽
      excludeIndexes: new Set([1, 2, 3, 6, 7, 8]),
      nearDuplicateGroups: [],
      rng: () => 0.4,
    });
    expect(draw.warnings.join("\n")).toContain("排除集放宽：该维度排除上轮题目后不足每维题数");
    expect(draw.indexes).toHaveLength(6);
  });

  it("近重复组被前一维度占用后本维无题可抽：放宽同组约束而不是少抽", () => {
    const synthetic = fakeBank([
      { key: "A", items: [[1, "onet-sf"]] },
      { key: "B", items: [[3, "onet-sf"]] },
    ]);
    const draw = drawItems({
      items: synthetic.items,
      dimensions: synthetic.dimensions,
      perDimension: 1,
      nearDuplicateGroups: [[1, 3]],
      rng: () => 0.4,
    });
    // 呈现顺序还要经整体洗牌 + 交错修整，这里只关心「两题都收了、没少抽」
    expect([...draw.indexes].sort((a, b) => a - b)).toEqual([1, 3]);
    expect(draw.warnings).toContain("近重复组放宽：该维度满足其余约束时无可选题目");
  });

  it("同组的题落在同一维度时，一次抽取内也只能取一题", () => {
    const synthetic = fakeBank([{ key: "A", items: [[1, "onet-sf"], [2, "onet-sf"], [3, "onet-sf"]] }]);
    const draw = drawItems({
      items: synthetic.items,
      dimensions: synthetic.dimensions,
      perDimension: 2,
      nearDuplicateGroups: [[1, 2]],
      rng: () => 0.4,
    });
    expect(draw.indexes.filter((index) => index === 1 || index === 2)).toHaveLength(1);
    expect(draw.indexes).toHaveLength(2);
  });

  it("某维一道题都没有：有多少抽多少，卷面短于目标题数也不 500", () => {
    const synthetic = fakeBank([
      { key: "A", items: [[1, "onet-sf"], [2, "onet-sf"], [3, "onet-sf"]] },
      { key: "B", items: [] },
    ]);
    const draw = drawItems({
      items: synthetic.items,
      dimensions: synthetic.dimensions,
      perDimension: 2,
      nearDuplicateGroups: [],
      rng: () => 0.4,
    });
    expect(draw.warnings).toContain("池子不足：该维度仅 0 题，无法抽满 2 题");
    expect(draw.indexes).toHaveLength(2);
    expect(draw.indexes.every((index) => index >= 1 && index <= 3)).toBe(true);
  });
});

describe("抽题快照的解析与序列化", () => {
  it("序列化后原样读回，题号顺序即呈现顺序", () => {
    const indexes = [17, 3, 91];
    const raw = buildItemsSnapshot(indexes, "abc123");
    expect(JSON.parse(raw)).toEqual({ v: 1, pool: "abc123", indexes });
    expect(parseItemsSnapshot(raw)).toEqual({ v: 1, pool: "abc123", indexes });
  });

  it("旧数据与脏数据一律读作「没有快照」，交调用方走兼容路径", () => {
    for (const raw of [null, undefined, "", "[]", "{}", "not json", '{"v":2,"pool":"a","indexes":[1]}']) {
      expect(parseItemsSnapshot(raw)).toBeNull();
    }
    // 缺 pool 或题号全非法也当作无快照，不返回半张卷子
    expect(parseItemsSnapshot('{"v":1,"pool":"","indexes":[1]}')).toBeNull();
    expect(parseItemsSnapshot('{"v":1,"pool":"a","indexes":[]}')).toBeNull();
    expect(parseItemsSnapshot('{"v":1,"pool":"a","indexes":[0,-3,"7",1.5]}')).toBeNull();
  });

  it("脏快照里的重复题号在解析时去重，不会把重复题带进计分引擎", () => {
    expect(parseItemsSnapshot('{"v":1,"pool":"a","indexes":[5,5,9,5,2]}')?.indexes).toEqual([5, 9, 2]);
  });
});

describe("planAttempt：本轮题号口径", () => {
  const fingerprint = poolFingerprint(POOL, RIASEC_SCALE_VERSION);

  function plan(overrides: Partial<Parameters<typeof planAttempt>[0]> = {}) {
    return planAttempt({
      pool: POOL,
      dimensions: RIASEC_DIMENSIONS,
      scaleVersion: RIASEC_SCALE_VERSION,
      itemsPerAttempt: RIASEC_ASSESSMENT.itemsPerAttempt,
      userId: 1,
      assessmentId: 1,
      attemptNo: 1,
      ...overrides,
    });
  }

  it("items_per_attempt = 0 是全量作答口径：本题库的可作答部分即本轮，不抽不排序", () => {
    const full = plan({ itemsPerAttempt: 0 });
    // #284 回退：全量口径也只含已放行来源（原创题不进卷）
    expect(full.indexes).toEqual(ELIGIBLE.map((item) => item.index));
    expect(full.poolFingerprint).toBe(fingerprint);
    expect(full.warnings).toEqual([]);
  });

  it("草稿带有效快照时直接复用快照：不受 rng 影响，也不重算抽题", () => {
    const indexes = ELIGIBLE.slice(0, 30).map((item) => item.index);
    const snapshotRaw = buildItemsSnapshot(indexes, fingerprint);
    for (const value of [0.01, 0.99]) {
      const result = plan({ snapshotRaw, answeredIndexes: new Set(indexes.slice(0, 2)), rng: () => value });
      expect(result.indexes).toEqual(indexes);
      expect(result.warnings).toEqual([]);
    }
  });

  it("题库改版后旧快照作废（指纹不一致就重派），不能拿旧卷子配新题库", () => {
    const snapshotRaw = buildItemsSnapshot([1, 2, 3, 4, 5], "stale-fingerprint");
    const result = plan({ snapshotRaw });
    expect(result.indexes).not.toEqual([1, 2, 3, 4, 5]);
    expect(result.poolFingerprint).toBe(fingerprint);
    expectPaperShape(result.indexes);
  });

  it("快照题号已被后台删掉时快照作废，但同轮次重派得到同一张卷子（续答不跳题）", () => {
    const first = plan({}).indexes;
    const result = plan({ snapshotRaw: buildItemsSnapshot([...first.slice(1), 999], fingerprint) });
    expect(result.indexes).toEqual(first);
    expect(result.indexes.every((index) => byIndex.has(index))).toBe(true);
    expectPaperShape(result.indexes);
  });

  it("全新一轮按排除集轮换，同 (用户, 轮次) 重算永远同一张卷子", () => {
    const first = plan({});
    const second = plan({ attemptNo: 2, excludedIndexes: new Set(first.indexes) });
    const repeated = second.indexes.filter((index) => first.indexes.includes(index));
    expect(repeated.every((index) => GROUP_CONSTRAINED_DIMENSIONS.has(byIndex.get(index)!.dimension))).toBe(true);
    expect(second.indexes).not.toEqual(first.indexes);
    expect(plan({ attemptNo: 2, excludedIndexes: new Set(first.indexes) })).toEqual(second);
  });

  it("轮换口径：第 3 轮只排除第 2 轮，与第 1 轮重叠是设计而非 bug", () => {
    const first = plan({ attemptNo: 1 }).indexes;
    const second = plan({ attemptNo: 2, excludedIndexes: new Set(first) }).indexes;
    const third = plan({ attemptNo: 3, excludedIndexes: new Set(second) });
    // 近重复受限的维度同样允许个别重题，其余四维必须与第 2 轮完全换新
    const repeated = third.indexes.filter((index) => second.includes(index));
    expect(repeated.every((index) => GROUP_CONSTRAINED_DIMENSIONS.has(byIndex.get(index)!.dimension))).toBe(true);
    expect(third.indexes).not.toEqual(second);
    // 排除集只取「上一条完成结果」，所以第 1 轮的题重新可选；实测确实回来了，否则等于题池逐轮单调缩小
    expect(third.indexes.filter((index) => first.includes(index)).length).toBeGreaterThan(0);
    expectPaperShape(third.indexes);
  });

  it("不同学生在同一轮拿到不同卷子（平行卷，降低互相抄答案）", () => {
    const a = plan({ userId: 11 }).indexes;
    const b = plan({ userId: 22 }).indexes;
    expect(a).not.toEqual(b);
    expectPaperShape(a);
    expectPaperShape(b);
  });

  it("无快照的在途草稿：已答题全部保留并补抽到每维题数，形状规则不破坏", () => {
    const officialByDim = (key: string) =>
      BANK.filter((item) => item.dimension === key && item.origin !== "cn-original")
        .map((item) => item.index)
        .slice(0, 2);
    // 升级前建立的草稿：每维已答的 2 题都是官方题，若配比只看补抽就会整维 5 题全官方
    const answered = new Set([...officialByDim("R"), ...officialByDim("I"), ...officialByDim("A")]);
    const result = plan({ answeredIndexes: answered });

    expect(result.indexes).toHaveLength(RIASEC_ASSESSMENT.itemsPerAttempt);
    expect(new Set(result.indexes).size).toBe(result.indexes.length);
    for (const index of answered) expect(result.indexes).toContain(index);
    expectPaperShape(result.indexes);
    expect(result.warnings).toEqual([]);
  });

  it("在途草稿已答 4 题时补第 5 题，不再报来源配比 warning（#284 回退后无配比约束）", () => {
    const officialInR = BANK.filter((item) => item.dimension === "R" && item.origin !== "cn-original").map(
      (item) => item.index
    );
    const answered = new Set(officialInR.slice(0, 4));
    const result = plan({ answeredIndexes: answered });

    const rOfficial = result.indexes
      .map((index) => byIndex.get(index)!)
      .filter((item) => item.dimension === "R" && item.origin !== "cn-original").length;
    expect(rOfficial).toBe(PER_DIMENSION);
    expect(result.warnings).toEqual([]);
    expect([...answered].every((index) => result.indexes.includes(index))).toBe(true);
  });

  it("在途草稿里的原创题作答不再进入本轮口径（#284 回退）", () => {
    const original = BANK.find((item) => item.origin === "cn-original")!;
    const official = BANK.find((item) => item.origin === "onet-mini")!;
    const result = plan({ answeredIndexes: new Set([original.index, official.index]) });
    expect(result.indexes).not.toContain(original.index);
    expect(result.indexes).toContain(official.index);
    expect(result.indexes.every((index) => byIndex.get(index)!.origin !== "cn-original")).toBe(true);
  });

  it("兼容路径不会重复抽到已答题（放宽排除集也不放宽本卷）", () => {
    const synthetic = fakeBank([{ key: "A", items: [[1, "onet-sf"], [2, "onet-sf"]] }]);
    const result = planAttempt({
      pool: synthetic.items.map((item) => ({ ...item, version: 1 })),
      dimensions: synthetic.dimensions,
      scaleVersion: "TEST 1.0",
      itemsPerAttempt: 3,
      userId: 1,
      assessmentId: 1,
      attemptNo: 1,
      answeredIndexes: new Set([1]),
    });
    // 每维要 3 题，池子只有 2 题：补抽只能给 1 题，重复题号是 bug
    expect(result.indexes).toEqual([1, 2]);
    expect(result.warnings.join("\n")).toContain("池子不足");
  });

  it("在途草稿在续答期间题号口径稳定：同一份草稿每次重算同一张卷子", () => {
    const answered = new Set([1, 20, 41]);
    expect(plan({ answeredIndexes: answered })).toEqual(plan({ answeredIndexes: answered }));
  });

  it("真实题库的兼容路径也要过顺序修整：不出现 3 题及以上连续同维度", () => {
    const result = plan({ answeredIndexes: new Set(RIASEC_QUESTIONS.slice(0, 12).map((q) => q.index)) });
    expect(result.indexes).toHaveLength(RIASEC_ASSESSMENT.itemsPerAttempt);
    expectPaperShape(result.indexes);
  });
});

describe("退役题号（#285）：指纹与抽题排除", () => {
  const RETIRED = new Set([1, 2, 3, 4, 5, 6]);

  it("退役集为空不改变题库指纹；登记退役题后指纹变化，且与集合顺序无关", () => {
    const base = poolFingerprint(POOL, RIASEC_SCALE_VERSION);
    expect(poolFingerprint(POOL, RIASEC_SCALE_VERSION, undefined, new Set())).toBe(base);
    const a = poolFingerprint(POOL, RIASEC_SCALE_VERSION, undefined, new Set([1, 2]));
    const b = poolFingerprint(POOL, RIASEC_SCALE_VERSION, undefined, new Set([2, 1]));
    expect(a).toBe(b);
    expect(a).not.toBe(base);
  });

  it("drawItems 永不抽退役题，卷面形状与配比不被破坏", () => {
    const result = drawItems({
      items: ELIGIBLE,
      dimensions: RIASEC_DIMENSIONS,
      perDimension: PER_DIMENSION,
      retiredIndexes: RETIRED,
      rng: mulberry32(20261021),
    });
    expect(result.indexes).toHaveLength(RIASEC_ASSESSMENT.itemsPerAttempt);
    expect(result.indexes.every((index) => !RETIRED.has(index))).toBe(true);
    expect(new Set(result.indexes).size).toBe(result.indexes.length);
    for (const dimension of RIASEC_DIMENSIONS) {
      const count = result.indexes.filter((index) => byIndex.get(index)!.dimension === dimension.key).length;
      expect(count, `维度 ${dimension.key} 题数`).toBe(PER_DIMENSION);
    }
    expect(result.warnings).toEqual([]);
  });

  it("planAttempt 的三种路径都排除退役题：新轮、全量作答、在途草稿", () => {
    const fresh = planAttempt({
      pool: POOL,
      dimensions: RIASEC_DIMENSIONS,
      scaleVersion: RIASEC_SCALE_VERSION,
      itemsPerAttempt: RIASEC_ASSESSMENT.itemsPerAttempt,
      userId: 1,
      assessmentId: 1,
      attemptNo: 1,
      retiredIndexes: RETIRED,
    });
    expect(fresh.indexes).toHaveLength(30);
    expect(fresh.indexes.every((index) => !RETIRED.has(index))).toBe(true);

    const full = planAttempt({
      pool: POOL,
      dimensions: RIASEC_DIMENSIONS,
      scaleVersion: RIASEC_SCALE_VERSION,
      itemsPerAttempt: 0,
      userId: 1,
      assessmentId: 1,
      attemptNo: 1,
      retiredIndexes: new Set([1]),
    });
    expect(full.indexes).not.toContain(1);
    expect(full.indexes).toHaveLength(ELIGIBLE.length - 1);

    // 已答的退役题不再进入本轮，其余已答题保留（在途草稿兼容路径）
    const draft = planAttempt({
      pool: POOL,
      dimensions: RIASEC_DIMENSIONS,
      scaleVersion: RIASEC_SCALE_VERSION,
      itemsPerAttempt: RIASEC_ASSESSMENT.itemsPerAttempt,
      userId: 1,
      assessmentId: 1,
      attemptNo: 1,
      answeredIndexes: new Set([1, 7]),
      retiredIndexes: new Set([1]),
    });
    expect(draft.indexes).not.toContain(1);
    expect(draft.indexes).toContain(7);
    expect(draft.indexes).toHaveLength(30);
    expectPaperShape(draft.indexes);
  });

  it("快照里含刚退役的题：即使指纹一致也作废重派，不拿退役题继续答卷", () => {
    const retired = new Set([1]);
    const fingerprint = poolFingerprint(POOL, RIASEC_SCALE_VERSION, undefined, retired);
    // 30 道官方题、每维 5 题，故意把第 1 题（R 维）留在快照里
    const indexes = ELIGIBLE.slice(0, 30).map((item) => item.index);
    expect(indexes).toContain(1);
    const result = planAttempt({
      pool: POOL,
      dimensions: RIASEC_DIMENSIONS,
      scaleVersion: RIASEC_SCALE_VERSION,
      itemsPerAttempt: RIASEC_ASSESSMENT.itemsPerAttempt,
      userId: 1,
      assessmentId: 1,
      attemptNo: 1,
      snapshotRaw: buildItemsSnapshot(indexes, fingerprint),
      retiredIndexes: retired,
    });
    expect(result.poolFingerprint).toBe(fingerprint);
    expect(result.indexes).not.toContain(1);
    expect(result.indexes).not.toEqual(indexes);
    expect(result.indexes).toHaveLength(30);
    expectPaperShape(result.indexes);
  });
});
