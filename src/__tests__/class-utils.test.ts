import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/db", () => ({
  getClassByName: vi.fn(),
}));

import { resolveClassByName } from "@/lib/class-utils";
import { getClassByName } from "@/lib/db";

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
