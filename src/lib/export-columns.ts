/**
 * 数据导出的列定义与取值格式化（#233）：纯函数，路由与测试共用同一套口径。
 *
 * 为什么单独一层：
 * - 列是**有序的**，而 xlsx 的内嵌图片锚点由列下标算出来（`columnLetter`）——列定义和图片列
 *   必须来自同一份来源，插列才不会让图片错位；把这份顺序放在纯函数里，可以用单测锁住。
 * - 「六型得分」有两种输出形态（合成一列 / 拆成六列），它们共用同一份分数取整口径。
 * - 默认列集合以 #233 的口径为基线；#162 新增三条他人评价列属于既有评价维度的替换，
 *   因此默认集合同时保留历史图片列并追加三条文字列，避免新数据导出缺失评价内容。
 *
 * 口径说明：六型得分取结果快照里的 0–100 标准分并**取整**（例：`R42 I38 A20 S74 E31 C25`），
 * 方便教师在 Excel 里直接排序/画图；四舍五入只影响展示，不影响任何计算。
 */

import { RIASEC_KEYS, type RiasecKey } from "./assessment-match";
import { buildBigFiveHeadline, type RiasecScoreSnapshot } from "./assessment-view";

/** 列所属的按钮分组（#233：自定义列按钮分两组） */
export type ExportColumnGroup = "base" | "assessment";

export const EXPORT_COLUMN_GROUPS: readonly { key: ExportColumnGroup; label: string }[] = [
  { key: "base", label: "基础信息" },
  { key: "assessment", label: "职业测评" },
];

export interface ExportColumnDef {
  key: string;
  group: ExportColumnGroup;
  /** 自定义列按钮上的名字 */
  label: string;
  /** CSV 表头（图片列在 CSV 里是 URL） */
  csvHeader: string;
  /** Excel 表头（图片列在 Excel 里是图片） */
  xlsxHeader: string;
  width: number;
  /** 该列属于「六型得分 → 拆成六列」子模式时的维度字母 */
  scoreKey?: RiasecKey;
}

/** 列的**权威顺序**：导出表的列顺序按这里排，与前端勾选顺序无关（表头与数据不会错位） */
export const EXPORT_COLUMNS: readonly ExportColumnDef[] = [
  { key: "class_name", group: "base", label: "班级", csvHeader: "班级", xlsxHeader: "班级", width: 18 },
  { key: "student_id", group: "base", label: "学号", csvHeader: "学号", xlsxHeader: "学号", width: 16 },
  { key: "name", group: "base", label: "姓名", csvHeader: "姓名", xlsxHeader: "姓名", width: 12 },
  { key: "tags", group: "base", label: "标签", csvHeader: "标签", xlsxHeader: "标签", width: 30 },
  { key: "avatar_url", group: "base", label: "学生头像", csvHeader: "学生头像URL", xlsxHeader: "学生头像", width: 35 },
  {
    key: "evaluation_url",
    group: "base",
    label: "评价词云图片（历史）",
    csvHeader: "评价词云图片URL（历史）",
    xlsxHeader: "评价词云图片（历史）",
    width: 35,
  },
  {
    key: "evaluation_text_1",
    group: "base",
    label: "他人评价1",
    csvHeader: "他人评价1",
    xlsxHeader: "他人评价1",
    width: 30,
  },
  {
    key: "evaluation_text_2",
    group: "base",
    label: "他人评价2",
    csvHeader: "他人评价2",
    xlsxHeader: "他人评价2",
    width: 30,
  },
  {
    key: "evaluation_text_3",
    group: "base",
    label: "他人评价3",
    csvHeader: "他人评价3",
    xlsxHeader: "他人评价3",
    width: 30,
  },
  { key: "avatar_link", group: "base", label: "头像 URL", csvHeader: "学生头像URL", xlsxHeader: "学生头像URL", width: 35 },
  {
    key: "evaluation_link",
    group: "base",
    label: "评价词云图片 URL（历史）",
    csvHeader: "评价词云图片URL（历史）",
    xlsxHeader: "评价词云图片URL（历史）",
    width: 35,
  },
  { key: "created_at", group: "base", label: "提交时间", csvHeader: "提交时间", xlsxHeader: "提交时间", width: 22 },
  {
    key: "assessment_status",
    group: "assessment",
    label: "测评状态",
    csvHeader: "测评状态",
    xlsxHeader: "测评状态",
    width: 10,
  },
  {
    key: "assessment_completed_at",
    group: "assessment",
    label: "测评完成时间",
    csvHeader: "测评完成时间",
    xlsxHeader: "测评完成时间",
    width: 22,
  },
  {
    key: "assessment_code",
    group: "assessment",
    label: "霍兰德三字码",
    csvHeader: "霍兰德三字码",
    xlsxHeader: "霍兰德三字码",
    width: 14,
  },
  {
    key: "assessment_scores",
    group: "assessment",
    label: "六型得分（合成一列）",
    csvHeader: "六型得分",
    xlsxHeader: "六型得分",
    width: 40,
  },
  ...RIASEC_KEYS.map(
    (key): ExportColumnDef => ({
      key: `score_${key}`,
      group: "assessment",
      label: `${key} 型得分`,
      csvHeader: `${key} 型得分`,
      xlsxHeader: `${key} 型得分`,
      width: 10,
      scoreKey: key,
    })
  ),
  {
    key: "careers",
    group: "assessment",
    label: "推荐职业 Top3",
    csvHeader: "推荐职业 Top3",
    xlsxHeader: "推荐职业 Top3",
    width: 40,
  },
  // #331：人格特质与大五得分**追加**在末尾，既有列顺序与图片列下标保持不变。
  // 不加入默认列集合（DEFAULT_EXPORT_COLUMN_KEYS），只有显式勾选才出现。
  {
    key: "personality_traits",
    group: "assessment",
    label: "人格特质（Top2 画像）",
    csvHeader: "人格特质",
    xlsxHeader: "人格特质",
    width: 24,
  },
  {
    key: "big_five_scores",
    group: "assessment",
    label: "大五得分（合成一列）",
    csvHeader: "大五得分",
    xlsxHeader: "大五得分",
    width: 40,
  },
];

/** 「六型得分 → 拆成六列」输出的列 key（顺序同 RIASEC） */
export const SCORE_COLUMN_KEYS: readonly string[] = RIASEC_KEYS.map((key) => `score_${key}`);

/** 默认勾选的列：#233 基线 + #162 的三条他人评价（历史图片列保留以兼容存量） */
export const DEFAULT_EXPORT_COLUMN_KEYS: readonly string[] = [
  "student_id",
  "name",
  "tags",
  "avatar_url",
  "evaluation_url",
  "evaluation_text_1",
  "evaluation_text_2",
  "evaluation_text_3",
  "created_at",
];

const COLUMN_BY_KEY = new Map(EXPORT_COLUMNS.map((column) => [column.key, column]));

/** 解析 `?columns=` 参数：按**列定义顺序**返回（未知 key 丢弃，重复去重） */
export function parseColumnKeys(raw: string | null | undefined): string[] {
  const selected = new Set((raw ?? "").split(",").map((key) => key.trim()).filter(Boolean));
  return EXPORT_COLUMNS.filter((column) => selected.has(column.key)).map((column) => column.key);
}

export function isAssessmentColumn(key: string): boolean {
  return COLUMN_BY_KEY.get(key)?.group === "assessment";
}

/** 人格测评列（#331）：大五结果，不参与霍兰德三字码/六型分的取数 */
const PERSONALITY_COLUMN_KEYS = new Set(["personality_traits", "big_five_scores"]);

export function isPersonalityColumn(key: string): boolean {
  return PERSONALITY_COLUMN_KEYS.has(key);
}

/** 霍兰德测评列：除人格列外的所有 assessment 组列（含状态/时间/三字码/六型分/推荐职业） */
export function isHollandAssessmentColumn(key: string): boolean {
  return isAssessmentColumn(key) && !isPersonalityColumn(key);
}

export function isImageColumn(key: string): boolean {
  return key === "avatar_url" || key === "evaluation_url";
}

/** 解析成 `{ key, header, width }`，表头按导出格式选择（图片列两种格式命名不同） */
export function resolveExportColumns(
  keys: readonly string[],
  format: "csv" | "xlsx"
): { key: string; header: string; width: number }[] {
  const selected = new Set(keys);
  return EXPORT_COLUMNS.filter((column) => selected.has(column.key)).map((column) => ({
    key: column.key,
    header: format === "csv" ? column.csvHeader : column.xlsxHeader,
    width: column.width,
  }));
}

/** 列下标（1 起）→ Excel 列字母：1 → A，27 → AA。图片锚点必须按**最终列下标**算 */
export function columnLetter(column: number): string {
  let result = "";
  let current = column;
  while (current > 0) {
    const remainder = (current - 1) % 26;
    result = String.fromCharCode(65 + remainder) + result;
    current = Math.floor((current - 1) / 26);
  }
  return result;
}

/** 图片列在最终列集里的 1 起下标；不在列集里返回 0（调用方据此跳过） */
export function imageColumnIndex(columns: readonly { key: string }[], key: string): number {
  return columns.findIndex((column) => column.key === key) + 1;
}

/** 班级 id → 班级名（不查库、内存关联即可，见 #233 实现要点） */
export function buildClassNameMap(classes: readonly { id: number; name: string }[]): Map<number, string> {
  return new Map(classes.map((klass) => [klass.id, klass.name]));
}

export function classNameOf(classId: number | null | undefined, names: Map<number, string>): string {
  if (classId == null) return "";
  return names.get(classId) ?? "";
}

/** 六型得分快照：合成一列 / 拆成六列共用同一份取整口径；解析失败按「无分数」处理 */
export interface SixScoreValues {
  hasScores: boolean;
  /** `R42 I38 A20 S74 E31 C25`；没有可用分数时为 "" */
  composite: string;
  /** 维度字母 → 整数分字符串；缺的维度为 ""（未测评学生整行留空，不填 0） */
  perDimension: Record<RiasecKey, string>;
}

const EMPTY_SIX_SCORES: SixScoreValues = {
  hasScores: false,
  composite: "",
  perDimension: { R: "", I: "", A: "", S: "", E: "", C: "" },
};

function toStandardScore(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  return Math.round(Math.min(100, Math.max(0, value)));
}

/**
 * `scores_json`（计分引擎输出的 `DimensionScore[]` 快照）→ 导出用分数。
 * 只认 RIASEC 六维；非法 JSON / 非数组 / 六维全缺 → 视为无分数（整列留空）。
 */
export function formatSixScores(scoresJson: string | null | undefined): SixScoreValues {
  if (!scoresJson) return EMPTY_SIX_SCORES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(scoresJson);
  } catch (err) {
    console.error("Failed to parse assessment scores for export:", err);
    return EMPTY_SIX_SCORES;
  }
  if (!Array.isArray(parsed)) return EMPTY_SIX_SCORES;

  const perDimension: Record<RiasecKey, string> = { R: "", I: "", A: "", S: "", E: "", C: "" };
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { key, standard } = entry as { key?: unknown; standard?: unknown };
    if (typeof key !== "string" || !(RIASEC_KEYS as readonly string[]).includes(key)) continue;
    const score = toStandardScore(standard);
    if (score === null) continue;
    perDimension[key as RiasecKey] = String(score);
  }

  const parts = RIASEC_KEYS.filter((key) => perDimension[key] !== "").map(
    (key) => `${key}${perDimension[key]}`
  );
  return {
    hasScores: parts.length > 0,
    composite: parts.join(" "),
    perDimension,
  };
}

/** 测评状态：只看「有没有当前有效的完成结果」，未开始/进行中都算未测 */
export function formatAssessmentStatus(hasCurrentResult: boolean): string {
  return hasCurrentResult ? "已测" : "未测";
}

export interface ExportCareerItem {
  name?: unknown;
  nameZh?: unknown;
}

/** 推荐职业 Top-N → `中文名;中文名;英文名`（中文名优先，空项丢弃） */
export function formatTopCareers(careers: readonly ExportCareerItem[] | null | undefined, topN = 3): string {
  if (!Array.isArray(careers)) return "";
  const names: string[] = [];
  for (const career of careers) {
    if (names.length >= topN) break;
    if (!career || typeof career !== "object") continue;
    const nameZh = typeof career.nameZh === "string" ? career.nameZh.trim() : "";
    const name = typeof career.name === "string" ? career.name.trim() : "";
    const display = nameZh || name;
    if (display) names.push(display);
  }
  return names.join(";");
}

/** 大五得分 / 人格特质快照的值（#331）；未测或快照不可用时整格留空 */
export interface BigFiveScoreValues {
  hasScores: boolean;
  /** 按量表维度顺序合成一列，如 `N42 E58 O71 A44 C66` */
  composite: string;
  /** Top2 画像，如 `高开放性 · 高尽责性`；与结果页 `buildBigFiveHeadline` 同一口径 */
  traits: string;
}

const EMPTY_BIG_FIVE_SCORES: BigFiveScoreValues = {
  hasScores: false,
  composite: "",
  traits: "",
};

/**
 * `scores_json`（大五维度分快照）→ 导出用「大五得分 + 人格特质」。
 *
 * - 维度顺序以量表 `dimensions` 为准（IPIP 为 N/E/O/A/C），不按快照数组顺序拼；
 * - 只输出快照里真实存在的维度，缺失维度不补 0（未测整格留空）；
 * - 画像只取可用维度，避免用 0 分补出来的「偏低」误导教师。
 */
export function formatBigFiveScores(
  scoresJson: string | null | undefined,
  dimensions: readonly { key: string; label: string }[]
): BigFiveScoreValues {
  if (!scoresJson || dimensions.length === 0) return EMPTY_BIG_FIVE_SCORES;
  let parsed: unknown;
  try {
    parsed = JSON.parse(scoresJson);
  } catch (err) {
    console.error("Failed to parse big five scores for export:", err);
    return EMPTY_BIG_FIVE_SCORES;
  }
  if (!Array.isArray(parsed)) return EMPTY_BIG_FIVE_SCORES;

  const byKey = new Map<string, number>();
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { key, standard } = entry as { key?: unknown; standard?: unknown };
    if (typeof key !== "string") continue;
    const score = toStandardScore(standard);
    if (score === null) continue;
    byKey.set(key, score);
  }

  const compositeParts: string[] = [];
  const snapshot: RiasecScoreSnapshot[] = [];
  for (const dimension of dimensions) {
    const score = byKey.get(dimension.key);
    if (score === undefined) continue;
    compositeParts.push(`${dimension.key}${score}`);
    snapshot.push({ key: dimension.key, standard: score });
  }
  if (compositeParts.length === 0) return EMPTY_BIG_FIVE_SCORES;

  return {
    hasScores: true,
    composite: compositeParts.join(" "),
    traits: buildBigFiveHeadline(
      snapshot,
      dimensions.filter((dimension) => byKey.has(dimension.key))
    ),
  };
}
