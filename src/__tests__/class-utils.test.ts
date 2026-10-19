import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  getClassByName: vi.fn(),
}));

import { resolveClassByName } from "@/lib/class-utils";
import { getClassByName } from "@/lib/db";
import { normalizeClassName, resolveClassNames } from "@/lib/class-utils";

describe("resolveClassByName（#160 班级名解析口径）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("未提交 / null / 纯空白 → provided=false，且不查询班级表", async () => {
    expect(await resolveClassByName(undefined)).toEqual({
      provided: false,
      className: "",
      classId: null,
    });
    expect(await resolveClassByName(null)).toEqual({
      provided: false,
      className: "",
      classId: null,
    });
    expect(await resolveClassByName("   ")).toEqual({
      provided: false,
      className: "",
      classId: null,
    });
    expect(getClassByName).not.toHaveBeenCalled();
  });

  it("去首尾空格后命中 → 返回班级 id", async () => {
    vi.mocked(getClassByName).mockResolvedValue({ id: 7, name: "2025级1班" } as never);

    expect(await resolveClassByName(" 2025级1班 ")).toEqual({
      provided: true,
      className: "2025级1班",
      classId: 7,
    });
    expect(getClassByName).toHaveBeenCalledWith("2025级1班");
  });

  it("未命中 → provided=true、classId=null（调用方据此给出明确反馈而不是静默不绑）", async () => {
    vi.mocked(getClassByName).mockResolvedValue(undefined as never);

    expect(await resolveClassByName("不存在的班级")).toEqual({
      provided: true,
      className: "不存在的班级",
      classId: null,
    });
  });
});

describe("normalizeClassName（归一化唯一入口）", () => {
  it("仅去首尾空白，不做大小写 / 全半角折叠", () => {
    expect(normalizeClassName(" 2025级1班 ")).toBe("2025级1班");
    expect(normalizeClassName("a班")).toBe("a班");
    expect(normalizeClassName("Ａ班")).toBe("Ａ班");
    expect(normalizeClassName(null)).toBe("");
    expect(normalizeClassName(undefined)).toBe("");
  });
});

describe("resolveClassNames（#193 批量导入去重解析）", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("同名（含仅空格差异）只解析一次，查库次数等于去重后的名称数；结果与入参一一对应", async () => {
    vi.mocked(getClassByName).mockImplementation(async (name: string) =>
      name === "2025级1班" ? ({ id: 7, name: "2025级1班" } as never) : (undefined as never)
    );

    const resolutions = await resolveClassNames([
      "2025级1班",
      " 2025级1班 ",
      "幽灵班",
      "幽灵班",
      " 幽灵班",
    ]);

    expect(getClassByName).toHaveBeenCalledTimes(2);
    expect(getClassByName).toHaveBeenCalledWith("2025级1班");
    expect(getClassByName).toHaveBeenCalledWith("幽灵班");
    expect(resolutions).toHaveLength(5);
    expect(resolutions[0]).toEqual({ provided: true, className: "2025级1班", classId: 7 });
    expect(resolutions[1]).toEqual({ provided: true, className: "2025级1班", classId: 7 });
    expect(resolutions[2]).toEqual({ provided: true, className: "幽灵班", classId: null });
    // 不依赖「调用方用同一字段查询」：查不中的路径在类型上已不存在
  });

  it("空名单与纯空白名称都不查库，按未提交返回且位置保持", async () => {
    expect(await resolveClassNames([])).toEqual([]);
    expect(getClassByName).not.toHaveBeenCalled();

    const blank = await resolveClassNames(["   ", null]);
    expect(getClassByName).not.toHaveBeenCalled();
    expect(blank).toEqual([
      { provided: false, className: "", classId: null },
      { provided: false, className: "", classId: null },
    ]);
  });
});
