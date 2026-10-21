import { describe, it, expect } from "vitest";
import {
  chartAriaLabel,
  heroCompletionText,
  profileStickyAction,
  type ProfileStickyActionInput,
} from "@/lib/profile-ui";

/**
 * 「我的档案」期 3（#324）纯函数用例：移动端 sticky 操作条状态与图表 aria 文案。
 * 仓库没有 DOM 测试环境，交互判定先落纯函数再测（与 #322/#323 同一做法）。
 */

const base: ProfileStickyActionInput = {
  hasSubmitted: true,
  editing: false,
  activeView: "profile",
  submissionClosed: false,
  submissionDeadline: "2026-10-01 23:59",
};

describe("profileStickyAction（移动端底部「修改数据」）", () => {
  it("已归档 + 非编辑 + 我的档案视图 → 显示且可用", () => {
    expect(profileStickyAction(base)).toEqual({ visible: true, disabled: false, hint: null });
  });

  it("未归档 / 编辑态 / 其它视图 → 不显示（不抢别的视图的主操作）", () => {
    expect(profileStickyAction({ ...base, hasSubmitted: false }).visible).toBe(false);
    expect(profileStickyAction({ ...base, editing: true }).visible).toBe(false);
    expect(profileStickyAction({ ...base, activeView: "history" }).visible).toBe(false);
    expect(profileStickyAction({ ...base, activeView: "group" }).visible).toBe(false);
  });

  it("提交截止 → 仍然显示但置灰，并给出截止时间（入口不消失，避免以为界面坏了）", () => {
    expect(profileStickyAction({ ...base, submissionClosed: true })).toEqual({
      visible: true,
      disabled: true,
      hint: "档案提交已于 2026-10-01 23:59 截止",
    });
    // 截止时间未知时也要有可读提示
    expect(profileStickyAction({ ...base, submissionClosed: true, submissionDeadline: null }).hint).toBe(
      "档案提交已截止"
    );
  });
});

describe("chartAriaLabel（雷达图的读屏文案）", () => {
  it("把每一维的整数分写进 aria-label，读屏不只听到「一张图」", () => {
    const label = chartAriaLabel("六型兴趣得分雷达图", [
      { label: "现实型", standard: 82.4 },
      { label: "研究型", standard: 65.6 },
      { label: "艺术型", standard: 40 },
    ]);
    expect(label).toBe("六型兴趣得分雷达图：现实型 82 分、研究型 66 分、艺术型 40 分");
  });

  it("无顶点时退化为系列名，不产生悬空标点", () => {
    expect(chartAriaLabel("五大人格得分雷达图", [])).toBe("五大人格得分雷达图");
  });
});

describe("heroCompletionText（移动端 hero 完整度收纳）", () => {
  it("输出 x/3 文案，并对越界值钳制", () => {
    expect(heroCompletionText(0)).toBe("资料完整度 0/3");
    expect(heroCompletionText(2)).toBe("资料完整度 2/3");
    expect(heroCompletionText(5)).toBe("资料完整度 3/3");
    expect(heroCompletionText(-1)).toBe("资料完整度 0/3");
  });
});
