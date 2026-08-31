import { describe, it, expect } from "vitest";
import { isAfterDeadline } from "@/lib/db";

describe("isAfterDeadline（#96 提交时限比较，定宽格式字典序即时间序）", () => {
  it("当前时刻晚于截止时间 → 已截止", () => {
    expect(isAfterDeadline("2026-08-25 00:00", "2026-08-24 23:59")).toBe(true);
  });

  it("当前时刻等于截止时间 → 已截止（含等于边界）", () => {
    expect(isAfterDeadline("2026-08-24 23:59", "2026-08-24 23:59")).toBe(true);
  });

  it("当前时刻早于截止时间 → 未截止", () => {
    expect(isAfterDeadline("2026-08-24 23:58", "2026-08-24 23:59")).toBe(false);
  });

  it("截止时间带秒时按分钟截断比较", () => {
    // 存储值偶含秒也不影响分钟级判定
    expect(isAfterDeadline("2026-08-24 23:59", "2026-08-24 23:59:30")).toBe(true);
    expect(isAfterDeadline("2026-08-24 23:58", "2026-08-24 23:59:30")).toBe(false);
  });

  it("跨月份/年份比较正确", () => {
    expect(isAfterDeadline("2026-09-01 00:00", "2026-08-31 23:59")).toBe(true);
    expect(isAfterDeadline("2026-12-31 23:59", "2027-01-01 00:00")).toBe(false);
  });
});
