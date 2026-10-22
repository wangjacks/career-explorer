import { describe, it, expect } from "vitest";
import {
  GROUP_POST_CONTENT_MAX,
  GROUP_TASK_TITLE_MAX,
  commonInterests,
  formatLocalDateTime,
  interestCoverage,
  isTaskOverdue,
  normalizeDueAt,
  parseMemberTags,
  taskProgress,
  validatePostInput,
  validateTaskInput,
} from "../lib/group-workspace";

describe("小组工作区纯函数（#346）", () => {
  it("共同兴趣：只保留至少 2 人共有，按人数降序、同人数按名字排序，最多 3 个", () => {
    const tags = [
      ["编程", "摄影", "阅读"],
      ["摄影", "阅读"],
      ["摄影", "篮球"],
      ["编程", "篮球"],
    ];
    expect(commonInterests(tags)).toEqual(["摄影", "篮球", "编程"].slice(0, 3));
    expect(commonInterests([["编程"]])).toEqual([]);
    expect(commonInterests([["b", "a"], ["a", "b"], ["a"]])).toEqual(["a", "b"]);
  });

  it("兴趣覆盖：按三字码首位去重，过滤空值与非法字母，分母恒为 6", () => {
    expect(interestCoverage(["SIA", "IEC", null, "", "XYZ"])).toEqual({
      covered: 2,
      total: 6,
      tested: 2,
    });
    expect(interestCoverage([null, undefined])).toEqual({ covered: 0, total: 6, tested: 0 });
  });

  it("任务进度与逾期：空列表 0%，按完成数取整", () => {
    expect(taskProgress([])).toEqual({ total: 0, done: 0, percent: 0 });
    expect(
      taskProgress([{ status: "done" }, { status: "open" }, { status: "in_progress" }])
    ).toEqual({ total: 3, done: 1, percent: 33 });
    expect(isTaskOverdue("2026-10-01 10:00:00", "2026-10-02 10:00:00")).toBe(true);
    expect(isTaskOverdue("2026-10-03 10:00:00", "2026-10-02 10:00:00")).toBe(false);
    expect(isTaskOverdue(null, "2026-10-02 10:00:00")).toBe(false);
  });

  it("本地时间文本固定按 Asia/Shanghai 输出（与适配器 getNow 同口径）", () => {
    expect(formatLocalDateTime(new Date(0))).toBe("1970-01-01 08:00:00");
    expect(formatLocalDateTime(new Date("2026-10-30T18:05:09Z"))).toBe("2026-10-31 02:05:09");
  });

  it("截止时间归一化：日期取当天 23:59，datetime-local 补秒；非法日期拒绝", () => {
    expect(normalizeDueAt("")).toEqual({ ok: true, value: null });
    expect(normalizeDueAt(null)).toEqual({ ok: true, value: null });
    expect(normalizeDueAt("2026-10-30")).toEqual({ ok: true, value: "2026-10-30 23:59:00" });
    expect(normalizeDueAt("2026-10-30T18:05")).toEqual({ ok: true, value: "2026-10-30 18:05:00" });
    expect(normalizeDueAt("2026-02-30")).toMatchObject({ ok: false });
    expect(normalizeDueAt("2026/10/30")).toMatchObject({ ok: false });
  });

  it("公告校验：标题/正文必填且限长，返回 trim 后的值", () => {
    expect(validatePostInput("  ", "内容")).toMatchObject({ ok: false });
    expect(validatePostInput("标题", "")).toMatchObject({ ok: false });
    expect(validatePostInput("标题", "内容")).toEqual({
      ok: true,
      value: { title: "标题", content: "内容" },
    });
    expect(validatePostInput("标".repeat(41), "内容")).toMatchObject({ ok: false });
    expect(validatePostInput("标题", "内".repeat(GROUP_POST_CONTENT_MAX + 1))).toMatchObject({
      ok: false,
    });
  });

  it("任务校验：标题限长、说明可空、截止时间走归一化", () => {
    expect(validateTaskInput("", null, null)).toMatchObject({ ok: false });
    expect(validateTaskInput("t".repeat(GROUP_TASK_TITLE_MAX + 1), null, null)).toMatchObject({
      ok: false,
    });
    expect(validateTaskInput("整理 PPT", "  ", "2026-10-30T18:05")).toEqual({
      ok: true,
      value: { title: "整理 PPT", description: null, dueAt: "2026-10-30 18:05:00" },
    });
    expect(validateTaskInput("整理 PPT", "说明", "bad-date")).toMatchObject({ ok: false });
  });

  it("成员标签解析：坏 JSON / 非数组按空处理，剔除非字符串", () => {
    expect(parseMemberTags('["编程","摄影"]')).toEqual(["编程", "摄影"]);
    expect(parseMemberTags("not-json")).toEqual([]);
    expect(parseMemberTags('{"a":1}')).toEqual([]);
    expect(parseMemberTags('["编程", 1, ""]')).toEqual(["编程"]);
    expect(parseMemberTags(null)).toEqual([]);
  });
});
