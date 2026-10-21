import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROFILE_SORT,
  PROFILE_QUERY_MAX_TAGS,
  buildProfileFilterParams,
  buildProfilesQueryString,
  buildSubmittedProfilesSql,
  escapeLikePattern,
  hasActiveProfileFilters,
  parseProfileFilters,
  parseProfilesQuery,
  resolveProfilePersonalityFilter,
  type ProfileListQuery,
} from "../lib/profile-query";
import type { ProfileAssessmentScaleView } from "../lib/profile-assessment";

function parse(query: string) {
  return parseProfilesQuery(new URLSearchParams(query));
}

describe("parseProfilesQuery（#295 服务端筛选入参）", () => {
  it("不传参数时给默认值：第 1 页 / 每页 20 / 不限兴趣测评 / 提交时间倒序", () => {
    const parsed = parse("");
    expect(parsed).toEqual({
      ok: true,
      value: {
        page: 1,
        pageSize: 20,
        filters: { lead: "all", sortKey: DEFAULT_PROFILE_SORT.sortKey, sortDir: DEFAULT_PROFILE_SORT.sortDir },
      },
    });
  });

  it("q / 标签 / 兴趣测评 / 排序全部归一化（标签去重、去空白；逗号属于标签名，不切分）", () => {
    const parsed = parse(
      "?page=2&pageSize=10&q=%20%E5%BC%A0%E4%B8%89%20&tag=%E7%AF%AE%E7%90%83%2C%E8%B6%B3%E7%90%83&tag=%20%E8%BF%90%E5%8A%A8%20&tag=%E8%BF%90%E5%8A%A8&lead=I&sortKey=studentId&sortDir=asc"
    );
    expect(parsed).toEqual({
      ok: true,
      value: {
        page: 2,
        pageSize: 10,
        filters: {
          q: "张三",
          // 「篮球,足球」是一个标签；`运动` 去空白后去重——下拉里选中的项必须原样筛回去
          tags: ["篮球,足球", "运动"],
          lead: "I",
          sortKey: "studentId",
          sortDir: "asc",
        },
      },
    });
  });

  it("排序方向有默认值：按提交时间默认倒序，其余字段默认升序", () => {
    expect((parse("?sortKey=studentId") as { value: { filters: { sortDir: string } } }).value.filters.sortDir).toBe("asc");
    expect((parse("?sortKey=createdAt") as { value: { filters: { sortDir: string } } }).value.filters.sortDir).toBe("desc");
  });

  it.each([
    ["page=0", "page 必须是正整数"],
    ["page=-1", "page 必须是正整数"],
    ["page=abc", "page 必须是正整数"],
    ["pageSize=0", "pageSize 必须是"],
    ["pageSize=101", "pageSize 必须是"],
    ["lead=Z", "lead 只支持"],
    ["lead=all, I", "lead 只支持"],
    ["sortKey=score", "sortKey 只支持"],
    ["sortDir=up", "sortDir 只支持"],
  ])("非法参数 %s → ok:false", (query, message) => {
    const parsed = parse(`?${query}`);
    expect(parsed.ok).toBe(false);
    if (!parsed.ok) expect(parsed.error).toContain(message);
  });

  it("关键字 / 标签长度与标签数量上限", () => {
    expect(parse(`?q=${encodeURIComponent("字".repeat(51))}`).ok).toBe(false);
    expect(parse(`?tag=${encodeURIComponent("字".repeat(51))}`).ok).toBe(false);
    const tooMany = Array.from({ length: PROFILE_QUERY_MAX_TAGS + 1 }, (_, index) => `tag=t${index}`).join("&");
    expect(parse(`?${tooMany}`).ok).toBe(false);
  });
});

describe("buildProfilesQueryString（前端拼查询串）", () => {
  it("没有筛选时只带 page：请求与改造前等价", () => {
    expect(buildProfilesQueryString(3)).toBe("page=3");
    expect(buildProfilesQueryString(1, { lead: "all", sortKey: "createdAt", sortDir: "desc" })).toBe("page=1");
  });

  it("筛选与排序都带上，round-trip 后与归一化入参一致", () => {
    const query: ProfileListQuery = {
      q: "张三",
      tags: ["游戏", "运动"],
      lead: "none",
      sortKey: "studentName",
      sortDir: "asc",
    };
    const qs = buildProfilesQueryString(2, query);
    expect(qs).toContain("page=2");
    expect(qs).toContain("lead=none");
    expect(qs).toContain("sortKey=studentName");
    expect(qs).toContain("sortDir=asc");
    const parsed = parse(`?${qs}`);
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      // 标签是 AND 语义，顺序不参与判定：round-trip 后与入参一致
      expect(parsed.value.filters).toEqual(query);
    }
  });
});

describe("buildSubmittedProfilesSql（两适配器共用的 SQL 口径）", () => {
  it("默认：只筛已提交学生、按提交时间倒序 + 学号破平", () => {
    const sql = buildSubmittedProfilesSql("sqlite", undefined, "riasec");
    expect(sql.whereSql).toBe("u.role = 'student' AND u.submitted_at IS NOT NULL");
    expect(sql.params).toEqual([]);
    expect(sql.orderBySql).toBe("u.submitted_at DESC, u.user_code ASC");
  });

  it("q：学号 / 姓名包含匹配，通配符转义，参数占位顺序正确", () => {
    const sql = buildSubmittedProfilesSql("sqlite", { q: "100%_a" }, "riasec");
    expect(sql.whereSql).toContain("u.user_code LIKE ?");
    expect(sql.whereSql).toContain("ESCAPE");
    expect(sql.params).toEqual(["%100\\%\\_a%", "%100\\%\\_a%"]);
  });

  it("标签：JSON 元素精确匹配，多标签 AND；MySQL 侧显式 utf8mb4_bin 保证大小写敏感", () => {
    const sqliteSql = buildSubmittedProfilesSql("sqlite", { tags: ["运动", "游戏"] }, "riasec");
    expect(sqliteSql.whereSql.match(/INSTR\(u\.tags, \?\) > 0/g)).toHaveLength(2);
    expect(sqliteSql.params).toEqual(['"运动"', '"游戏"']);

    const mysqlSql = buildSubmittedProfilesSql("mysql", { tags: ["运动"] }, "riasec");
    expect(mysqlSql.whereSql).toContain("INSTR(u.tags COLLATE utf8mb4_bin, ?) > 0");
  });

  it("兴趣测评：六型按三字码任意位置包含；none 用 NOT EXISTS（含三字码非法/无结果）", () => {
    const leadSql = buildSubmittedProfilesSql("sqlite", { lead: "I" }, "riasec");
    expect(leadSql.whereSql).toContain(
      "SUBSTR(UPPER(TRIM(r.type_code)), 1, 1) IN ('R','I','A','S','E','C')"
    );
    expect(leadSql.whereSql).toContain("INSTR(UPPER(TRIM(r.type_code)), ?) > 0");
    expect(leadSql.whereSql).toContain("a.code = ?");
    expect(leadSql.params).toEqual(["riasec", "I"]);

    const noneSql = buildSubmittedProfilesSql("sqlite", { lead: "none" }, "riasec");
    expect(noneSql.whereSql).toContain("NOT EXISTS");
    expect(noneSql.whereSql).toContain(
      "SUBSTR(UPPER(TRIM(r.type_code)), 1, 1) IN ('R','I','A','S','E','C')"
    );
    expect(noneSql.params).toEqual(["riasec"]);
  });

  it("排序：学号 / 姓名 / 提交时间；MySQL 姓名显式 binary collation 与 SQLite 字节序一致", () => {
    expect(buildSubmittedProfilesSql("sqlite", { sortKey: "studentId", sortDir: "asc" }, "riasec").orderBySql).toBe(
      "u.user_code ASC, u.user_code ASC"
    );
    expect(buildSubmittedProfilesSql("sqlite", { sortKey: "studentName", sortDir: "desc" }, "riasec").orderBySql).toBe(
      "u.name DESC, u.user_code ASC"
    );
    expect(buildSubmittedProfilesSql("mysql", { sortKey: "studentName", sortDir: "desc" }, "riasec").orderBySql).toBe(
      "u.name COLLATE utf8mb4_bin DESC, u.user_code ASC"
    );
  });
});

describe("小工具", () => {
  it("escapeLikePattern：%、_、\\ 都按字面量处理", () => {
    expect(escapeLikePattern("100%")).toBe("100\\%");
    expect(escapeLikePattern("a_b")).toBe("a\\_b");
    expect(escapeLikePattern("a\\b")).toBe("a\\\\b");
  });

  it("hasActiveProfileFilters：只有兴趣测评/关键字/标签算筛选，排序不算", () => {
    expect(hasActiveProfileFilters(undefined)).toBe(false);
    expect(hasActiveProfileFilters({ lead: "all" })).toBe(false);
    expect(hasActiveProfileFilters({ sortKey: "studentId" })).toBe(false);
    expect(hasActiveProfileFilters({ q: "张" })).toBe(true);
    expect(hasActiveProfileFilters({ tags: ["运动"] })).toBe(true);
    expect(hasActiveProfileFilters({ lead: "I" })).toBe(true);
    // #330：新的兴趣 / 人格筛选同样算「已筛选」
    expect(hasActiveProfileFilters({ interest: { mode: "none" } })).toBe(true);
    expect(hasActiveProfileFilters({ interest: { mode: "letters", keys: ["S", "A"] } })).toBe(true);
    expect(hasActiveProfileFilters({ personality: { mode: "any" } })).toBe(true);
  });
});

describe("parseProfilesQuery — #330 双测评筛选", () => {
  it("兴趣多选：逗号分隔、大小写不敏感、去重保序", () => {
    const parsed = parse("?interest=a,s,I,A");
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value.filters.interest).toEqual({ mode: "letters", keys: ["A", "S", "I"] });
      // 多选上限 3：第 4 个字母被拒绝，而不是静默丢弃
      expect(parsed.value.filters.lead).toBe("all");
    }
    expect(parse("?interest=S,A,I,E").ok).toBe(false);
    expect(parse("?interest=none").ok).toBe(true);
    expect(parse("?interest=").ok).toBe(false);
    expect(parse("?interest=X").ok).toBe(false);
  });

  it("人格筛选：none / any / 单维度方向，格式与字母规范化", () => {
    const any = parse("?personality=any");
    expect(any.ok && any.value.filters.personality).toEqual({ mode: "any" });
    const none = parse("?personality=none");
    expect(none.ok && none.value.filters.personality).toEqual({ mode: "none" });
    const dim = parse("?personality=c:HIGH");
    expect(dim.ok && dim.value.filters.personality).toEqual({ mode: "dimension", key: "C", dir: "high" });

    expect(parse("?personality=C").ok).toBe(false);
    expect(parse("?personality=C:mid").ok).toBe(false);
    expect(parse("?personality=:high").ok).toBe(false);
  });

  it("互斥双保险：同时传 interest 与 personality → 400；新参数与旧 lead 也不能并存", () => {
    const both = parse("?interest=S&personality=C:high");
    expect(both.ok).toBe(false);
    if (!both.ok) expect(both.error).toContain("同一时间只按一种测评筛选");

    const mixedLegacy = parse("?lead=S&interest=A");
    expect(mixedLegacy.ok).toBe(false);
    if (!mixedLegacy.ok) expect(mixedLegacy.error).toContain("同一时间只按一种测评筛选");
  });

  it("前端拼查询串：兴趣用 interest=…，人格用 personality=…，round-trip 一致", () => {
    const interest: ProfileListQuery = { interest: { mode: "letters", keys: ["S", "A", "I"] } };
    const qs = buildProfilesQueryString(2, interest);
    expect(qs).toContain("interest=S%2CA%2CI");
    const parsedInterest = parse(`?${qs}`);
    expect(parsedInterest.ok && parsedInterest.value.filters.interest).toEqual({
      mode: "letters",
      keys: ["S", "A", "I"],
    });

    const personality: ProfileListQuery = { personality: { mode: "dimension", key: "C", dir: "low" } };
    const personQuery = buildProfilesQueryString(1, personality);
    expect(personQuery).toContain("personality=C%3Alow");
    const parsedPerson = parse(`?${personQuery}`);
    expect(parsedPerson.ok && parsedPerson.value.filters.personality).toEqual({
      mode: "dimension",
      key: "C",
      dir: "low",
    });
  });
});

describe("buildSubmittedProfilesSql — #330 测评筛选 SQL", () => {
  it("兴趣多选 = AND：每个字母各一条 INSTR 条件，参数顺序固定", () => {
    const sql = buildSubmittedProfilesSql("sqlite", { interest: { mode: "letters", keys: ["S", "A", "I"] } }, "riasec");
    expect(sql.whereSql.match(/INSTR\(UPPER\(TRIM\(r\.type_code\)\), \?\) > 0/g)).toHaveLength(3);
    expect(sql.whereSql).toContain("a.code = ?");
    expect(sql.params).toEqual(["riasec", "S", "A", "I"]);
  });

  it("兴趣未测：NOT EXISTS 且同样要求三字码合法（非法码归未测）", () => {
    const sql = buildSubmittedProfilesSql("sqlite", { interest: { mode: "none" } }, "riasec");
    expect(sql.whereSql).toContain("NOT EXISTS");
    expect(sql.whereSql).toContain("SUBSTR(UPPER(TRIM(r.type_code)), 1, 1) IN ('R','I','A','S','E','C')");
    expect(sql.params).toEqual(["riasec"]);
  });

  it("人格已测 / 未测：按量表 code 的 EXISTS / NOT EXISTS", () => {
    const anySql = buildSubmittedProfilesSql(
      "sqlite",
      { personality: { mode: "any" }, personalitySql: { scaleCode: "ipip-neo-ffi" } },
      "riasec"
    );
    expect(anySql.whereSql).toContain("a.code = ?");
    expect(anySql.params).toEqual(["ipip-neo-ffi"]);

    const noneSql = buildSubmittedProfilesSql(
      "sqlite",
      { personality: { mode: "none" }, personalitySql: { scaleCode: "ipip-neo-ffi" } },
      "riasec"
    );
    expect(noneSql.whereSql).toContain("NOT EXISTS");
    expect(noneSql.params).toEqual(["ipip-neo-ffi"]);
  });

  it("人格单维度：按下标取 key 与 standard（同时校验 key），阈值 50；两库方言各自正确", () => {
    const filters = {
      personality: { mode: "dimension", key: "C", dir: "high" } as const,
      personalitySql: { scaleCode: "ipip-neo-ffi", dimensionIndex: 4 },
    };
    const sqliteSql = buildSubmittedProfilesSql("sqlite", filters, "riasec");
    expect(sqliteSql.whereSql).toContain("json_valid(r.scores_json) = 1");
    expect(sqliteSql.whereSql).toContain("json_extract(r.scores_json, '$[4].key') = ?");
    expect(sqliteSql.whereSql).toContain("json_extract(r.scores_json, '$[4].standard') >= ?");
    expect(sqliteSql.params).toEqual(["ipip-neo-ffi", "C", 50]);

    const mysqlSql = buildSubmittedProfilesSql("mysql", filters, "riasec");
    expect(mysqlSql.whereSql).toContain("JSON_VALID(r.scores_json) = 1");
    expect(mysqlSql.whereSql).toContain("JSON_UNQUOTE(JSON_EXTRACT(r.scores_json, '$[4].key')) = ?");
    expect(mysqlSql.whereSql).toContain("CAST(JSON_EXTRACT(r.scores_json, '$[4].standard') AS DECIMAL(10,2)) >= ?");

    const low = buildSubmittedProfilesSql(
      "sqlite",
      { personality: { mode: "dimension", key: "C", dir: "low" }, personalitySql: { scaleCode: "x", dimensionIndex: 0 } },
      "riasec"
    );
    expect(low.whereSql).toContain("json_extract(r.scores_json, '$[0].standard') < ?");
  });

  it("personality 缺少量表层信息时显式抛错：不静默退化成已测、也不按错误量表拼条件", () => {
    expect(() => buildSubmittedProfilesSql("sqlite", { personality: { mode: "any" } }, "riasec")).toThrow(
      /personalitySql/
    );
    expect(() => buildSubmittedProfilesSql("mysql", { personality: { mode: "none" } }, "riasec")).toThrow(
      /personalitySql/
    );
    expect(() =>
      buildSubmittedProfilesSql(
        "sqlite",
        { personality: { mode: "dimension", key: "C", dir: "high" }, personalitySql: { scaleCode: "ipip-neo-ffi" } },
        "riasec"
      )
    ).toThrow(/维度下标/);
  });
});

describe("parseProfileFilters / buildProfileFilterParams（列表与导出共用，#331）", () => {
  it("只解析筛选，不含分页与排序", () => {
    const parsed = parseProfileFilters(
      new URLSearchParams("q=%20%E5%BC%A0%E4%B8%89%20&tag=%E8%BF%90%E5%8A%A8&interest=s,a&page=3&sortKey=studentId")
    );
    expect(parsed.ok).toBe(true);
    if (parsed.ok) {
      expect(parsed.value).toEqual({
        q: "张三",
        tags: ["运动"],
        lead: "all",
        interest: { mode: "letters", keys: ["S", "A"] },
      });
      expect(parsed.value).not.toHaveProperty("sortKey");
      expect(parsed.value).not.toHaveProperty("page");
    }
  });

  it("非法筛选参数同样返回错误（导出侧不会静默忽略）", () => {
    expect(parseProfileFilters(new URLSearchParams("interest=S,I,A,E")).ok).toBe(false);
    expect(parseProfileFilters(new URLSearchParams("personality=C:mid")).ok).toBe(false);
    expect(parseProfileFilters(new URLSearchParams("lead=Z")).ok).toBe(false);
  });

  it("拼筛选串：无筛选不带任何参数，标签逐一 append，兴趣/人格只带一个", () => {
    const empty = buildProfileFilterParams(undefined);
    expect(empty.toString()).toBe("");

    const interest = buildProfileFilterParams({
      q: " 张三 ",
      tags: ["运动", "阅读"],
      interest: { mode: "letters", keys: ["S", "A"] },
    });
    expect(interest.get("q")).toBe("张三");
    expect(interest.getAll("tag")).toEqual(["运动", "阅读"]);
    expect(interest.get("interest")).toBe("S,A");
    expect(interest.has("personality")).toBe(false);

    const personality = buildProfileFilterParams({
      personality: { mode: "dimension", key: "C", dir: "high" },
    });
    expect(personality.get("personality")).toBe("C:high");
  });
});

describe("resolveProfilePersonalityFilter（#330 / #331 列表与导出共用）", () => {
  const scales: ProfileAssessmentScaleView[] = [
    {
      code: "riasec",
      name: "霍兰德",
      scoringMode: "typological",
      dimensions: [{ key: "R", label: "现实型" }],
    },
    {
      code: "ipip-neo-ffi",
      name: "大五",
      scoringMode: "dimensional",
      dimensions: [
        { key: "N", label: "神经质" },
        { key: "E", label: "外向性" },
        { key: "O", label: "开放性" },
        { key: "A", label: "宜人性" },
        { key: "C", label: "尽责性" },
      ],
    },
  ];

  it("单维度：按 dimensions 顺序解析下标；any/none 取第一套维度型量表", () => {
    const dimension = resolveProfilePersonalityFilter(
      { personality: { mode: "dimension", key: "C", dir: "low" } },
      scales
    );
    expect(dimension).toEqual({
      ok: true,
      filters: {
        personality: { mode: "dimension", key: "C", dir: "low" },
        personalitySql: { scaleCode: "ipip-neo-ffi", dimensionIndex: 4 },
      },
    });

    const any = resolveProfilePersonalityFilter({ personality: { mode: "any" } }, scales);
    expect(any).toEqual({
      ok: true,
      filters: { personality: { mode: "any" }, personalitySql: { scaleCode: "ipip-neo-ffi" } },
    });
  });

  it("维度不存在 / 没有启用的维度型量表时显式报错", () => {
    const missing = resolveProfilePersonalityFilter(
      { personality: { mode: "dimension", key: "X", dir: "high" } },
      scales
    );
    expect(missing.ok).toBe(false);
    if (!missing.ok) expect(missing.error).toContain("没有维度 X");

    const noDimensional = resolveProfilePersonalityFilter(
      { personality: { mode: "any" } },
      scales.filter((scale) => scale.scoringMode !== "dimensional")
    );
    expect(noDimensional.ok).toBe(false);
  });

  it("没有传人格筛选时原样返回", () => {
    const filters: ProfileListQuery = { q: "张三" };
    expect(resolveProfilePersonalityFilter(filters, scales)).toEqual({ ok: true, filters });
  });
});
