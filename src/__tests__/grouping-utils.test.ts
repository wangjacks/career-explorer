import { describe, it, expect } from "vitest";
import type { UserRow } from "../lib/db";
import {
  FEATURE_SOURCES,
  buildFeatureVectors,
  describeSources,
  type FeatureSourceDef,
} from "../lib/grouping-features";
import {
  GROUP_SIZE_CAP,
  buildGrouping,
  computeGroupSizes,
  computeSimilarities,
} from "../lib/grouping-utils";

/** 造一个学生行；tags 传名称数组（内部序列化成库里的 JSON 文本） */
function student(id: number, tags: string[], score?: number): UserRow {
  const row: UserRow = {
    id,
    user_code: `2026${String(id).padStart(8, "0")}`,
    password_hash: null,
    role: "student",
    name: `学生${id}`,
    class_id: 1,
    tags: tags.length ? JSON.stringify(tags) : null,
    avatar_url: null,
    evaluation_url: null,
    submitted_at: null,
    created_at: "2026-09-30 00:00:00",
    storage_id: 1,
  };
  if (score !== undefined) (row as unknown as { score: number }).score = score;
  return row;
}

const TAGS_SOURCE = FEATURE_SOURCES[0];

/** 第二数据源（数值型）：用来证明多源加权真的生效，而不是口头可扩展 */
function numericSource(weight: number): FeatureSourceDef {
  return {
    key: "score",
    label: "测评得分",
    kind: "numeric",
    weight,
    extract: (user) => {
      const raw = (user as unknown as { score?: number }).score;
      return typeof raw === "number" ? raw : null;
    },
  };
}

/** 覆盖常见的班级规模 + 边界值 */
const SIZES_TO_CHECK = [
  1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 49, 50, 51, 52, 53, 54, 55, 56, 57, 58,
  59, 60, 61,
];

describe("computeGroupSizes（#101 组规模规则）", () => {
  it("任意 n：组数 = ⌈n/5⌉、每组 ≤5、组间差 ≤1、总人数守恒", () => {
    for (const n of SIZES_TO_CHECK) {
      const sizes = computeGroupSizes(n);
      expect(sizes.reduce((a, b) => a + b, 0), `n=${n} 总人数`).toBe(n);
      expect(sizes.length, `n=${n} 组数`).toBe(Math.ceil(n / GROUP_SIZE_CAP));
      expect(Math.max(...sizes), `n=${n} 上限`).toBeLessThanOrEqual(GROUP_SIZE_CAP);
      expect(Math.max(...sizes) - Math.min(...sizes), `n=${n} 组间差`).toBeLessThanOrEqual(1);
    }
  });

  it("54 人 → 10 组 5 人 + 1 组 4 人（与业务预期一致）", () => {
    const sizes = computeGroupSizes(54);
    expect(sizes.length).toBe(11);
    expect(sizes.filter((s) => s === 5).length).toBe(10);
    expect(sizes.filter((s) => s === 4).length).toBe(1);
  });

  it("下限：n ≥ 8 且 n ≠ 11 时每组 ≥4；{3,6,7,11} 只能到 3；n ≤ 2 单组", () => {
    for (const n of SIZES_TO_CHECK) {
      const min = Math.min(...computeGroupSizes(n));
      if (n <= 2) expect(min, `n=${n} 下限`).toBe(n);
      else if (n >= 8 && n !== 11) expect(min, `n=${n} 下限`).toBeGreaterThanOrEqual(4);
      else expect(min, `n=${n} 下限`).toBeGreaterThanOrEqual(3);
    }
  });

  it("n ≤ 0 → 空（不分组）", () => {
    expect(computeGroupSizes(0)).toEqual([]);
    expect(computeGroupSizes(-3)).toEqual([]);
  });
});

describe("buildGrouping（#101 分组算法）", () => {
  const cohort = (n: number): UserRow[] => {
    const pool = ["摄影", "音乐", "编程", "阅读", "运动", "绘画", "旅行", "电影"];
    return Array.from({ length: n }, (_, k) =>
      student(k + 1, [pool[k % pool.length], pool[(k + 3) % pool.length]])
    );
  };

  it("不变量：任意 n 下组数/容量守恒、每人恰好出现一次、组内升序", () => {
    for (const n of SIZES_TO_CHECK) {
      const result = buildGrouping(buildFeatureVectors(cohort(n)));
      const sizes = result.groups.map((g) => g.length);
      expect(result.groups.length, `n=${n} 组数`).toBe(Math.ceil(n / GROUP_SIZE_CAP));
      expect(sizes.reduce((a, b) => a + b, 0), `n=${n} 人数守恒`).toBe(n);
      expect(sizes, `n=${n} 容量与规则一致`).toEqual(computeGroupSizes(n));
      const flat = result.groups.flat();
      expect(new Set(flat).size, `n=${n} 无重复`).toBe(n);
      for (const g of result.groups) {
        expect([...g].sort((a, b) => a - b)).toEqual(g);
      }
    }
  });

  it("54 人给出 11 组，且每组成员数符合 10×5 + 1×4", () => {
    const result = buildGrouping(buildFeatureVectors(cohort(54)));
    expect(result.groups.length).toBe(11);
    expect(result.groups.map((g) => g.length).filter((s) => s === 5).length).toBe(10);
    expect(result.groups.map((g) => g.length).filter((s) => s === 4).length).toBe(1);
  });

  it("确定性：同一份数据重复计算结果完全一致（与输入顺序无关）", () => {
    const users = cohort(30);
    const a = buildGrouping(buildFeatureVectors(users));
    const b = buildGrouping(buildFeatureVectors(users));
    expect(b.groups).toEqual(a.groups);
    // 打乱输入顺序后结果不变（内部先按学号排序）
    const shuffled = [...users].reverse();
    const c = buildGrouping(buildFeatureVectors(shuffled));
    expect(c.groups).toEqual(a.groups);
    expect(c.vectors.map((v) => v.userCode)).toEqual(a.vectors.map((v) => v.userCode));
  });

  it("结果优于两条基线（顺次分组 / 固定种子随机）", () => {
    // 4 个兴趣簇，各自 10 人；**按学号轮转入库**，使「顺次分组」恰好打散簇（对抗性基线）
    const clusters = [
      ["摄影", "旅行"],
      ["编程", "阅读"],
      ["音乐", "电影"],
      ["运动", "绘画"],
    ];
    const users: UserRow[] = [];
    for (let k = 0; k < 40; k++) users.push(student(k + 1, clusters[k % clusters.length]));
    const result = buildGrouping(buildFeatureVectors(users));
    expect(result.metrics.overall).toBeGreaterThan(result.metrics.baselines.sequence);
    expect(result.metrics.overall).toBeGreaterThan(result.metrics.baselines.random);
    // 簇内标签完全相同 → 理想结果下组内相似度全为 1，整体目标值 = Σ 组内对数
    const expectedPairs = computeGroupSizes(40).reduce((sum, s) => sum + (s * (s - 1)) / 2, 0);
    expect(result.metrics.overall).toBeCloseTo(expectedPairs, 6);
  });

  it("退化：全班都没有标签 → 不报错、指标如实为 0，且仍是确定性分配", () => {
    const users = Array.from({ length: 12 }, (_, k) => student(k + 1, []));
    const result = buildGrouping(buildFeatureVectors(users));
    expect(result.metrics.coveredCount).toBe(0);
    expect(result.metrics.nonZeroPairs).toBe(0);
    expect(result.metrics.overall).toBe(0);
    expect(result.metrics.activeSourceKeys).toEqual([]);
    expect(result.groups.map((g) => g.length)).toEqual(computeGroupSizes(12));
    expect(buildGrouping(buildFeatureVectors(users)).groups).toEqual(result.groups);
  });

  it("退化：只有 1 人有标签（idf 退化为 0）不报错，等价于无信号", () => {
    const users = [student(1, ["摄影"]), ...Array.from({ length: 9 }, (_, k) => student(k + 2, []))];
    const result = buildGrouping(buildFeatureVectors(users));
    expect(result.metrics.coveredCount).toBe(1);
    expect(result.metrics.overall).toBe(0); // 单人无配对，且该源未达「≥2 人有值」的门槛
    expect(result.groups.flat().length).toBe(10);
  });

  it("退化：全班标签完全相同 → 相似度为 1（平滑 IDF 不塌缩），不报错", () => {
    const users = Array.from({ length: 10 }, (_, k) => student(k + 1, ["摄影", "阅读"]));
    const result = buildGrouping(buildFeatureVectors(users));
    // 人人相同 → 每人彼此都最高相似；这正是「同质」目标下应有的结果
    expect(result.metrics.cohesion.every((c) => c !== null && Math.abs(c - 1) < 1e-9)).toBe(true);
    // 人人彼此相似度为 1 → 整体目标值 = Σ 组内对数（跨组的不计入）
    const expectedPairs = computeGroupSizes(10).reduce((sum, s) => sum + (s * (s - 1)) / 2, 0);
    expect(result.metrics.overall).toBeCloseTo(expectedPairs, 9);
    expect(result.groups.flat().length).toBe(10);
  });

  it("指标：覆盖率与共同标签对数如实反映信号强弱", () => {
    const users = [
      student(1, ["摄影"]),
      student(2, ["摄影"]),
      student(3, ["阅读"]),
      student(4, []),
    ];
    const result = buildGrouping(buildFeatureVectors(users));
    expect(result.metrics.studentCount).toBe(4);
    expect(result.metrics.coveredCount).toBe(3);
    expect(result.metrics.activeSourceKeys).toEqual(["tags"]);
    // 6 对里只有「1 与 2」（标签相同）是非零相似
    expect(result.metrics.totalPairs).toBe(6);
    expect(result.metrics.nonZeroPairs).toBe(1);
  });

  it("组内聚度：与组内两两相似度一致；单组时记 null", () => {
    const users = [student(1, ["摄影", "旅行"]), student(2, ["摄影", "旅行"])];
    const result = buildGrouping(buildFeatureVectors(users));
    expect(result.groups.length).toBe(1);
    expect(result.metrics.cohesion[0]).toBeCloseTo(1, 6); // 标签完全相同 → 余弦 1
    const single = buildGrouping(buildFeatureVectors([student(1, ["摄影"])]));
    expect(single.metrics.cohesion[0]).toBeNull();
  });
});

describe("特征源可扩展性（#101 §九）", () => {
  const users = [
    student(1, ["摄影"], 10),
    student(2, ["摄影"], 90),
    student(3, ["阅读"], 20),
    student(4, ["阅读"], 80),
    student(5, ["音乐"], 50),
    student(6, ["音乐"], 50),
  ];

  it("显式传入与默认注册表相同的源列表 → 结果逐位相同", () => {
    const viaDefault = buildGrouping(buildFeatureVectors(users));
    const viaExplicit = buildGrouping(buildFeatureVectors(users, [TAGS_SOURCE]), [TAGS_SOURCE]);
    expect(viaExplicit.groups).toEqual(viaDefault.groups);
    expect(viaExplicit.metrics).toEqual(viaDefault.metrics);
  });

  it("注入 weight=0 的第二源 → 结果与单源完全一致（权重真在起作用，不是装饰）", () => {
    const single = buildGrouping(buildFeatureVectors(users));
    const withZeroWeight = buildGrouping(buildFeatureVectors(users, [TAGS_SOURCE, numericSource(0)]), [
      TAGS_SOURCE,
      numericSource(0),
    ]);
    expect(withZeroWeight.groups).toEqual(single.groups);
    expect(withZeroWeight.metrics.overall).toBeCloseTo(single.metrics.overall, 10);
  });

  it("注入 weight>0 的第二源 → 相似度被加权组合（多源真的参与）", () => {
    const sources = [TAGS_SOURCE, numericSource(1)];
    const vectors = buildFeatureVectors(users, sources);
    const single = computeSimilarities(buildFeatureVectors(users), [TAGS_SOURCE]);

    // 1 号与 2 号标签相同但得分相差极大：单源下相似度为 1，多源加权后必须小于 1
    expect(single[0][1]).toBeCloseTo(1, 6);
    const combined = computeSimilarities(vectors, sources);
    expect(combined[0][1]).toBeLessThan(single[0][1]);
    expect(combined[0][1]).toBeGreaterThan(0);

    const result = buildGrouping(vectors, sources);
    expect(result.metrics.activeSourceKeys.sort()).toEqual(["score", "tags"]);
    // 源描述会写进批次头，新增源不改表结构
    const described = JSON.parse(describeSources(sources)) as { key: string; kind: string; weight: number }[];
    expect(described.map((d) => d.key)).toEqual(["tags", "score"]);
    expect(described[1]).toMatchObject({ kind: "numeric", weight: 1 });
  });

  it("第二源没有数据时被跳过（不会稀释单源相似度）", () => {
    const noScore = users.map((u) => {
      const copy = { ...u } as UserRow & { score?: number };
      delete copy.score;
      return copy;
    });
    const sources = [TAGS_SOURCE, numericSource(1)];
    const withEmpty = buildGrouping(buildFeatureVectors(noScore, sources), sources);
    const single = buildGrouping(buildFeatureVectors(noScore), [TAGS_SOURCE]);
    expect(withEmpty.metrics.activeSourceKeys).toEqual(["tags"]);
    expect(withEmpty.groups).toEqual(single.groups);
  });
});
