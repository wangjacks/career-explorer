import { describe, it, expect } from "vitest";
import {
  ONET_DATASET_TITLE,
  ONET_DATASET_URL,
  ONET_DATASET_VERSION,
  ONET_LICENSE_URL,
  ONET_OCCUPATIONS,
} from "../lib/onet-data";
import { ONET_NAME_ZH } from "../lib/onet-name-zh";
import {
  JOB_ZONE_EDUCATION,
  ONET_ATTRIBUTION,
  ONET_SEED_MARKER_KEY,
  SOC_MAJOR_GROUPS,
  educationForJobZone,
  getOnetOccupationSeeds,
  needsOnetReseed,
  onetDatasetInfo,
  socMajorGroupOf,
} from "../lib/onet";
import { RIASEC_KEYS } from "../lib/assessment-match";

describe("O*NET 数据快照完整性", () => {
  it("职业数量与 code 唯一性（30.2 共 923 个带六型分与 Job Zone 的职业）", () => {
    expect(ONET_OCCUPATIONS.length).toBe(923);
    const codes = ONET_OCCUPATIONS.map((tuple) => tuple[0]);
    expect(new Set(codes).size).toBe(codes.length);
  });

  it("code 都是 O*NET-SOC 格式，且按 code 升序（保证快照 diff 稳定）", () => {
    const codes = ONET_OCCUPATIONS.map((tuple) => tuple[0]);
    for (const code of codes) expect(code).toMatch(/^\d{2}-\d{4}\.\d{2}$/);
    expect(codes).toEqual([...codes].sort());
  });

  it("六型分都在 O*NET 1–7 量程内，标题非空", () => {
    for (const tuple of ONET_OCCUPATIONS) {
      const [code, title, , ...rest] = tuple;
      expect(title.trim(), `${code} 缺标题`).not.toBe("");
      const scores = rest.slice(0, 6);
      for (const score of scores) {
        expect(Number.isFinite(score), `${code} 分数非法`).toBe(true);
        expect(score, `${code} 分数越界`).toBeGreaterThanOrEqual(1);
        expect(score).toBeLessThanOrEqual(7);
      }
      const jobZone = tuple[9];
      expect(jobZone).toBeGreaterThanOrEqual(1);
      expect(jobZone).toBeLessThanOrEqual(5);
    }
  });

  it("官方兴趣高码：1–3 位 RIASEC 字母，首位必须是六型最高分维（并列时取 O*NET 官方排序）", () => {
    for (const tuple of ONET_OCCUPATIONS) {
      const [code, , interestCode, ...rest] = tuple;
      const scores = rest.slice(0, 6);
      expect(interestCode).toMatch(/^[RIASEC]{1,3}$/);
      expect(interestCode.length).toBeLessThanOrEqual(3);
      const max = Math.max(...scores);
      const firstScore = scores[RIASEC_KEYS.indexOf(interestCode[0] as never)];
      expect(firstScore, `${code} 高码首位与最高分不符`).toBe(max);
      // 高码内字母不重复
      expect(new Set(interestCode).size).toBe(interestCode.length);
    }
  });

  it("快照元信息与授权文案（CC BY 4.0 要求可查）", () => {
    expect(ONET_DATASET_VERSION).toBe("30.2");
    expect(ONET_DATASET_TITLE).toContain("O*NET");
    expect(ONET_DATASET_URL).toContain("onetcenter.org");
    expect(ONET_LICENSE_URL).toContain("license_db");
    expect(ONET_ATTRIBUTION).toContain("CC BY 4.0");
    expect(ONET_ATTRIBUTION).toContain("劳工部");
    expect(ONET_ATTRIBUTION).toContain("onetcenter.org/database.html");
  });
});

describe("种子合成（快照 + 中文译名 + 职业群 / 学历映射）", () => {
  const seeds = getOnetOccupationSeeds();

  it("每个职业都合成出完整种子行", () => {
    expect(seeds).toHaveLength(ONET_OCCUPATIONS.length);
    for (const seed of seeds) {
      expect(seed.code).toMatch(/^\d{2}-\d{4}\.\d{2}$/);
      expect(seed.name.trim()).not.toBe("");
      expect(RIASEC_KEYS.every((key) => typeof seed.scores[key] === "number")).toBe(true);
      expect(seed.jobZone).toBeGreaterThanOrEqual(1);
      expect(seed.jobZone).toBeLessThanOrEqual(5);
      expect(seed.datasetVersion).toBe(ONET_DATASET_VERSION);
      expect(seed.educationLevel).toBe(educationForJobZone(seed.jobZone));
      expect(seed.cluster).toBe(socMajorGroupOf(seed.code));
      expect(seed.cluster.trim()).not.toBe("");
    }
  });

  it("Job Zone 1–5 都有中文常见学历要求，非法值走兜底", () => {
    expect(JOB_ZONE_EDUCATION).toMatchObject({ 1: "高中以下", 2: "高中或职高", 3: "大专或职业培训", 4: "本科", 5: "研究生" });
    expect(educationForJobZone(9)).toBe("学历要求未标注");
    expect(educationForJobZone(null)).toBe("学历要求未标注");
  });

  it("职业群覆盖 SOC 大类（O*NET 不采集军事类 55），未知前缀走兜底", () => {
    expect(Object.keys(SOC_MAJOR_GROUPS)).toHaveLength(23);
    expect(socMajorGroupOf("15-1252.00")).toBe("计算机与数学");
    expect(socMajorGroupOf("99-9999.99")).toBe("其他职业");
    const used = new Set(seeds.map((seed) => seed.cluster));
    // O*NET-SOC 覆盖 22 个民用大类；55（军事）不在 O*NET 数据库里，映射表仍保留以便将来兼容
    expect(used.size).toBe(22);
    expect(used.has("军事")).toBe(false);
    for (const [prefix, group] of Object.entries(SOC_MAJOR_GROUPS)) {
      if (prefix === "55") continue;
      expect(used.has(group), `${prefix} ${group} 没有对应职业`).toBe(true);
    }
  });

  it("中文译名：首批覆盖 ≥150 个，键都在快照里、值非空", () => {
    const codes = new Set(seeds.map((seed) => seed.code));
    const entries = Object.entries(ONET_NAME_ZH);
    expect(entries.length).toBeGreaterThanOrEqual(150);
    for (const [code, name] of entries) {
      expect(codes.has(code), `译名映射里有快照中不存在的职业：${code}`).toBe(true);
      expect(name.trim()).not.toBe("");
    }
    expect(seeds.filter((seed) => seed.nameZh).length).toBe(entries.length);
  });

  it("首批译名覆盖六个兴趣类型，不是只挑了某一类", () => {
    const translated = seeds.filter((seed) => seed.nameZh);
    for (const key of RIASEC_KEYS) {
      expect(translated.some((seed) => seed.interestCode.includes(key)), `${key} 型没有译名覆盖`).toBe(true);
    }
  });

  it("数据集元信息与译名覆盖数一致", () => {
    const info = onetDatasetInfo();
    expect(info.version).toBe(ONET_DATASET_VERSION);
    expect(info.occupationCount).toBe(ONET_OCCUPATIONS.length);
    expect(info.translatedCount).toBe(Object.keys(ONET_NAME_ZH).length);
    expect(info.attribution).toBe(ONET_ATTRIBUTION);
  });
});

describe("needsOnetReseed（快照重灌判据）", () => {
  it("版本与行数都匹配时跳过", () => {
    expect(needsOnetReseed(ONET_DATASET_VERSION, 923, 923)).toBe(false);
  });

  it("版本不同、行数不同、或缺少标记时重灌", () => {
    expect(needsOnetReseed("29.3", 923, 923)).toBe(true);
    expect(needsOnetReseed(ONET_DATASET_VERSION, 0, 923)).toBe(true);
    expect(needsOnetReseed(undefined, 923, 923)).toBe(true);
  });

  it("种子标记键名稳定（升级判据依赖它）", () => {
    expect(ONET_SEED_MARKER_KEY).toBe("onet_seeded_version");
  });
});
