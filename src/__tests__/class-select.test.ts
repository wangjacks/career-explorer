import { describe, it, expect } from "vitest";
import {
  nextEnabledIndex,
  firstEnabledIndex,
  lastEnabledIndex,
  selectedIndexFor,
  isClassListUnavailable,
  isClassNameMissing,
  type SelectableOption,
} from "@/lib/class-select";

const OPTIONS: SelectableOption[] = [
  { id: 1, name: "2025级1班" },
  { id: 2, name: "2025级2班" },
  { id: 3, name: "2025级3班" },
];

const WITH_DISABLED: SelectableOption[] = [
  { id: 1, name: "一班" },
  { id: 2, name: "二班", disabled: true },
  { id: 3, name: "三班" },
];

describe("nextEnabledIndex（#194 方向键移动活动项）", () => {
  it("↓ / ↑ 在选项间移动", () => {
    expect(nextEnabledIndex(OPTIONS, 0, "ArrowDown")).toBe(1);
    expect(nextEnabledIndex(OPTIONS, 1, "ArrowUp")).toBe(0);
  });

  it("两端循环", () => {
    expect(nextEnabledIndex(OPTIONS, 2, "ArrowDown")).toBe(0);
    expect(nextEnabledIndex(OPTIONS, 0, "ArrowUp")).toBe(2);
  });

  it("跳过 disabled 项", () => {
    expect(nextEnabledIndex(WITH_DISABLED, 0, "ArrowDown")).toBe(2);
    expect(nextEnabledIndex(WITH_DISABLED, 2, "ArrowUp")).toBe(0);
  });

  it("尚未有活动项（-1）时从首项开始", () => {
    expect(nextEnabledIndex(OPTIONS, -1, "ArrowDown")).toBe(0);
  });

  it("空列表或全部 disabled → -1", () => {
    expect(nextEnabledIndex([], 0, "ArrowDown")).toBe(-1);
    expect(nextEnabledIndex([{ id: 1, name: "唯一", disabled: true }], -1, "ArrowDown")).toBe(-1);
  });
});

describe("firstEnabledIndex / lastEnabledIndex（Home / End）", () => {
  it("取首末可用项", () => {
    expect(firstEnabledIndex(WITH_DISABLED)).toBe(0);
    expect(lastEnabledIndex(WITH_DISABLED)).toBe(2);
  });

  it("无可用项返回 -1", () => {
    expect(firstEnabledIndex([])).toBe(-1);
    expect(lastEnabledIndex([{ id: 1, name: "唯一", disabled: true }])).toBe(-1);
  });
});

describe("selectedIndexFor（已选项定位）", () => {
  it("按 class_id 定位", () => {
    expect(selectedIndexFor(OPTIONS, 2, -1)).toBe(1);
  });

  it("value 为 null 时定位空值哨兵项（未分班 / 不设置）", () => {
    const withEmpty: SelectableOption[] = [{ id: -1, name: "未分班" }, ...OPTIONS];
    expect(selectedIndexFor(withEmpty, null, -1)).toBe(0);
  });

  it("value 为 undefined 时视为尚未选择 → -1（显示占位文案）", () => {
    expect(selectedIndexFor(OPTIONS, undefined, -1)).toBe(-1);
  });

  it("未命中返回 -1（例如班级已被删除）", () => {
    expect(selectedIndexFor(OPTIONS, 99, -1)).toBe(-1);
  });
});

describe("isClassListUnavailable（#192 单一可用性判据）", () => {
  it("加载失败且无缓存 → 不可用", () => {
    expect(isClassListUnavailable([], true)).toBe(true);
  });

  it("加载失败但仍有旧列表 → 可用（不清空缓存）", () => {
    expect(isClassListUnavailable([{ id: 1, name: "一班" }], true)).toBe(false);
  });

  it("未失败 → 可用", () => {
    expect(isClassListUnavailable([], false)).toBe(false);
  });
});

describe("isClassNameMissing（#192 班级名是否确认不存在）", () => {
  const classes = [{ name: "2025级1班" }];

  it("列表可用且名称未命中 → 确认不存在", () => {
    expect(isClassNameMissing("幽灵班", classes, false)).toBe(true);
  });

  it("名称命中（含首尾空格）→ 不存在判定为 false", () => {
    expect(isClassNameMissing(" 2025级1班 ", classes, false)).toBe(false);
  });

  it("名称留空 → 不判定", () => {
    expect(isClassNameMissing("   ", classes, false)).toBe(false);
  });

  it("列表不可用时不判定，避免误报正确班级名（#182 回归）", () => {
    expect(isClassNameMissing("2025级1班", [], true)).toBe(false);
  });
});
