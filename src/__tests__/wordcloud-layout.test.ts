import { describe, expect, it } from "vitest";
import { buildWordCloudLayout } from "../lib/wordcloud-layout";

const WORDS = [
  { text: "沟通", weight: 3 },
  { text: "认真", weight: 2 },
  { text: "负责", weight: 1 },
  { text: "合作", weight: 1 },
  { text: "耐心", weight: 1 },
];

describe("wordcloud-layout（#162）", () => {
  it("相同输入与容器尺寸得到相同布局（无随机数）", () => {
    expect(buildWordCloudLayout(WORDS, 640, 300)).toEqual(
      buildWordCloudLayout(WORDS, 640, 300)
    );
  });

  it("所有落位词都在容器内", () => {
    const placed = buildWordCloudLayout(WORDS, 640, 300);
    expect(placed.length).toBeGreaterThan(0);
    for (const word of placed) {
      expect(word.left).toBeGreaterThanOrEqual(0);
      expect(word.left).toBeLessThanOrEqual(640);
      expect(word.top).toBeGreaterThanOrEqual(0);
      expect(word.top).toBeLessThanOrEqual(300);
    }
  });

  it("高权重词字号不小于低权重词", () => {
    const placed = buildWordCloudLayout(WORDS, 640, 300);
    const highest = placed.find((word) => word.text === "沟通");
    const lowest = placed.find((word) => word.text === "耐心");
    expect(highest).toBeDefined();
    expect(lowest).toBeDefined();
    expect(highest!.fontSize).toBeGreaterThanOrEqual(lowest!.fontSize);
  });

  it("空词表 / 零尺寸直接返回空数组", () => {
    expect(buildWordCloudLayout([], 640, 300)).toEqual([]);
    expect(buildWordCloudLayout(WORDS, 0, 300)).toEqual([]);
    expect(buildWordCloudLayout(WORDS, 640, 0)).toEqual([]);
  });

  it("字号受选项约束（宽容器下不越界）", () => {
    const placed = buildWordCloudLayout(WORDS, 640, 300, {
      minFontSize: 12,
      maxFontSize: 30,
    });
    for (const word of placed) {
      expect(word.fontSize).toBeGreaterThanOrEqual(12);
      expect(word.fontSize).toBeLessThanOrEqual(30);
    }
  });

  it("窄容器不放宽到出界；放不下的词最多被跳过", () => {
    const placed = buildWordCloudLayout(WORDS, 160, 120);
    expect(placed.length).toBeLessThanOrEqual(WORDS.length);
    for (const word of placed) {
      expect(word.left).toBeGreaterThanOrEqual(0);
      expect(word.left).toBeLessThanOrEqual(160);
      expect(word.top).toBeGreaterThanOrEqual(0);
      expect(word.top).toBeLessThanOrEqual(120);
    }
  });
});
