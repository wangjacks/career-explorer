/**
 * 教师端「数据列表」的服务端查询口径（#295 / #330）：筛选 / 排序 / 分页全部下推到数据库，
 * 这样跨页的学生也能被搜到（此前搜索、标签、兴趣测评筛选都只过滤当前页 20 行）。
 *
 * 这里是纯函数（无 IO），三处共用同一份口径：
 * - 前端 `ProfilesTab` / `useAdminAuth` 用它把界面状态拼成查询串；
 * - API 路由 `GET /api/manage/profiles` 用它校验并归一化入参；
 * - 数据层两适配器按归一化后的 filters 拼 SQL。
 *
 * **兴趣字母筛选语义（#305）**：已测评行只要三字码任意位置包含所选字母即命中，
 * 例如 `SIA` 同时命中 S / I / A。数据大屏的「类型分布」仍按首位归型，两处语义独立。
 *
 * **#330 测评筛选**：兴趣（多选 AND / 未测）与人格（已测 / 未测 / 单维度偏高偏低）
 * **互斥**——同一时间只按一种测评筛选。互斥在三个层面保证：
 * ① 界面用 `AssessmentFilter` 联合类型（见 `profile-assessment.ts`）从类型上禁止并存；
 * ② 解析层同时收到 `interest` 与 `personality` 时直接 400；
 * ③ SQL 生成器只认一个分支，不会拼出「同时命中」的条件。
 */

import { RIASEC_KEYS, type RiasecKey } from "./assessment-match";
import {
  ASSESSMENT_INTEREST_FILTERS,
  type AssessmentInterestFilter,
} from "./profile-assessment";

/** 兴趣测评筛选取值（#330）：未测 / 三字码同时包含所选字母（1–3 个，AND） */
export type ProfileInterestFilter =
  | { mode: "none" }
  | { mode: "letters"; keys: RiasecKey[] };

/** 人格测评筛选取值（#330）：未测 / 已测（任一） / 单维度 + 偏高偏低（阈值 50） */
export type ProfilePersonalityDirection = "high" | "low";
export type ProfilePersonalityFilter =
  | { mode: "none" }
  | { mode: "any" }
  | { mode: "dimension"; key: string; dir: ProfilePersonalityDirection };

/** 人格维度标准分中线：与结果页 / `buildBigFiveHeadline` 同一口径（≥50 偏高） */
export const PROFILE_PERSONALITY_MIDPOINT = 50;

/** 兴趣多选上限：三字码只有 3 位，「同时包含 4 个字母」永远筛不到人 */
export const PROFILE_INTEREST_MAX_KEYS = 3;

/** 列表可排序的字段：与表格表头一一对应（沿用前端既有的 key 名，避免两处映射漂移） */
export const PROFILE_SORT_KEYS = ["studentId", "studentName", "createdAt"] as const;
export type ProfileSortKey = (typeof PROFILE_SORT_KEYS)[number];
export type SortDir = "asc" | "desc";

/** 默认排序：最近提交在前（与改造前的默认行为一致） */
export const DEFAULT_PROFILE_SORT: { sortKey: ProfileSortKey; sortDir: SortDir } = {
  sortKey: "createdAt",
  sortDir: "desc",
};

/** 列表查询参数（前端状态 → 服务端入参的公共形状） */
export interface ProfileListQuery {
  /** 学号 / 姓名关键字（包含匹配，大小写不敏感；通配符按字面量处理） */
  q?: string;
  /** 标签名（AND 语义：必须同时拥有所选标签，与前端多选一致） */
  tags?: string[];
  /** 兼容字段（#305 单字母 / 未测）：新界面改用 `interest`；显式传入时仍按旧语义生效 */
  lead?: AssessmentInterestFilter;
  /** 兴趣测评筛选（#330）：与 `personality` 互斥 */
  interest?: ProfileInterestFilter;
  /** 人格测评筛选（#330）：与 `interest` 互斥 */
  personality?: ProfilePersonalityFilter;
  sortKey?: ProfileSortKey;
  sortDir?: SortDir;
}

/**
 * 路由解析后交给数据层的筛选：比 `ProfileListQuery` 多一个**已解析**的人格量表信息
 * （量表 code + 维度在 `scores_json` 数组里的下标）——客户端不可能也不应该传这两个值，
 * 它们只能由路由根据启用量表的 `dimensions_json` 算出来。
 */
export interface ResolvedProfileListQuery extends ProfileListQuery {
  personalitySql?: { scaleCode: string; dimensionIndex?: number } | null;
}

/** 关键字与标签长度上限：超长一律拒绝，避免把超长 LIKE 模式带进查询 */
export const PROFILE_QUERY_MAX_LENGTH = 50;
/** 标签筛选最多同时选多少个 */
export const PROFILE_QUERY_MAX_TAGS = 20;
/** 每页条数上限（防止一次拉全表） */
export const PROFILE_QUERY_MAX_PAGE_SIZE = 100;
export const DEFAULT_PROFILE_PAGE_SIZE = 20;

function isSortKey(value: string): value is ProfileSortKey {
  return (PROFILE_SORT_KEYS as readonly string[]).includes(value);
}

function isInterestFilter(value: string): value is AssessmentInterestFilter {
  return ASSESSMENT_INTEREST_FILTERS.some((item) => item.value === value);
}

/** 单个 RIASEC 字母是否合法（筛选用；小写已在上层归一） */
export function isRiasecKey(value: string): value is RiasecKey {
  return (RIASEC_KEYS as readonly string[]).includes(value);
}

type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/**
 * `interest` 参数（#330）：`none` 或逗号分隔的 1–3 个 RIASEC 字母（大小写不敏感、去重、保序）。
 *
 * **多选语义 = AND**：三字码必须同时包含所选字母；超过 3 个直接 400（三字码只有 3 位，
 * 4 个字母的组合永远为空，静默返回空列表会让教师以为「没人做过」）。
 */
function parseInterestParam(raw: string): Parsed<ProfileInterestFilter> {
  const value = raw.trim();
  if (value === "") return { ok: false, error: "interest 不能为空（不筛选请不传该参数）" };
  if (value.toLowerCase() === "none") return { ok: true, value: { mode: "none" } };

  const keys: RiasecKey[] = [];
  for (const piece of value.split(",")) {
    const key = piece.trim().toUpperCase();
    if (key === "") continue;
    if (!isRiasecKey(key)) {
      return { ok: false, error: `interest 只支持 none 或 ${RIASEC_KEYS.join(" / ")}（逗号分隔）` };
    }
    if (!keys.includes(key)) keys.push(key);
  }
  if (keys.length === 0) return { ok: false, error: "interest 至少需要一个字母" };
  if (keys.length > PROFILE_INTEREST_MAX_KEYS) {
    return { ok: false, error: `interest 最多选 ${PROFILE_INTEREST_MAX_KEYS} 个字母（三字码只有 3 位）` };
  }
  return { ok: true, value: { mode: "letters", keys } };
}

/** 人格维度 key 的格式：单段短字母数字（如 `N` / `E` / `O` / `A` / `C`，留给未来多量表） */
function isPersonalityKeyFormat(value: string): boolean {
  return /^[A-Z][A-Z0-9_]{0,9}$/.test(value);
}

/**
 * `personality` 参数（#330）：`none`（未测）/ `any`（已测）/ `KEY:high|low`（单维度 + 方向）。
 *
 * 阈值方向固定为 50 分中线；维度 key 是否存在于某套启用量表由路由再校验（这里只校验格式）。
 */
function parsePersonalityParam(raw: string): Parsed<ProfilePersonalityFilter> {
  const value = raw.trim();
  if (value === "") return { ok: false, error: "personality 不能为空（不筛选请不传该参数）" };
  const lower = value.toLowerCase();
  if (lower === "none") return { ok: true, value: { mode: "none" } };
  if (lower === "any") return { ok: true, value: { mode: "any" } };

  const parts = value.split(":");
  if (parts.length !== 2) {
    return { ok: false, error: "personality 只支持 none / any / 维度:high|low（如 C:high）" };
  }
  const key = parts[0].trim().toUpperCase();
  const dir = parts[1].trim().toLowerCase();
  if (!isPersonalityKeyFormat(key)) {
    return { ok: false, error: "personality 的维度必须是字母（如 C）" };
  }
  if (dir !== "high" && dir !== "low") {
    return { ok: false, error: "personality 的方向只支持 high / low" };
  }
  return { ok: true, value: { mode: "dimension", key, dir } };
}

export interface NormalizedProfilesQuery {
  page: number;
  pageSize: number;
  filters: ProfileListQuery;
}

export type ParseProfilesQueryResult =
  | { ok: true; value: NormalizedProfilesQuery }
  | { ok: false; error: string };

function parsePositiveInt(value: string | null, fallback: number, max?: number): number | null {
  if (value === null || value.trim() === "") return fallback;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 1) return null;
  if (max !== undefined && parsed > max) return null;
  return parsed;
}

/**
 * 解析并校验 `GET /api/manage/profiles` 的查询参数。
 *
 * 不传筛选参数时返回「默认分页 + 默认排序」——与改造前行为完全一致，旧前端调用不受影响。
 * 参数非法一律 400（显式报错，避免静默忽略筛选条件让教师以为筛过了）。
 */
export function parseProfilesQuery(params: URLSearchParams): ParseProfilesQueryResult {
  const page = parsePositiveInt(params.get("page"), 1);
  if (page === null) return { ok: false, error: "page 必须是正整数" };
  const pageSize = parsePositiveInt(params.get("pageSize"), DEFAULT_PROFILE_PAGE_SIZE, PROFILE_QUERY_MAX_PAGE_SIZE);
  if (pageSize === null) return { ok: false, error: `pageSize 必须是 1–${PROFILE_QUERY_MAX_PAGE_SIZE} 的整数` };

  const rawQuery = params.get("q");
  const q = rawQuery === null ? "" : rawQuery.trim();
  if (q.length > PROFILE_QUERY_MAX_LENGTH) {
    return { ok: false, error: `搜索关键字不能超过 ${PROFILE_QUERY_MAX_LENGTH} 个字符` };
  }

  // 一个 `tag` 参数就是一个标签，**不按逗号切分**：标签名允许含逗号（`/api/manage/tags` 只校验非空与长度），
  // 切分会把「篮球,足球」这类标签筛成「同时有篮球和足球」，与下拉里选中的那一项对不上。
  const rawTags = params.getAll("tag");
  const tags: string[] = [];
  for (const raw of rawTags) {
    const tag = raw.trim();
    if (!tag) continue;
    if (tag.length > PROFILE_QUERY_MAX_LENGTH) {
      return { ok: false, error: `标签名不能超过 ${PROFILE_QUERY_MAX_LENGTH} 个字符` };
    }
    if (!tags.includes(tag)) tags.push(tag);
  }
  if (tags.length > PROFILE_QUERY_MAX_TAGS) {
    return { ok: false, error: `标签筛选最多同时选 ${PROFILE_QUERY_MAX_TAGS} 个` };
  }

  const rawLead = params.get("lead");
  const lead: AssessmentInterestFilter =
    rawLead === null || rawLead.trim() === ""
      ? "all"
      : (rawLead.trim() as AssessmentInterestFilter);
  if (!isInterestFilter(lead)) {
    return { ok: false, error: `lead 只支持 all / ${RIASEC_KEYS.join(" / ")} / none` };
  }

  // #330 测评筛选：interest 与 personality 互斥；两者与旧 lead 也互斥（旧参数只给旧前端用）
  const rawInterest = params.get("interest");
  const rawPersonality = params.get("personality");
  let interest: ProfileInterestFilter | undefined;
  let personality: ProfilePersonalityFilter | undefined;
  if (rawInterest !== null) {
    const parsedInterest = parseInterestParam(rawInterest);
    if (!parsedInterest.ok) return { ok: false, error: parsedInterest.error };
    interest = parsedInterest.value;
  }
  if (rawPersonality !== null) {
    const parsedPersonality = parsePersonalityParam(rawPersonality);
    if (!parsedPersonality.ok) return { ok: false, error: parsedPersonality.error };
    personality = parsedPersonality.value;
  }
  if (interest && personality) {
    return { ok: false, error: "同一时间只按一种测评筛选（interest 与 personality 不能同时传）" };
  }
  if ((interest || personality) && lead !== "all") {
    return { ok: false, error: "同一时间只按一种测评筛选（用了 interest / personality 就不要再传 lead）" };
  }

  const rawSortKey = params.get("sortKey");
  const sortKey: ProfileSortKey =
    rawSortKey === null || rawSortKey.trim() === "" ? DEFAULT_PROFILE_SORT.sortKey : (rawSortKey.trim() as ProfileSortKey);
  if (!isSortKey(sortKey)) {
    return { ok: false, error: `sortKey 只支持 ${PROFILE_SORT_KEYS.join(" / ")}` };
  }

  const rawSortDir = params.get("sortDir");
  const sortDir: SortDir =
    rawSortDir === null || rawSortDir.trim() === ""
      ? sortKey === "createdAt"
        ? "desc"
        : "asc"
      : (rawSortDir.trim() as SortDir);
  if (sortDir !== "asc" && sortDir !== "desc") {
    return { ok: false, error: "sortDir 只支持 asc / desc" };
  }

  return {
    ok: true,
    value: {
      page,
      pageSize,
      filters: {
        ...(q ? { q } : {}),
        ...(tags.length > 0 ? { tags } : {}),
        lead,
        ...(interest ? { interest } : {}),
        ...(personality ? { personality } : {}),
        sortKey,
        sortDir,
      },
    },
  };
}

/**
 * 兴趣筛选 → 查询串值（#330）：`none` 或 `S,A,I`（字母按界面顺序，逗号分隔）。
 * 人格筛选同理：`none` / `any` / `C:high`。
 */
function interestToParam(interest: ProfileInterestFilter): string {
  return interest.mode === "none" ? "none" : interest.keys.join(",");
}

function personalityToParam(personality: ProfilePersonalityFilter): string {
  if (personality.mode === "none") return "none";
  if (personality.mode === "any") return "any";
  return `${personality.key}:${personality.dir}`;
}

/** 前端拼查询串：只带非默认值，保证「没筛选」时请求与改造前等价（便于缓存与排查） */
export function buildProfilesQueryString(page: number, query?: ProfileListQuery): string {
  const params = new URLSearchParams();
  params.set("page", String(page));
  const q = query?.q?.trim();
  if (q) params.set("q", q);
  for (const tag of query?.tags ?? []) {
    if (tag.trim()) params.append("tag", tag.trim());
  }
  // #330：新界面用 interest / personality（互斥，只会出现一个）；旧 lead 仍可透传
  if (query?.interest) params.set("interest", interestToParam(query.interest));
  else if (query?.personality) params.set("personality", personalityToParam(query.personality));
  else {
    const lead = query?.lead ?? "all";
    if (lead !== "all") params.set("lead", lead);
  }
  const sortKey = query?.sortKey ?? DEFAULT_PROFILE_SORT.sortKey;
  const sortDir = query?.sortDir ?? (sortKey === "createdAt" ? "desc" : "asc");
  if (sortKey !== DEFAULT_PROFILE_SORT.sortKey || sortDir !== DEFAULT_PROFILE_SORT.sortDir) {
    params.set("sortKey", sortKey);
    params.set("sortDir", sortDir);
  }
  return params.toString();
}

/** LIKE 通配符转义：用户输入的 `%` / `_` / `\` 按字面量匹配（SQL 里配 `ESCAPE '\'`） */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

/** 查询里是否带了非默认筛选（用于界面显示「已筛选」标记） */
export function hasActiveProfileFilters(query: ProfileListQuery | undefined): boolean {
  if (!query) return false;
  return (
    Boolean(query.q?.trim()) ||
    (query.tags?.length ?? 0) > 0 ||
    (query.lead ?? "all") !== "all" ||
    Boolean(query.interest) ||
    Boolean(query.personality)
  );
}
/** SQL 方言：两适配器共用同一份 WHERE / ORDER BY 生成逻辑，避免口径在两处漂移 */
export type ProfileQueryDialect = "sqlite" | "mysql";

export interface SubmittedProfilesSql {
  /** 不含 WHERE 关键字的条件串（各条件已用 AND 连接） */
  whereSql: string;
  /** 绑定参数：人格阈值这类数值条件用 number（SQLite 里 number < text，传字符串会恒不命中） */
  params: (string | number)[];
  /** 不含 ORDER BY 关键字的排序串（已含稳定破平） */
  orderBySql: string;
}

/**
 * 已提交档案列表的 WHERE / ORDER BY 生成器（#295 / #330）。
 *
 * 两适配器共用这一份，保证「跨页筛选」的语义只有一个实现：
 * - `q`：学号 / 姓名包含匹配，`%` `_` `\` 按字面量处理（配 `ESCAPE '\'`）；
 * - `tags`：AND 语义；`users.tags` 是 JSON 文本数组，用 `INSTR(tags, '"标签"')` 精确匹配元素；
 * - `interest`（或兼容旧 `lead`）：六型按**三字码任意位置包含**匹配（多选为 AND），
 *   `none` = 没有当前有效测评结果（含三字码非法）；
 * - `personality`：人格量表当前结果——`any` 已测 / `none` 未测 / 单维度 `KEY:high|low`
 *   按快照数组下标取分（**同时校验 key**，旧快照顺序不一致时不误筛）；阈值 50 与结果页一致；
 * - 兴趣与人格互斥（解析层已拦），SQL 生成器只走其中一个分支；
 * - 排序：学号 / 姓名 / 提交时间，MySQL 侧对姓名显式 `COLLATE utf8mb4_bin`，与 SQLite 的字节序一致；
 *   同值时统一按学号升序破平，翻页结果稳定。
 */
export function buildSubmittedProfilesSql(
  dialect: ProfileQueryDialect,
  filters: ResolvedProfileListQuery | undefined,
  assessmentCode: string
): SubmittedProfilesSql {
  const where: string[] = ["u.role = 'student'", "u.submitted_at IS NOT NULL"];
  const params: (string | number)[] = [];

  const q = filters?.q?.trim();
  if (q) {
    const like = `%${escapeLikePattern(q)}%`;
    where.push(
      dialect === "mysql"
        ? "(u.user_code LIKE ? ESCAPE '\\\\' OR u.name LIKE ? ESCAPE '\\\\')"
        : "(u.user_code LIKE ? ESCAPE '\\' OR u.name LIKE ? ESCAPE '\\')"
    );
    params.push(like, like);
  }

  for (const tag of filters?.tags ?? []) {
    const needle = JSON.stringify(tag.trim());
    where.push(dialect === "mysql" ? "INSTR(u.tags COLLATE utf8mb4_bin, ?) > 0" : "INSTR(u.tags, ?) > 0");
    params.push(needle);
  }

  // ── 兴趣测评（#330）：新 interest 优先；没有则沿用旧 lead（单字母 / 未测）────────────────
  // 字母筛选与「未测」共用同一个合法性口径：先 TRIM，再以首位是否属于 RIASEC 判定。
  // 字母分支必须先通过这道闸，否则 XRA 这类非法存量值会同时落进 R 与「未测」两个桶。
  const normalizedCodeExpr = "UPPER(TRIM(r.type_code))";
  const validCodeExpr = `SUBSTR(${normalizedCodeExpr}, 1, 1) IN ('R','I','A','S','E','C')`;
  const interestExists = (condition: string) =>
    `EXISTS (SELECT 1 FROM assessment_results r JOIN assessments a ON a.id = r.assessment_id ` +
    `WHERE r.user_id = u.id AND a.code = ? AND r.status = 'completed' AND r.is_current = 1 ` +
    `AND r.type_code IS NOT NULL AND ${condition})`;

  const interest: ProfileInterestFilter | undefined =
    filters?.interest ??
    ((filters?.lead ?? "all") === "all"
      ? undefined
      : filters!.lead === "none"
        ? { mode: "none" }
        : { mode: "letters", keys: [filters!.lead as RiasecKey] });

  if (interest?.mode === "none") {
    where.push(`NOT ${interestExists(validCodeExpr)}`);
    params.push(assessmentCode);
  } else if (interest?.mode === "letters") {
    // AND 语义：同时包含所选每个字母（#330 多选；单字母时与旧 lead 完全等价）
    const conditions = interest.keys.map(() => `INSTR(${normalizedCodeExpr}, ?) > 0`);
    where.push(interestExists([validCodeExpr, ...conditions].join(" AND ")));
    params.push(assessmentCode, ...interest.keys);
  }

  // ── 人格测评（#330）：与兴趣互斥，只会走这里的一个分支 ────────────────────────────────
  const personality = filters?.personality;
  if (personality) {
    const personalitySql = filters?.personalitySql ?? null;
    // 维度模式下量表信息由路由解析；缺失时退化为「已测」而不是拼出错误的 JSON 条件
    const mode = personality.mode === "dimension" && !personalitySql ? "any" : personality.mode;
    const scaleCode = personalitySql?.scaleCode ?? "";
    const existsSql = (extra: string | null) =>
      `EXISTS (SELECT 1 FROM assessment_results r JOIN assessments a ON a.id = r.assessment_id ` +
      `WHERE r.user_id = u.id AND a.code = ? AND r.status = 'completed' AND r.is_current = 1` +
      `${extra ? ` AND ${extra}` : ""})`;

    if (mode === "none") {
      where.push(`NOT ${existsSql(null)}`);
      params.push(scaleCode || assessmentCode);
    } else if (mode === "any") {
      where.push(existsSql(null));
      params.push(scaleCode || assessmentCode);
    } else if (personality.mode === "dimension" && personalitySql && typeof personalitySql.dimensionIndex === "number") {
      // scores_json 是维度分快照数组：按下标取 key 与 standard，**同时校验 key**——
      // 旧快照顺序与当前 dimensions_json 不一致时判为不命中，而不是按位置误筛。
      const path = `$[${personalitySql.dimensionIndex}]`;
      const op = personality.dir === "high" ? ">=" : "<";
      const condition =
        dialect === "mysql"
          ? `JSON_VALID(r.scores_json) = 1` +
            ` AND JSON_UNQUOTE(JSON_EXTRACT(r.scores_json, '${path}.key')) = ?` +
            ` AND CAST(JSON_EXTRACT(r.scores_json, '${path}.standard') AS DECIMAL(10,2)) ${op} ?`
          : `json_valid(r.scores_json) = 1` +
            ` AND json_extract(r.scores_json, '${path}.key') = ?` +
            ` AND json_extract(r.scores_json, '${path}.standard') ${op} ?`;
      where.push(existsSql(condition));
      params.push(personalitySql.scaleCode, personality.key, PROFILE_PERSONALITY_MIDPOINT);
    }
  }

  const sortKey = filters?.sortKey ?? DEFAULT_PROFILE_SORT.sortKey;
  const sortDir = filters?.sortDir ?? (sortKey === "createdAt" ? "desc" : "asc");
  const column =
    sortKey === "studentId"
      ? "u.user_code"
      : sortKey === "studentName"
        ? dialect === "mysql"
          ? "u.name COLLATE utf8mb4_bin"
          : "u.name"
        : "u.submitted_at";

  return {
    whereSql: where.join(" AND "),
    params,
    orderBySql: `${column} ${sortDir === "asc" ? "ASC" : "DESC"}, u.user_code ASC`,
  };
}
