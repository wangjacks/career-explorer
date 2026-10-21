/**
 * 教师端「数据列表」的服务端查询口径（#295）：筛选 / 排序 / 分页全部下推到数据库，
 * 这样跨页的学生也能被搜到（此前搜索、标签、兴趣测评筛选都只过滤当前页 20 行）。
 *
 * 这里是纯函数（无 IO），三处共用同一份口径：
 * - 前端 `ProfilesTab` / `useAdminAuth` 用它把界面状态拼成查询串；
 * - API 路由 `GET /api/manage/profiles` 用它校验并归一化入参；
 * - 数据层两适配器按归一化后的 filters 拼 SQL。
 *
 * **兴趣字母筛选语义（#305）**：已测评行只要三字码任意位置包含所选字母即命中，
 * 例如 `SIA` 同时命中 S / I / A。数据大屏的「类型分布」仍按首位归型，两处语义独立。
 */

import { RIASEC_KEYS } from "./assessment-match";
import {
  ASSESSMENT_INTEREST_FILTERS,
  type AssessmentInterestFilter,
} from "./profile-assessment";

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
  /** 兴趣测评：六型字母之一（三字码包含即命中）/ `none` 未测 / `all` 不限 */
  lead?: AssessmentInterestFilter;
  sortKey?: ProfileSortKey;
  sortDir?: SortDir;
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
        sortKey,
        sortDir,
      },
    },
  };
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
  const lead = query?.lead ?? "all";
  if (lead !== "all") params.set("lead", lead);
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
  return Boolean(query.q?.trim()) || (query.tags?.length ?? 0) > 0 || (query.lead ?? "all") !== "all";
}
/** SQL 方言：两适配器共用同一份 WHERE / ORDER BY 生成逻辑，避免口径在两处漂移 */
export type ProfileQueryDialect = "sqlite" | "mysql";

export interface SubmittedProfilesSql {
  /** 不含 WHERE 关键字的条件串（各条件已用 AND 连接） */
  whereSql: string;
  params: string[];
  /** 不含 ORDER BY 关键字的排序串（已含稳定破平） */
  orderBySql: string;
}

/**
 * 已提交档案列表的 WHERE / ORDER BY 生成器（#295）。
 *
 * 两适配器共用这一份，保证「跨页筛选」的语义只有一个实现：
 * - `q`：学号 / 姓名包含匹配，`%` `_` `\` 按字面量处理（配 `ESCAPE '\'`）；
 * - `tags`：AND 语义；`users.tags` 是 JSON 文本数组，用 `INSTR(tags, '"标签"')` 精确匹配元素；
 * - `lead`：六型按**三字码任意位置包含**匹配，`none` = 没有当前有效测评结果（含三字码非法）；
 * - 排序：学号 / 姓名 / 提交时间，MySQL 侧对姓名显式 `COLLATE utf8mb4_bin`，与 SQLite 的字节序一致；
 *   同值时统一按学号升序破平，翻页结果稳定。
 */
export function buildSubmittedProfilesSql(
  dialect: ProfileQueryDialect,
  filters: ProfileListQuery | undefined,
  assessmentCode: string
): SubmittedProfilesSql {
  const where: string[] = ["u.role = 'student'", "u.submitted_at IS NOT NULL"];
  const params: string[] = [];

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

  const lead = filters?.lead ?? "all";
  if (lead !== "all") {
    // 字母筛选与「未测」共用同一个合法性口径：先 TRIM，再以首位是否属于 RIASEC 判定。
    // 字母分支必须先通过这道闸，否则 XRA 这类非法存量值会同时落进 R 与「未测」两个桶。
    const normalizedCodeExpr = "UPPER(TRIM(r.type_code))";
    const validCodeExpr = `SUBSTR(${normalizedCodeExpr}, 1, 1) IN ('R','I','A','S','E','C')`;
    const assessedExists = (condition: string) =>
      `EXISTS (SELECT 1 FROM assessment_results r JOIN assessments a ON a.id = r.assessment_id ` +
      `WHERE r.user_id = u.id AND a.code = ? AND r.status = 'completed' AND r.is_current = 1 ` +
      `AND r.type_code IS NOT NULL AND ${condition})`;
    if (lead === "none") {
      where.push(`NOT ${assessedExists(validCodeExpr)}`);
      params.push(assessmentCode);
    } else {
      where.push(assessedExists(`${validCodeExpr} AND INSTR(${normalizedCodeExpr}, ?) > 0`));
      params.push(assessmentCode, lead);
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
