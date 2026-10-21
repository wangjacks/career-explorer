import { describe, it, expect } from "vitest";
import type { UserRow } from "@/lib/db";
import { RIASEC_KEYS, type RiasecKey } from "@/lib/assessment-match";
import {
  FEATURE_SOURCES,
  GROUPING_BIG_FIVE_KEYS,
  GROUPING_ROLE_DEFS,
  GROUPING_ROLE_THRESHOLD,
  TAG_ONLY_SOURCES,
  bigfiveVectorOf,
  buildFeatureVectors,
  coverageBySource,
  dominantRiasecOf,
  featureLabels,
  hasValue,
  riasecVectorOf,
  roleCoverageOfVectors,
  roleLabelOf,
  rolesOf,
  untestedAssessmentCount,
  withWeights,
  type AssessmentFeatureContext,
  type FeatureExtractContext,
  type GroupingBigFiveKey,
} from "@/lib/grouping-features";
import {
  DEFAULT_GROUPING_STRATEGY,
  GROUPING_STRATEGIES,
  GROUPING_STRATEGY_INTEREST_CONTRAST,
  GROUPING_STRATEGY_INTEREST_ROLE,
  GROUPING_STRATEGY_TAGS_ONLY,
  ROLE_COVERAGE_TARGET,
  buildGrouping,
  computeSimilarities,
  groupingStrategyLabel,
  isGroupingStrategyKey,
} from "@/lib/grouping-utils";

/**
 * #345 测评分组：特征源（RIASEC + 大五去 N）、三种策略、确定性、角色覆盖。
 *
 * 全部是纯函数用例（无 IO）：算法输入由这里构造的上下文给定，不依赖数据库。
 */

function student(id: number, tags: string[] = []): UserRow {
  return {
    id,
    user_code: `2026${String(id).padStart(8, "0")}`,
    password_hash: null,
    role: "student",
    name: `学生${id}`,
    class_id: 1,
    tags: JSON.stringify(tags),
    avatar_url: null,
    evaluation_url: null,
    evaluation_text: null,
    submitted_at: null,
    created_at: "2026-09-30 00:00:00",
    storage_id: 1,
  };
}

/** 构造测评上下文：每人的 RIASEC 六维 + 大五 C/E/O/A */
function contextOf(
  entries: { id: number; riasec?: Partial<Record<RiasecKey, number>>; bigfive?: Partial<Record<GroupingBigFiveKey, number>> }[]
): FeatureExtractContext {
  const riasec: AssessmentFeatureContext["riasec"] = new Map();
  const bigfive: AssessmentFeatureContext["bigfive"] = new Map();
  for (const entry of entries) {
    if (entry.riasec) riasec.set(entry.id, entry.riasec);
    if (entry.bigfive) bigfive.set(entry.id, entry.bigfive);
  }
  return { assessments: { riasec, bigfive } };
}

function fullRiasec(dominant: RiasecKey, level = 80): Partial<Record<RiasecKey, number>> {
  const scores: Partial<Record<RiasecKey, number>> = {};
  for (const [index, key] of RIASEC_KEYS.entries()) {
    scores[key] = key === dominant ? level : 60 - index * 3;
  }
  return scores;
}

const HIGH = GROUPING_ROLE_THRESHOLD + 20;
const LOW = GROUPING_ROLE_THRESHOLD - 20;

/** 大五：每个角色维度只有一个是高的（保证每人恰好命中一个角色） */
function roleScores(roleIndex: number): Partial<Record<GroupingBigFiveKey, number>> {
  const scores: Partial<Record<GroupingBigFiveKey, number>> = {};
  GROUPING_BIG_FIVE_KEYS.forEach((key, index) => {
    scores[key] = index === roleIndex ? HIGH : LOW;
  });
  return scores;
}

/**
 * 12 人 / 3 种主导型（R、I、A）× 4 人，每人一个不同角色：
 * A 策略应把同型的人聚到一组（兴趣相近），同时每组角色覆盖 = 4（性格互补）。
 */
function strategyClass() {
  const users: UserRow[] = [];
  const entries: Parameters<typeof contextOf>[0] = [];
  const types: RiasecKey[] = ["R", "I", "A"];
  types.forEach((type, typeIndex) => {
    for (let k = 0; k < 4; k += 1) {
      // 学号跨类型交错：让「按学号切分」基线与按兴趣分组的差距真实存在（否则两者恒等）
      const id = k * 3 + typeIndex + 1;
      users.push(student(id, [`标签${typeIndex}`]));
      entries.push({
        id,
        riasec: fullRiasec(type, 90 - k), // 同型但高低略有差异，模拟真实分数
        bigfive: roleScores(k),
      });
    }
  });
  return { users, context: contextOf(entries) };
}

function build(users: UserRow[], context: FeatureExtractContext, strategy: string, variant = 0) {
  const vectors = buildFeatureVectors(users, FEATURE_SOURCES, context);
  return { result: buildGrouping(vectors, FEATURE_SOURCES, { strategy, variant }), vectors };
}

describe("分组特征源（#345）：RIASEC + 大五去 N", () => {
  it("默认权重为「标签 0.2 / 兴趣 0.5 / 性格 0.3」，三源均已注册并带版本", () => {
    expect(FEATURE_SOURCES.map((source) => [source.key, source.weight, source.version])).toEqual([
      ["tags", 0.2, "1"],
      ["riasec", 0.5, "1"],
      ["bigfive", 0.3, "1"],
    ]);
    expect(FEATURE_SOURCES.map((source) => source.kind)).toEqual(["set", "vector", "vector"]);
  });

  it("大五只注册 C/E/O/A：N 不在维度列表、不在角色映射、不进向量", () => {
    expect([...GROUPING_BIG_FIVE_KEYS]).toEqual(["C", "E", "O", "A"]);
    expect(GROUPING_BIG_FIVE_KEYS as readonly string[]).not.toContain("N");
    expect(GROUPING_ROLE_DEFS.map((role) => role.dimension)).toEqual(["C", "E", "O", "A"]);
    const { users, context } = strategyClass();
    const vector = buildFeatureVectors(users, FEATURE_SOURCES, context)[0];
    expect(riasecVectorOf(vector)).toHaveLength(6);
    expect(bigfiveVectorOf(vector)).toHaveLength(4);
  });

  it("主导型 / 角色 / 覆盖率 / 未测判定", () => {
    const { users, context } = strategyClass();
    const vectors = buildFeatureVectors(users, FEATURE_SOURCES, context);
    expect(dominantRiasecOf(vectors[0])).toBe("R");
    expect(dominantRiasecOf(vectors[4])).toBe("I");
    expect(rolesOf(vectors[0])).toHaveLength(1);
    expect(roleLabelOf(rolesOf(vectors[0])[0])).toBe("组织者");
    expect(roleCoverageOfVectors(vectors, [0, 1, 2])).toBe(3);
    expect(untestedAssessmentCount(vectors)).toBe(0);
    expect(coverageBySource(vectors).map((row) => row.key)).toEqual(["tags", "riasec", "bigfive"]);
    expect(coverageBySource(vectors)[1].covered).toBe(12);

    // 标签源仍按字符串数组展示；向量源只展示「主导型 / 角色」，不暴露原始分数
    const labels = featureLabels(vectors[0]);
    expect(labels.tags).toEqual(["标签0"]);
    expect(labels.riasec).toEqual(["R"]);
    expect(labels.bigfive).toEqual(["组织者"]);
  });

  it("withWeights 覆盖权重，非法/全零回落到默认", () => {
    const weighted = withWeights({ tags: 0, riasec: 1, bigfive: 0 });
    expect(weighted.map((source) => source.weight)).toEqual([0, 1, 0]);
    expect(withWeights({ tags: -1, riasec: NaN })).toEqual(FEATURE_SOURCES);
    expect(withWeights({ tags: 0, riasec: 0, bigfive: 0 })).toEqual(FEATURE_SOURCES);
    expect(withWeights(null)).toEqual(FEATURE_SOURCES);
  });

  it("缺测学生按可用源归一：只有标签的学生与「标签 + 测评」学生按标签相似度比较，不被 0 分测评稀释", () => {
    const users = [student(1, ["摄影"]), student(2, ["摄影"]), student(3, ["编程"])];
    const context = contextOf([
      { id: 2, riasec: fullRiasec("R"), bigfive: roleScores(0) },
      { id: 3, riasec: fullRiasec("A"), bigfive: roleScores(2) },
    ]);
    const withAll = buildFeatureVectors(users, FEATURE_SOURCES, context);
    const tagsOnly = buildFeatureVectors(users, TAG_ONLY_SOURCES, context);
    const simAll = computeSimilarities(withAll, FEATURE_SOURCES);
    const simTags = computeSimilarities(tagsOnly, TAG_ONLY_SOURCES);
    // 1 号没测评：与 2 号的相似度只剩标签源，应等于纯标签口径
    expect(simAll[0][1]).toBeCloseTo(simTags[0][1], 10);
    // 3 号标签不同：标签相似度 0 → 综合相似度也为 0（不是 0.5 * 0 + 0.5）
    expect(simAll[0][2]).toBeCloseTo(0, 10);
  });

  it("RIASEC 向量相似度按班内 z-score 标准化：所有维度整体平移不改变相似度（看形状而非绝对高低）", () => {
    const profile = [90, 70, 50, 60, 55, 45]; // R I A S E C
    const other = [40, 85, 45, 70, 35, 60];
    const third = [55, 50, 65, 40, 75, 30];
    const fourth = [60, 45, 40, 80, 50, 70];
    const rows = (shift: number) => [profile, other, third, fourth].map((row) => row.map((value) => value + shift));
    const build = (shift: number) => {
      const users = [1, 2, 3, 4].map((id) => student(id));
      const context = contextOf(
        rows(shift).map((row, index) => ({
          id: index + 1,
          riasec: Object.fromEntries(RIASEC_KEYS.map((key, i) => [key, row[i]])),
        }))
      );
      const vectors = buildFeatureVectors(users, [FEATURE_SOURCES[1]], context);
      return computeSimilarities(vectors, [FEATURE_SOURCES[1]]);
    };
    const base = build(0);
    const shifted = build(25);
    // 每个维度整体 +25：班内 z-score 不变，任意两人的相似度逐项一致
    for (let i = 0; i < 4; i += 1) {
      for (let j = 0; j < 4; j += 1) {
        expect(shifted[i][j]).toBeCloseTo(base[i][j], 8);
      }
    }
    // 自身相似度约定为 0（矩阵对角线不参与加权）；不同学生间有非零相似度（映射到 [0,1]）
    expect(base[0][0]).toBe(0);
    expect(base[0][1]).toBeGreaterThan(0);
  });
});

describe("三种策略（#345）", () => {
  it("策略注册表：默认 A，三种策略可读文案，历史策略名可回看", () => {
    expect(GROUPING_STRATEGIES.map((item) => item.key)).toEqual([
      GROUPING_STRATEGY_INTEREST_ROLE,
      GROUPING_STRATEGY_INTEREST_CONTRAST,
      GROUPING_STRATEGY_TAGS_ONLY,
    ]);
    expect(DEFAULT_GROUPING_STRATEGY).toBe(GROUPING_STRATEGY_INTEREST_ROLE);
    expect(GROUPING_STRATEGIES.filter((item) => item.isDefault).map((item) => item.key)).toEqual([
      GROUPING_STRATEGY_INTEREST_ROLE,
    ]);
    expect(groupingStrategyLabel(GROUPING_STRATEGY_INTEREST_ROLE)).toBe("兴趣相近 + 性格互补");
    expect(groupingStrategyLabel("idf-cosine")).toBe("仅按标签（现状）");
    expect(groupingStrategyLabel("unknown")).toBe("unknown");
    expect(isGroupingStrategyKey(GROUPING_STRATEGY_INTEREST_CONTRAST)).toBe(true);
    expect(isGroupingStrategyKey("nope")).toBe(false);
  });

  it("A（默认）：兴趣相近 + 角色互补——同主导型聚合，每组角色覆盖 ≥3，规模规则成立", () => {
    const { users, context } = strategyClass();
    const { result } = build(users, context, GROUPING_STRATEGY_INTEREST_ROLE);
    const sizes = result.groups.map((group) => group.length);
    expect(sizes).toEqual([4, 4, 4]);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);

    const vectors = result.vectors;
    for (const group of result.groups) {
      const types = new Set(group.map((index) => dominantRiasecOf(vectors[index])));
      expect(types.size).toBe(1);
      expect(roleCoverageOfVectors(vectors, group)).toBe(GROUPING_ROLE_DEFS.length);
    }
    expect(result.metrics.roleCoverageAverage).toBe(GROUPING_ROLE_DEFS.length);
    expect(result.metrics.roleCoverageTarget).toBe(ROLE_COVERAGE_TARGET);
    // 兴趣相似度应高于学号顺序切分基线
    expect(result.metrics.overall).toBeGreaterThan(result.metrics.baselines.sequence);
    expect(result.metrics.strategy).toBe(GROUPING_STRATEGY_INTEREST_ROLE);
    expect(result.metrics.coverageBySource?.map((row) => row.key)).toEqual(["tags", "riasec", "bigfive"]);
  });

  it("B（兴趣互补）：每组覆盖更多兴趣型，组内兴趣相似度低于 A", () => {
    const { users, context } = strategyClass();
    const vectors = buildFeatureVectors(users, FEATURE_SOURCES, context);
    const resultA = buildGrouping(vectors, FEATURE_SOURCES, { strategy: GROUPING_STRATEGY_INTEREST_ROLE });
    const resultB = buildGrouping(vectors, FEATURE_SOURCES, { strategy: GROUPING_STRATEGY_INTEREST_CONTRAST });
    for (const group of resultB.groups) {
      const types = new Set(group.map((index) => dominantRiasecOf(resultB.vectors[index])));
      expect(types.size).toBeGreaterThanOrEqual(2);
    }
    expect(resultB.metrics.overall).toBeLessThan(resultA.metrics.overall);
  });

  it("C（仅按标签）：测评数据不参与，结果与旧策略逐位一致", () => {
    const { users, context } = strategyClass();
    const vectorsWithAssessment = buildFeatureVectors(users, FEATURE_SOURCES, context);
    const legacy = buildGrouping(vectorsWithAssessment, TAG_ONLY_SOURCES);
    const withStrategy = buildGrouping(vectorsWithAssessment, TAG_ONLY_SOURCES, {
      strategy: GROUPING_STRATEGY_TAGS_ONLY,
    });
    expect(withStrategy.groups).toEqual(legacy.groups);
    expect(withStrategy.metrics.activeSourceKeys).toEqual(["tags"]);
  });

  it("缺测评数据时 A 仍可生成（退化为标签），未测人数如实统计", () => {
    const users = [student(1, ["摄影"]), student(2, ["摄影"]), student(3, ["编程"]), student(4, [])];
    const vectors = buildFeatureVectors(users, FEATURE_SOURCES, contextOf([]));
    const result = buildGrouping(vectors, FEATURE_SOURCES, { strategy: GROUPING_STRATEGY_INTEREST_ROLE });
    expect(result.groups.flat()).toHaveLength(4);
    expect(result.metrics.untestedCount).toBe(4);
    expect(result.metrics.roleCoverageAverage).toBe(0);
    expect(result.metrics.activeSourceKeys).toEqual(["tags"]);
  });

  it("大五 N 不参与算法：只翻转 N 不改变任何分组结果", () => {
    const { users, context } = strategyClass();
    // 在上下文里塞入 N（运行期可以有多余键；注册表只取 C/E/O/A，N 不会进入向量）
    const withN = contextOf(
      strategyClass().users.map((user, index) => ({
        id: user.id,
        riasec: fullRiasec((["R", "I", "A"] as RiasecKey[])[Math.floor(index / 4)], 90 - (index % 4)),
        bigfive: { ...roleScores(index % 4), N: index % 2 === 0 ? 95 : 5 } as Partial<
          Record<GroupingBigFiveKey, number>
        >,
      }))
    );
    const base = buildGrouping(buildFeatureVectors(users, FEATURE_SOURCES, context), FEATURE_SOURCES, {
      strategy: GROUPING_STRATEGY_INTEREST_ROLE,
    });
    const withNResult = buildGrouping(buildFeatureVectors(users, FEATURE_SOURCES, withN), FEATURE_SOURCES, {
      strategy: GROUPING_STRATEGY_INTEREST_ROLE,
    });
    expect(withNResult.groups).toEqual(base.groups);
    expect(withNResult.metrics).toEqual(base.metrics);
    // N 也不该出现在任何展示标签里
    const labels = featureLabels(buildFeatureVectors(users, FEATURE_SOURCES, withN)[0]);
    expect(JSON.stringify(labels)).not.toContain("N");
  });

  it("确定性：同输入同策略同 variant 逐位一致；不同 variant 给出另一版候选（仍确定）", () => {
    const { users, context } = strategyClass();
    const first = build(users, context, GROUPING_STRATEGY_INTEREST_ROLE, 0).result;
    const second = build(users, context, GROUPING_STRATEGY_INTEREST_ROLE, 0).result;
    expect(second.groups).toEqual(first.groups);
    expect(second.metrics).toEqual(first.metrics);

    const variantB = build(users, context, GROUPING_STRATEGY_INTEREST_ROLE, 1).result;
    const variantBAgain = build(users, context, GROUPING_STRATEGY_INTEREST_ROLE, 1).result;
    expect(variantBAgain.groups).toEqual(variantB.groups);
    // 6 种主导型的班级里，variant 会轮转主型配额 → 两版候选不同
    const sixTypes = ["R", "I", "A", "S", "E", "C"] as RiasecKey[];
    const wideUsers: UserRow[] = [];
    const wideEntries: Parameters<typeof contextOf>[0] = [];
    sixTypes.forEach((type, typeIndex) => {
      for (let k = 0; k < 2; k += 1) {
        const id = 100 + typeIndex * 10 + k;
        wideUsers.push(student(id));
        wideEntries.push({ id, riasec: fullRiasec(type, 88 - k), bigfive: roleScores(k) });
      }
    });
    const wideContext = contextOf(wideEntries);
    const v0 = build(wideUsers, wideContext, GROUPING_STRATEGY_INTEREST_ROLE, 0).result;
    const v1 = build(wideUsers, wideContext, GROUPING_STRATEGY_INTEREST_ROLE, 1).result;
    expect(v0.primaryTypes).not.toEqual(v1.primaryTypes);
  });

  it("输入顺序不影响结果（内部按学号稳定排序）", () => {
    const { users, context } = strategyClass();
    const reversed = [...users].reverse();
    const a = build(users, context, GROUPING_STRATEGY_INTEREST_ROLE).result;
    const b = build(reversed, context, GROUPING_STRATEGY_INTEREST_ROLE).result;
    expect(b.groups).toEqual(a.groups);
    expect(b.vectors.map((vector) => vector.userCode)).toEqual(a.vectors.map((vector) => vector.userCode));
  });

  it("非 5 人班（组间差 ≤1、上限 5）与 1 人边界", () => {
    const elevenUsers = Array.from({ length: 11 }, (_, index) => student(index + 1, index % 2 ? ["甲"] : ["乙"]));
    const vectors = buildFeatureVectors(elevenUsers, TAG_ONLY_SOURCES, contextOf([]));
    const result = buildGrouping(vectors, TAG_ONLY_SOURCES, { strategy: GROUPING_STRATEGY_INTEREST_ROLE });
    const sizes = result.groups.map((group) => group.length);
    expect(sizes.reduce((sum, size) => sum + size, 0)).toBe(11);
    expect(Math.max(...sizes)).toBeLessThanOrEqual(5);
    expect(Math.max(...sizes) - Math.min(...sizes)).toBeLessThanOrEqual(1);

    const single = buildFeatureVectors([student(1)], FEATURE_SOURCES, contextOf([]));
    expect(buildGrouping(single, FEATURE_SOURCES).groups).toHaveLength(1);
  });
});

describe("分组特征展示辅助（#345）", () => {
  it("hasValue 对向量型：空数组 / 含非数字视为缺值", () => {
    expect(hasValue([1, 2], "vector")).toBe(true);
    expect(hasValue([], "vector")).toBe(false);
    expect(hasValue([1, Number.NaN] as unknown as number[], "vector")).toBe(false);
    expect(hasValue(null, "vector")).toBe(false);
  });
});

describe("缺测学生的降级与均分（#345 验收）", () => {
  it("一半学生没做测评：只用标签参与，且被均分到各组（组间未测人数差 ≤1）", () => {
    const types: RiasecKey[] = ["R", "I", "A"];
    const users: UserRow[] = [];
    const entries: Parameters<typeof contextOf>[0] = [];
    // 12 人：6 人有测评（每型 2 人），6 人只有标签；学号交错，标签分组信号单独存在
    for (let index = 0; index < 12; index += 1) {
      const id = index + 1;
      users.push(student(id, [index % 3 === 0 ? "动手" : index % 3 === 1 ? "研究" : "创作"]));
      if (index % 2 === 0) {
        entries.push({
          id,
          riasec: fullRiasec(types[index % 3], 85),
          bigfive: roleScores(index % 4),
        });
      }
    }
    const vectors = buildFeatureVectors(users, FEATURE_SOURCES, contextOf(entries));
    const result = buildGrouping(vectors, FEATURE_SOURCES, { strategy: GROUPING_STRATEGY_INTEREST_ROLE });
    expect(result.groups.map((group) => group.length)).toEqual([4, 4, 4]);
    // 未测学生（无 riasec 向量）在组间的分布差 ≤1
    const unassessedPerGroup = result.groups.map(
      (group) => group.filter((index) => riasecVectorOf(result.vectors[index]) === null).length
    );
    expect(Math.max(...unassessedPerGroup) - Math.min(...unassessedPerGroup)).toBeLessThanOrEqual(1);
    // 覆盖率与未测人数如实统计
    expect(result.metrics.coverageBySource?.find((row) => row.key === "riasec")?.covered).toBe(6);
    expect(result.metrics.coverageBySource?.find((row) => row.key === "bigfive")?.covered).toBe(6);
    // 6 人两套都做了、6 人两套都没做 → 未测 6 人\n    expect(result.metrics.untestedCount).toBe(6);
  });
});
