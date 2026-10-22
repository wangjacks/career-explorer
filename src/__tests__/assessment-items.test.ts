import { describe, it, expect } from "vitest";
import {
  NEAR_DUPLICATE_GROUPS,
  NEAR_DUPLICATE_THRESHOLD,
  PROMPT_MAX_HAN,
  PROMPT_MIN_HAN,
  RIASEC_ASSESSMENT,
  RIASEC_CODE,
  RIASEC_DIMENSIONS,
  RIASEC_QUESTIONS,
  RETIRED_QUESTIONS,
  SAMPLING_EXCLUDED_ORIGINS,
  SAMPLING_RETIRED_INDEXES,
  normalizePrompt,
  promptHanLength,
  promptSimilarity,
  validateAssessmentSeed,
  validateRetirementLedger,
  type QuestionSeed,
  type RetiredQuestion,
} from "../lib/assessment-data";
import { ONET_OCCUPATIONS } from "../lib/onet-data";
import { onetInterestCodeOf } from "../lib/onet";

/**
 * 题库数据本身的验收（#281）：120 题的结构、来源分布、题面质量与「已授权题面一字不改」快照。
 * 校验逻辑（`validateAssessmentSeed`）另有反例单测在 `assessment-db.test.ts`，这里只断言真实题库能通过。
 */

const DIMENSION_KEYS = RIASEC_DIMENSIONS.map((dimension) => dimension.key);
const BANK_SIZE = RIASEC_QUESTIONS.length;
const PER_DIMENSION = BANK_SIZE / DIMENSION_KEYS.length;

/** 题号 1–30 的题面快照：Mini-IP 已授权材料，**任何改动都是授权事故**，这里逐题锁死 */
const MINI_SNAPSHOT: [number, string, string][] = [
  [1, "R", "动手制作厨房橱柜"],
  [2, "I", "研发一种新药"],
  [3, "A", "写书或写剧本"],
  [4, "S", "帮助别人解决个人或情绪上的困扰"],
  [5, "E", "管理大公司里的一个部门"],
  [6, "C", "在单位的大规模网络中为多台电脑安装软件"],
  [7, "R", "修理家用电器"],
  [8, "I", "研究减少水污染的方法"],
  [9, "A", "作曲或编曲"],
  [10, "S", "给别人做职业发展方面的指导"],
  [11, "E", "自己创业、开办一家公司"],
  [12, "C", "用计算器进行运算"],
  [13, "R", "组装电子元件"],
  [14, "I", "做化学实验"],
  [15, "A", "为电影制作特效"],
  [16, "S", "为病人做康复治疗"],
  [17, "E", "进行商业合同的谈判"],
  [18, "C", "记录货物的收货与发货情况"],
  [19, "R", "开卡车把包裹送到办公楼和住户家中"],
  [20, "I", "用显微镜检查血液样本"],
  [21, "A", "为舞台剧绘制布景"],
  [22, "S", "在非营利组织做志愿服务"],
  [23, "E", "为新款服装做营销推广"],
  [24, "C", "用手持设备盘点库存"],
  [25, "R", "在发货前检验零件质量"],
  [26, "I", "研究更准确地预报天气的方法"],
  [27, "A", "为电影或电视剧写剧本"],
  [28, "S", "给高中生上课"],
  [29, "E", "在百货商场销售商品"],
  [30, "C", "为单位盖章、分拣并分发邮件"],
];

/** 收入 / 学历 / 地位线索：与命题规则同一口径（测试独立实现，不复用私有常量） */
const FORBIDDEN_PROMPT_PATTERNS: readonly RegExp[] = [
  /\d+\s*元/,
  /薪资|薪水|薪酬|月薪|年薪|待遇|报酬/,
  /学历|文凭|学位|本科|硕士|博士/,
];

describe("题库结构与来源分布（#281）", () => {
  it("120 题、题号 1–120 连续、每维 20 题", () => {
    expect(BANK_SIZE).toBe(120);
    expect(PER_DIMENSION).toBe(20);
    expect(RIASEC_QUESTIONS.map((question) => question.index)).toEqual(
      Array.from({ length: BANK_SIZE }, (_, i) => i + 1)
    );
    for (const key of DIMENSION_KEYS) {
      expect(RIASEC_QUESTIONS.filter((question) => question.dimension === key)).toHaveLength(PER_DIMENSION);
    }
  });

  it("origin 分布：官方 Mini-IP 30 / 官方 SF 30 / 原创 60，且题号区间与来源一一对应", () => {
    const count = (origin: QuestionSeed["origin"]) =>
      RIASEC_QUESTIONS.filter((question) => question.origin === origin).length;
    expect(count("onet-mini")).toBe(30);
    expect(count("onet-sf")).toBe(30);
    expect(count("cn-original")).toBe(60);
    for (const question of RIASEC_QUESTIONS) {
      const expected =
        question.index <= 30 ? "onet-mini" : question.index <= 60 ? "onet-sf" : "cn-original";
      expect(question.origin).toBe(expected);
    }
    // 每维官方 10 题（mini 5 + sf 5）+ 原创 10 题：分层抽样的可行性前提
    for (const key of DIMENSION_KEYS) {
      const list = RIASEC_QUESTIONS.filter((question) => question.dimension === key);
      expect(list.filter((question) => question.origin !== "cn-original")).toHaveLength(10);
      expect(list.filter((question) => question.origin === "cn-original")).toHaveLength(10);
    }
  });

  it("本量表没有反向计分题，且每题都有英文原文（原创题为译注）", () => {
    for (const question of RIASEC_QUESTIONS) {
      expect(question.reverseScored).toBe(false);
      expect(question.source.trim().length).toBeGreaterThan(0);
      expect(question.source).toMatch(/[A-Za-z]/);
    }
  });

  it("只有原创题带 anchor（锚定职业只留种子、不入库）", () => {
    for (const question of RIASEC_QUESTIONS) {
      if (question.origin === "cn-original") {
        expect(question.anchor?.trim().length ?? 0).toBeGreaterThan(0);
      } else {
        expect(question.anchor).toBeUndefined();
      }
    }
  });
});

describe("题面质量（#281 命题规则）", () => {
  it("题干归一化后全局唯一", () => {
    const seen = new Map<string, number>();
    for (const question of RIASEC_QUESTIONS) {
      const normalized = normalizePrompt(question.prompt);
      expect(normalized.length).toBeGreaterThan(0);
      expect(seen.has(normalized), `第 ${question.index} 题与第 ${seen.get(normalized)} 题题面重复`).toBe(false);
      seen.set(normalized, question.index);
    }
  });

  it("题干汉字数在 4–24 之间", () => {
    for (const question of RIASEC_QUESTIONS) {
      const length = promptHanLength(question.prompt);
      expect(length, `第 ${question.index} 题（${question.prompt}）`).toBeGreaterThanOrEqual(PROMPT_MIN_HAN);
      expect(length, `第 ${question.index} 题（${question.prompt}）`).toBeLessThanOrEqual(PROMPT_MAX_HAN);
    }
  });

  it("题干不含收入 / 学历 / 地位线索", () => {
    for (const question of RIASEC_QUESTIONS) {
      for (const pattern of FORBIDDEN_PROMPT_PATTERNS) {
        expect(pattern.test(question.prompt), `第 ${question.index} 题含禁词：${question.prompt}`).toBe(false);
      }
    }
  });

  it("同维度相似度 ≥ 阈值 的题对都被近重复组覆盖", () => {
    const covered = new Set<string>();
    for (const group of NEAR_DUPLICATE_GROUPS) {
      for (let i = 0; i < group.length; i += 1) {
        for (let j = i + 1; j < group.length; j += 1) {
          covered.add(`${Math.min(group[i], group[j])}:${Math.max(group[i], group[j])}`);
        }
      }
    }
    const uncovered: string[] = [];
    for (const key of DIMENSION_KEYS) {
      const list = RIASEC_QUESTIONS.filter((question) => question.dimension === key);
      for (let i = 0; i < list.length; i += 1) {
        for (let j = i + 1; j < list.length; j += 1) {
          const similarity = promptSimilarity(list[i].prompt, list[j].prompt);
          if (similarity < NEAR_DUPLICATE_THRESHOLD) continue;
          const pair = `${Math.min(list[i].index, list[j].index)}:${Math.max(list[i].index, list[j].index)}`;
          if (!covered.has(pair)) uncovered.push(`${pair}（相似度 ${similarity.toFixed(2)}）`);
        }
      }
    }
    expect(uncovered).toEqual([]);
  });

  it("近重复组常量本身有效：题号存在、组内同维度、至少两题", () => {
    for (const group of NEAR_DUPLICATE_GROUPS) {
      expect(group.length).toBeGreaterThanOrEqual(2);
      const dimensions = new Set(
        group.map((index) => {
          const question = RIASEC_QUESTIONS.find((item) => item.index === index);
          expect(question, `近重复组包含不存在的题号 ${index}`).toBeDefined();
          return question!.dimension;
        })
      );
      expect(dimensions.size).toBe(1);
    }
  });
});

describe("原创题锚定职业（#281 效度规则）", () => {
  it("60 道原创题的 anchor 全部命中本地 O*NET 快照", () => {
    const titles = new Set(ONET_OCCUPATIONS.map((tuple) => tuple[1]));
    const originals = RIASEC_QUESTIONS.filter((question) => question.origin === "cn-original");
    expect(originals).toHaveLength(60);
    for (const question of originals) {
      expect(titles.has(question.anchor!), `第 ${question.index} 题的锚定职业不存在：${question.anchor}`).toBe(true);
    }
  });

  it("原创题维度落在锚定职业官方兴趣高码的前两位", () => {
    for (const question of RIASEC_QUESTIONS.filter((item) => item.origin === "cn-original")) {
      const code = onetInterestCodeOf(question.anchor!);
      expect(code, `第 ${question.index} 题锚定职业无兴趣高码`).toBeTruthy();
      expect(code!.slice(0, 2), `第 ${question.index} 题（${question.prompt}）维度 ${question.dimension}`).toContain(
        question.dimension
      );
    }
  });
});

describe("已授权题面快照（题号 1–30 一字不改）", () => {
  it("题号、维度、题干与 Mini-IP 快照逐题一致", () => {
    for (const [index, dimension, prompt] of MINI_SNAPSHOT) {
      const question = RIASEC_QUESTIONS.find((item) => item.index === index);
      expect(question, `缺少第 ${index} 题`).toBeDefined();
      expect(question!.dimension).toBe(dimension);
      expect(question!.prompt).toBe(prompt);
      expect(question!.origin).toBe("onet-mini");
    }
  });
});

describe("量表定义与校验入口", () => {
  it("定义与题库自洽：120 题、版本 RIASEC-CN 2.0、授权补齐 SF 与原创题声明", () => {
    expect(RIASEC_ASSESSMENT.code).toBe(RIASEC_CODE);
    expect(RIASEC_ASSESSMENT.questionCount).toBe(BANK_SIZE);
    expect(RIASEC_ASSESSMENT.scaleVersion).toBe("RIASEC-CN 2.0");
    expect(RIASEC_ASSESSMENT.name).toBe("霍兰德职业兴趣测评（120 题库）");
    expect(RIASEC_ASSESSMENT.attribution).toContain("O*NET");
    expect(RIASEC_ASSESSMENT.attribution).toContain("U.S. Department of Labor");
    expect(RIASEC_ASSESSMENT.licenseText).toContain("USDOL/ETA 未对这些修改进行审核");
    expect(RIASEC_ASSESSMENT.licenseText).toContain("31–60 题同样出自");
    expect(RIASEC_ASSESSMENT.licenseText).toContain("61–120 题为本项目原创");
    expect(RIASEC_ASSESSMENT.licenseText).toContain("CC BY 4.0");
    // 专家评审与班级试测是 #284 的上线判据，尚未发生：文案只能写「须完成」，并说明原创题当前不参与抽题
    expect(RIASEC_ASSESSMENT.licenseText).toContain("正式启用前须完成专家评审与一个班级的试测");
    expect(RIASEC_ASSESSMENT.licenseText).toContain("在完成上述验证前，61–120 题不参与抽题");
    expect(RIASEC_ASSESSMENT.licenseText).not.toMatch(/已完成[^\n]{0,12}试测/);
    expect(RIASEC_ASSESSMENT.disclaimer.length).toBeGreaterThan(0);
  });

  it("真实题库能通过完整校验（含 anchor 查询），且不传查询函数也能过结构校验", () => {
    expect(() => validateAssessmentSeed(RIASEC_ASSESSMENT, RIASEC_QUESTIONS, onetInterestCodeOf)).not.toThrow();
    expect(() => validateAssessmentSeed(RIASEC_ASSESSMENT, RIASEC_QUESTIONS)).not.toThrow();
  });

  it("放行门（#284）：原创题整批排除在抽题池外，题库与种子校验不受影响", () => {
    expect([...SAMPLING_EXCLUDED_ORIGINS]).toEqual(["cn-original"]);
    const eligible = RIASEC_QUESTIONS.filter((question) => !SAMPLING_EXCLUDED_ORIGINS.has(question.origin));
    expect(eligible).toHaveLength(60);
    for (const key of DIMENSION_KEYS) {
      expect(
        eligible.filter((question) => question.dimension === key),
        `维度 ${key} 的已放行题数`
      ).toHaveLength(10);
    }
  });

  it("每次作答题数（#282）：30 题且能被 6 个维度整除，每维正好 5 题", () => {
    expect(RIASEC_ASSESSMENT.itemsPerAttempt).toBe(30);
    expect(RIASEC_ASSESSMENT.itemsPerAttempt % RIASEC_DIMENSIONS.length).toBe(0);
    expect(RIASEC_ASSESSMENT.itemsPerAttempt).toBeLessThan(BANK_SIZE);
  });

  it("itemsPerAttempt 校验（#282 规则 8）：负数、非整数、不能整除维度数都要拦下", () => {
    const invalid = [
      [-1, /不能为负/],
      [13, /必须能被维度数/],
      [7.5, /必须能被维度数/],
      [BANK_SIZE + 6, /不能超过题库总量/],
    ] as const;
    for (const [itemsPerAttempt, pattern] of invalid) {
      expect(() =>
        validateAssessmentSeed({ ...RIASEC_ASSESSMENT, itemsPerAttempt }, RIASEC_QUESTIONS)
      ).toThrowError(pattern);
    }
    // 0 是合法取值：语义为「全量作答（题库即本轮）」，旧量表定义不改这一列就能继续用
    expect(() =>
      validateAssessmentSeed({ ...RIASEC_ASSESSMENT, itemsPerAttempt: 0 }, RIASEC_QUESTIONS)
    ).not.toThrow();
    expect(() =>
      validateAssessmentSeed({ ...RIASEC_ASSESSMENT, itemsPerAttempt: 60 }, RIASEC_QUESTIONS)
    ).not.toThrow();
  });
});

describe("退役台账与在用题目（#285）", () => {
  /** 合成台账的最小题库：1 → 2 是合法换题（同维、候补题号更大、同近重复组、候补为原创题） */
  const questions: QuestionSeed[] = [
    { index: 1, dimension: "R", origin: "onet-mini", reverseScored: false, prompt: "旧题", source: "old" },
    { index: 2, dimension: "R", origin: "cn-original", reverseScored: false, prompt: "候补题", source: "new", anchor: "统计师" },
    { index: 3, dimension: "R", origin: "onet-sf", reverseScored: false, prompt: "官方题", source: "official" },
    { index: 4, dimension: "I", origin: "cn-original", reverseScored: false, prompt: "别维题", source: "other", anchor: "统计师" },
  ];
  const groups = [[1, 2]];
  const valid: RetiredQuestion = {
    index: 1,
    replacementIndex: 2,
    reason: "r_it = 0.12（n = 63），区分度不足",
    decidedAt: "2026-10-21",
  };

  it("当前台账为空：没有凭演示数据或主观印象填写的退役题", () => {
    expect(SAMPLING_RETIRED_INDEXES.size).toBe(RETIRED_QUESTIONS.length);
    for (const entry of RETIRED_QUESTIONS) {
      expect(SAMPLING_RETIRED_INDEXES.has(entry.index)).toBe(true);
    }
  });

  it("合法台账通过：旧题停用、候补题同维同组、依据与日期齐全", () => {
    expect(() => validateRetirementLedger(questions, [valid], groups)).not.toThrow();
    expect(() => validateRetirementLedger(questions, [], groups)).not.toThrow();
  });

  it("台账引用不存在的题号直接报错", () => {
    expect(() => validateRetirementLedger(questions, [{ ...valid, index: 99 }], groups)).toThrowError(
      /不存在的旧题号/
    );
    expect(() =>
      validateRetirementLedger(questions, [{ ...valid, replacementIndex: 99 }], groups)
    ).toThrowError(/不存在的候补题号/);
  });

  it("候补题必须同维度、来源为原创题、题号更大", () => {
    expect(() =>
      validateRetirementLedger(questions, [{ ...valid, replacementIndex: 4 }], groups)
    ).toThrowError(/必须同维度/);
    expect(() =>
      validateRetirementLedger(questions, [{ ...valid, replacementIndex: 3 }], [[1, 3]])
    ).toThrowError(/必须标注为 cn-original/);
    expect(() =>
      validateRetirementLedger(questions, [{ ...valid, index: 2, replacementIndex: 1 }], [[1, 2]])
    ).toThrowError(/必须大于旧题号/);
  });

  it("旧题不能登记两次，候补题不能承接两条退役", () => {
    expect(() =>
      validateRetirementLedger(questions, [valid, { ...valid, replacementIndex: 3 }], [[1, 2, 3]])
    ).toThrowError(/重复登记旧题号/);
    expect(() =>
      validateRetirementLedger(
        questions,
        [valid, { ...valid, index: 3, replacementIndex: 2 }],
        [[1, 2, 3]]
      )
    ).toThrowError(/候补题号被重复使用/);
  });

  it("淘汰依据与决策日期不能空，日期必须是 YYYY-MM-DD", () => {
    expect(() => validateRetirementLedger(questions, [{ ...valid, reason: "  " }], groups)).toThrowError(
      /缺少淘汰依据/
    );
    expect(() =>
      validateRetirementLedger(questions, [{ ...valid, decidedAt: "2026/10/21" }], groups)
    ).toThrowError(/YYYY-MM-DD/);
  });

  it("旧题与候补题必须同属一个近重复组（同卷至多一题的第二道保险）", () => {
    expect(() => validateRetirementLedger(questions, [valid], [[1], [2]])).toThrowError(
      /同一个 NEAR_DUPLICATE_GROUPS 组/
    );
  });
});

describe("种子校验按在用题数计算（#285）", () => {
  /** 给真实题库加一道候选原创题：R 维 21 题，退役 1 道 R 题后 6 维恢复各 20 题 */
  const candidate: QuestionSeed = {
    index: RIASEC_QUESTIONS.length + 1,
    dimension: "R",
    origin: "cn-original",
    reverseScored: false,
    prompt: "校准候补题目样张",
    source: "calibration candidate",
    anchor: "统计师",
  };
  const extended = [...RIASEC_QUESTIONS, candidate];
  const definition = { ...RIASEC_ASSESSMENT, questionCount: extended.length };

  it("候补题未退役旧题时题数不均衡，校验应拦下", () => {
    expect(() => validateAssessmentSeed(definition, extended)).toThrowError(/在用题数不相等/);
  });

  it("退役同一维旧题后按在用题数校验通过：题库不删题、题数声明仍与全量一致", () => {
    expect(() =>
      validateAssessmentSeed(definition, extended, undefined, new Set([1]))
    ).not.toThrow();
    expect(extended).toHaveLength(121);
    expect(definition.questionCount).toBe(121);
  });

  it("某维全部退役时明确报「没有在用题目」，而不是静默算成 0 题", () => {
    const all = new Set(RIASEC_QUESTIONS.map((question) => question.index));
    expect(() => validateAssessmentSeed(RIASEC_ASSESSMENT, RIASEC_QUESTIONS, undefined, all)).toThrowError(
      /没有在用题目/
    );
  });

  it("在用官方题不足 3 道时，规则 3 仍然生效", () => {
    const rOfficial = RIASEC_QUESTIONS.filter(
      (question) => question.dimension === "R" && question.origin !== "cn-original"
    )
      .slice(0, 8)
      .map((question) => question.index);
    expect(() =>
      validateAssessmentSeed(RIASEC_ASSESSMENT, RIASEC_QUESTIONS, undefined, new Set(rOfficial))
    ).toThrowError(/官方题不足/);
  });
});
