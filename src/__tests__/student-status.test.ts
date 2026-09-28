import { describe, it, expect } from "vitest";
import {
  isSubmitted,
  matchesSubmissionFilter,
  countSubmissions,
  formatSubmittedAt,
} from "@/lib/student-status";

const ROWS = [
  { submitted_at: "2026-09-25 10:30:00" },
  { submitted_at: "2026-09-26 08:05:00" },
  { submitted_at: null },
  { submitted_at: "" },
];

describe("isSubmitted（#170 提交状态判定）", () => {
  it("有值视为已提交", () => {
    expect(isSubmitted("2026-09-25 10:30:00")).toBe(true);
  });

  it("null / undefined / 空串 / 纯空白视为未提交", () => {
    expect(isSubmitted(null)).toBe(false);
    expect(isSubmitted(undefined)).toBe(false);
    expect(isSubmitted("")).toBe(false);
    expect(isSubmitted("   ")).toBe(false);
  });
});

describe("matchesSubmissionFilter（#170 提交状态筛选）", () => {
  it("all 全部通过", () => {
    expect(ROWS.every((r) => matchesSubmissionFilter(r.submitted_at, "all"))).toBe(true);
  });

  it("submitted 仅保留已提交", () => {
    expect(ROWS.filter((r) => matchesSubmissionFilter(r.submitted_at, "submitted"))).toHaveLength(2);
  });

  it("pending 仅保留未提交（含空串脏数据）", () => {
    expect(ROWS.filter((r) => matchesSubmissionFilter(r.submitted_at, "pending"))).toHaveLength(2);
  });
});

describe("countSubmissions（#170 筛选条计数）", () => {
  it("统计总数 / 已提交 / 未提交", () => {
    expect(countSubmissions(ROWS)).toEqual({ total: 4, submitted: 2, pending: 2 });
  });

  it("空列表返回全零", () => {
    expect(countSubmissions([])).toEqual({ total: 0, submitted: 0, pending: 0 });
  });
});

describe("formatSubmittedAt（#170 提交时间展示）", () => {
  it("库内 TEXT 格式压到分钟", () => {
    expect(formatSubmittedAt("2026-09-25 10:30:00")).toBe("2026-09-25 10:30");
  });

  it("ISO 字符串（含 T 与时区）同样压到分钟", () => {
    expect(formatSubmittedAt("2026-09-26T08:05:12.000Z")).toBe("2026-09-26 08:05");
  });

  it("未提交返回空串", () => {
    expect(formatSubmittedAt(null)).toBe("");
    expect(formatSubmittedAt("  ")).toBe("");
  });
});
