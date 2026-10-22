/**
 * O*NET 职业库（#226）：数据快照的元信息、离线导入种子与展示口径。
 *
 * - 数据快照本身在 `onet-data.ts`（由 `scripts/import-onet.mjs` 从 O*NET 30.2 发布包生成）；
 * - 中文译名在 `onet-name-zh.ts`（人工维护，重新生成快照不会覆盖它）；
 * - 本文件负责把它们合成「一行职业」的种子（`OnetOccupationSeed`），供两适配器在 init 时
 *   幂等灌进 `onet_occupations` 表，并在版本变化时整表重灌。
 *
 * 授权：O*NET 数据库按 **CC BY 4.0** 使用，必须署名（见 `ONET_ATTRIBUTION`，推荐接口会随响应下发）。
 */

import {
  ONET_DATASET_TITLE,
  ONET_DATASET_URL,
  ONET_DATASET_VERSION,
  ONET_LICENSE_URL,
  ONET_OCCUPATIONS,
  type OnetOccupationTuple,
} from "./onet-data";
import { ONET_NAME_ZH } from "./onet-name-zh";
import type { CareerCandidate, RiasecVector } from "./assessment-match";
import { parseRiasecVector } from "./assessment-match";

/**
 * 种子标记：写在 `configs_profile` 的配置键。
 * 初始化时「标记 + 行数」与当前快照一致就跳过；否则（首次安装 / 升级到新快照）整表重灌。
 */
export const ONET_SEED_MARKER_KEY = "onet_seeded_version";

/** CC BY 4.0 要求的署名文本，随推荐接口一起下发，前端负责展示 */
export const ONET_ATTRIBUTION =
  `${ONET_DATASET_TITLE}（美国劳工部就业与培训署），依据 CC BY 4.0 使用。` +
  `职业兴趣分由 O*NET 数据库 Interests 表离线导入，本系统未改动原始数据。` +
  `数据来源：${ONET_DATASET_URL} ；授权说明：${ONET_LICENSE_URL}`;

/**
 * 所属职业群：O*NET-SOC Code 前两位是 SOC 大类（2018 版 SOC 的 23 个大类）。
 * 不额外引入外部映射表，改由 code 推导，数据快照更新也不用跟着维护。
 */
export const SOC_MAJOR_GROUPS: Readonly<Record<string, string>> = {
  "11": "管理",
  "13": "商业与金融",
  "15": "计算机与数学",
  "17": "建筑与工程",
  "19": "生命、物理与社会科学",
  "21": "社区与社会服务",
  "23": "法律",
  "25": "教育培训与图书馆",
  "27": "艺术、设计、娱乐、体育与媒体",
  "29": "医疗健康",
  "31": "医疗支持",
  "33": "保护性服务",
  "35": "餐饮服务",
  "37": "建筑与场地清洁维护",
  "39": "个人护理与服务",
  "41": "销售",
  "43": "办公与行政支持",
  "45": "农林牧渔",
  "47": "建筑与开采",
  "49": "安装、维护与维修",
  "51": "生产制造",
  "53": "运输与物料搬运",
  "55": "军事",
};

/** SOC 大类缺失时的兜底分组 */
export const SOC_MAJOR_GROUP_FALLBACK = "其他职业";

/**
 * Job Zone → 常见学历要求。当前 O*NET 发布版的编号是 **2–5**（官方把原 1–2 级合并成
 * 「Job Zone 1-2: Very Little to Some Preparation」，对应数值 2），数据里没有 1；
 * key 1 保留只为兼容旧快照，含义取原「几乎无需准备」。
 * 2 少量准备 / 3 中等准备（职业培训或大专）/ 4 大量准备（本科）/ 5 充分准备（研究生）。
 */
export const JOB_ZONE_EDUCATION: Readonly<Record<number, string>> = {
  1: "高中以下",
  2: "高中或职高",
  3: "大专或职业培训",
  4: "本科",
  5: "研究生",
};

/** Job Zone 缺失时的兜底学历说明 */
export const JOB_ZONE_EDUCATION_FALLBACK = "学历要求未标注";

/** 一行职业种子（与 `onet_occupations` 表列一一对应，scores 落库为 JSON） */
export interface OnetOccupationSeed extends CareerCandidate {
  /** 数据快照版本，便于排查「库里的数据是哪一版」 */
  datasetVersion: string;
}

/** 由 SOC code 取所属职业群（中文） */
export function socMajorGroupOf(code: string): string {
  return SOC_MAJOR_GROUPS[code.slice(0, 2)] ?? SOC_MAJOR_GROUP_FALLBACK;
}

/**
 * 是否需要重灌 `onet_occupations`：`configs_profile` 里的快照版本标记与行数都与当前快照一致时跳过。
 * 纯函数便于单测；两适配器共用同一判据，行为不会分叉。
 */
export function needsOnetReseed(marker: string | undefined, rowCount: number, seedCount: number): boolean {
  return marker !== ONET_DATASET_VERSION || rowCount !== seedCount;
}

/** Job Zone → 常见学历要求（中文）；非法值走兜底文案 */
export function educationForJobZone(jobZone: number | null | undefined): string {
  return (jobZone != null && JOB_ZONE_EDUCATION[jobZone]) || JOB_ZONE_EDUCATION_FALLBACK;
}

/** 职业名 → 官方兴趣高码的索引（懒建一次，避免每次校验都线性扫 923 条快照） */
let onetInterestIndex: Map<string, string> | null = null;

/**
 * 职业名 → 官方兴趣高码（#281 原创题的 anchor 效度校验用）。
 *
 * 查的是**静态快照** `onet-data.ts` 而不是数据库里的 `onet_occupations`：种子校验发生在
 * `init()` 的早期阶段，且校验结果不应随「职业库是否灌成功」而改变。
 */
export function onetInterestCodeOf(occupationTitle: string): string | undefined {
  const title = occupationTitle.trim();
  if (!title) return undefined;
  if (!onetInterestIndex) {
    onetInterestIndex = new Map(ONET_OCCUPATIONS.map((tuple) => [tuple[1], tuple[2]]));
  }
  return onetInterestIndex.get(title);
}


function scoresOf(tuple: OnetOccupationTuple): RiasecVector {
  const [, , , realistic, investigative, artistic, social, enterprising, conventional] = tuple;
  return { R: realistic, I: investigative, A: artistic, S: social, E: enterprising, C: conventional };
}

/**
 * 数据快照 → 种子行。纯函数（不含 I/O），单测可直接校验字段完整性；
 * 中文译名从 `ONET_NAME_ZH` 查，未覆盖的留 null（展示层回退英文名）。
 */
export function getOnetOccupationSeeds(): OnetOccupationSeed[] {
  return ONET_OCCUPATIONS.map((tuple) => {
    const [code, name, interestCode, , , , , , , jobZone] = tuple;
    return {
      code,
      name,
      nameZh: ONET_NAME_ZH[code] ?? null,
      interestCode,
      scores: scoresOf(tuple),
      jobZone,
      educationLevel: educationForJobZone(jobZone),
      cluster: socMajorGroupOf(code),
      datasetVersion: ONET_DATASET_VERSION,
    };
  });
}

/** 快照元信息（供接口/文档下发，避免各处硬编码版本号） */
export function onetDatasetInfo() {
  return {
    version: ONET_DATASET_VERSION,
    title: ONET_DATASET_TITLE,
    sourceUrl: ONET_DATASET_URL,
    licenseUrl: ONET_LICENSE_URL,
    occupationCount: ONET_OCCUPATIONS.length,
    attribution: ONET_ATTRIBUTION,
    /** 首批中文译名覆盖数（其余职业保留英文名） */
    translatedCount: ONET_OCCUPATIONS.filter((tuple) => ONET_NAME_ZH[tuple[0]]).length,
  };
}

/** `onet_occupations` 行的结构子集：只取匹配需要的字段，避免本文件依赖数据层类型 */
export interface OnetOccupationCandidateRow {
  code: string;
  name: string;
  name_zh: string | null;
  interest_code: string;
  interests_json: string;
  job_zone: number;
  education_level: string;
  cluster: string;
}

/**
 * 数据库行 → 匹配引擎的候选职业（#233 教师导出复用同一份转换，避免两处各写一遍）。
 * `interests_json` 解析失败时按零向量处理（匹配引擎会给出 0 相似度，不会抛错污染整批导出）。
 */
export function toCareerCandidates(rows: readonly OnetOccupationCandidateRow[]): CareerCandidate[] {
  return rows.map((row) => ({
    code: row.code,
    name: row.name,
    nameZh: row.name_zh,
    interestCode: row.interest_code,
    scores: parseRiasecVector(row.interests_json),
    jobZone: row.job_zone,
    educationLevel: row.education_level,
    cluster: row.cluster,
  }));
}
