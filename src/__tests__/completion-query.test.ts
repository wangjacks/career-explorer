import { describe, expect, it } from "vitest";
import {
  buildCompletionStatsSql,
  mapCompletionStatsRows,
} from "@/lib/completion-query";

describe("buildCompletionStatsSql（#310 共享 SQL）", () => {
  it("无量表时只生成档案段，参数只有班级集合", () => {
    const { sql, params } = buildCompletionStatsSql([], [7, 9]);
    expect(sql).toContain("FROM users u LEFT JOIN classes c");
    expect(sql).not.toContain("UNION ALL");
    expect(sql).toContain("u.class_id IN (?,?)");
    expect(params).toEqual([7, 9]);
  });

  it("量表段用 UNION ALL，参数顺序与占位符一致且 assessment id 去重", () => {
    const { sql, params } = buildCompletionStatsSql([5, 9, 5], [7]);
    expect(sql).toContain("UNION ALL");
    expect(sql).toContain("GROUP BY u.class_id, c.name");
    expect(sql).toContain("GROUP BY r.assessment_id, u.class_id");
    expect(sql).toContain("r.assessment_id IN (?,?)");
    // 档案段 classIds → 量表段 ids → 量表段 classIds
    expect(params).toEqual([7, 5, 9, 7]);
  });

  it("classIds = null 时全校口径，不加班级过滤", () => {
    const { sql, params } = buildCompletionStatsSql([5], null);
    expect(sql).not.toContain("u.class_id IN");
    expect(params).toEqual([5]);
  });

  it("空 classIds 直接返回空 SQL（避免 IN ()）", () => {
    expect(buildCompletionStatsSql([5], [])).toEqual({ sql: "", params: [] });
  });

  it("非法 assessment id 被过滤", () => {
    const { params } = buildCompletionStatsSql([0, -1, 1.5, 7], null);
    expect(params).toEqual([7]);
  });
});

describe("mapCompletionStatsRows（#310 原始行映射）", () => {
  it("拆成 profile / assessments 两段，并把 MySQL 字符串计数归一为数字", () => {
    const raw = mapCompletionStatsRows([
      {
        assessment_id: null,
        class_id: 7,
        name: "2025级1班",
        enrolled: "3",
        submitted: "2",
        assessed: "0",
      },
      {
        assessment_id: "5",
        class_id: "7",
        name: null,
        enrolled: "0",
        submitted: "0",
        assessed: "2",
      },
      {
        assessment_id: null,
        class_id: null,
        name: null,
        enrolled: 1,
        submitted: 0,
        assessed: 0,
      },
    ]);

    expect(raw.profile).toEqual([
      { class_id: 7, name: "2025级1班", enrolled: 3, submitted: 2 },
      { class_id: null, name: null, enrolled: 1, submitted: 0 },
    ]);
    expect(raw.assessments).toEqual([
      { assessment_id: 5, class_id: 7, assessed: 2 },
    ]);
  });
});
