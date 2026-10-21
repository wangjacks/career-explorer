import { describe, it, expect } from "vitest";
import {
  DEFAULT_PROFILE_SORT,
  PROFILE_QUERY_MAX_TAGS,
  buildProfilesQueryString,
  buildSubmittedProfilesSql,
  escapeLikePattern,
  hasActiveProfileFilters,
  parseProfilesQuery,
  type ProfileListQuery,
} from "../lib/profile-query";

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
  });
});
