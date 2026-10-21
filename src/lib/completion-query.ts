/**
 * #310 班级完成矩阵的共享 SQL 构造器与行映射。
 *
 * 两个适配器只负责执行同一条 SQL：档案段 + 各量表段用 `UNION ALL` 一次取回，
 * 按 `class_id` 分组（`null` = 未分班），班名只用于展示。把 SQL 与参数顺序集中在这里，
 * 避免 MySQL / SQLite 各写一份后慢慢分叉（同 `profile-query.ts` 的做法）。
 */

import type { CompletionStatsRaw } from "./db";

export interface CompletionStatsSql {
  sql: string;
  params: number[];
}

/** 两适配器共用的原始行形状（MySQL 的 COUNT 可能回字符串，映射时统一 Number） */
export interface CompletionStatsRow {
  assessment_id: number | string | null;
  class_id: number | string | null;
  name: string | null;
  enrolled: number | string;
  submitted: number | string | null;
  assessed: number | string;
}

/**
 * 生成完成矩阵的唯一查询。`classIds = null` 为全校（含未分班）；
 * 空集合直接返回空 SQL，由适配器短路为空计数（避免 `IN ()` 语法错误）。
 */
export function buildCompletionStatsSql(
  assessmentIds: number[],
  classIds: number[] | null
): CompletionStatsSql {
  if (classIds !== null && classIds.length === 0) return { sql: "", params: [] };

  const ids = [...new Set(assessmentIds.filter((id) => Number.isInteger(id) && id > 0))];
  const classFilter =
    classIds === null ? "" : ` AND u.class_id IN (${classIds.map(() => "?").join(",")})`;
  const classParams = classIds ?? [];

  // 档案段：分母是在册学生；submitted 与 `isSubmitted()` 的主要口径一致（空串/纯空格不算提交）
  let sql = `SELECT NULL AS assessment_id, u.class_id AS class_id, c.name AS name,
                    COUNT(*) AS enrolled,
                    SUM(CASE WHEN u.submitted_at IS NOT NULL AND TRIM(u.submitted_at) <> '' THEN 1 ELSE 0 END) AS submitted,
                    0 AS assessed
             FROM users u LEFT JOIN classes c ON c.id = u.class_id
             WHERE u.role = 'student'${classFilter}
             GROUP BY u.class_id, c.name`;
  const params: number[] = [...classParams];

  if (ids.length > 0) {
    sql += `
      UNION ALL
      SELECT r.assessment_id AS assessment_id, u.class_id AS class_id, NULL AS name,
             0 AS enrolled, 0 AS submitted,
             COUNT(DISTINCT r.user_id) AS assessed
      FROM assessment_results r JOIN users u ON u.id = r.user_id
      WHERE r.assessment_id IN (${ids.map(() => "?").join(",")})
        AND r.status = 'completed' AND r.is_current = 1 AND u.role = 'student'${classFilter}
      GROUP BY r.assessment_id, u.class_id`;
    // 参数顺序必须与占位符出现顺序一致：档案段 classIds → 量表段 ids → 量表段 classIds
    params.push(...ids, ...classParams);
  }

  return { sql, params };
}

/** 把 UNION ALL 行拆成 `profile` / `assessments` 两段原始计数（不含展示口径） */
export function mapCompletionStatsRows(
  rows: readonly CompletionStatsRow[]
): CompletionStatsRaw {
  const profile: CompletionStatsRaw["profile"] = [];
  const assessments: CompletionStatsRaw["assessments"] = [];

  for (const row of rows) {
    const classId = row.class_id === null ? null : Number(row.class_id);
    if (row.assessment_id === null) {
      profile.push({
        class_id: classId,
        name: row.name ?? null,
        enrolled: Number(row.enrolled),
        submitted: Number(row.submitted ?? 0),
      });
    } else {
      assessments.push({
        assessment_id: Number(row.assessment_id),
        class_id: classId,
        assessed: Number(row.assessed),
      });
    }
  }

  return { profile, assessments };
}
