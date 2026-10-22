import { describe, it, expect } from "vitest";
import {
  ASSESSMENT_TYPE_COLORS,
  ASSESSMENT_TYPE_FALLBACK_COLOR,
  BIG_FIVE_BAND_CLASSES,
  BIG_FIVE_BAND_COLORS,
  NOT_ASSESSED_PILL_COLORS,
  typeColorOf,
} from "@/lib/assessment-colors";
import { RIASEC_KEYS } from "@/lib/assessment-match";

/** sRGB 相对亮度（WCAG 2.x） */
function luminance(hex: string): number {
  const value = hex.replace("#", "");
  const channels = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  const linear = channels.map((channel) =>
    channel <= 0.03928 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4
  );
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

function contrastRatio(foreground: string, background: string): number {
  const left = luminance(foreground);
  const right = luminance(background);
  const lighter = Math.max(left, right);
  const darker = Math.min(left, right);
  return (lighter + 0.05) / (darker + 0.05);
}

describe("六型固定配色（#232 约定 / #234 共用）", () => {
  it("六型齐全，颜色值就是 #232 定下的那套（三处共用，改色必须同步）", () => {
    expect(Object.keys(ASSESSMENT_TYPE_COLORS)).toEqual([...RIASEC_KEYS]);
    expect(ASSESSMENT_TYPE_COLORS.R.bar).toBe("#dc2626");
    expect(ASSESSMENT_TYPE_COLORS.I.bar).toBe("#2563eb");
    expect(ASSESSMENT_TYPE_COLORS.A.bar).toBe("#7c3aed");
    expect(ASSESSMENT_TYPE_COLORS.S.bar).toBe("#059669");
    expect(ASSESSMENT_TYPE_COLORS.E.bar).toBe("#f59e0b");
    expect(ASSESSMENT_TYPE_COLORS.C.bar).toBe("#0891b2");
  });

  it("色块上的文字色对比度 ≥ 4.5:1（WCAG AA 正文级，深浅主题都可辨）", () => {
    for (const key of RIASEC_KEYS) {
      const { bar, chipFg } = ASSESSMENT_TYPE_COLORS[key];
      expect(contrastRatio(chipFg, bar), `${key} 徽章对比度不足`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("typeColorOf（三字码 / 单字母取色）", () => {
  it("按首位字母取色，大小写与多余空白都容忍", () => {
    expect(typeColorOf("SIA")).toEqual(ASSESSMENT_TYPE_COLORS.S);
    expect(typeColorOf("s")).toEqual(ASSESSMENT_TYPE_COLORS.S);
    expect(typeColorOf(" ria ")).toEqual(ASSESSMENT_TYPE_COLORS.R);
  });

  it("空值、非 RIASEC 字母、非字符串走兜底，不抛错", () => {
    expect(typeColorOf(null)).toEqual(ASSESSMENT_TYPE_FALLBACK_COLOR);
    expect(typeColorOf(undefined)).toEqual(ASSESSMENT_TYPE_FALLBACK_COLOR);
    expect(typeColorOf("")).toEqual(ASSESSMENT_TYPE_FALLBACK_COLOR);
    expect(typeColorOf("   ")).toEqual(ASSESSMENT_TYPE_FALLBACK_COLOR);
    expect(typeColorOf("XIA")).toEqual(ASSESSMENT_TYPE_FALLBACK_COLOR);
  });

  it("兜底配色的对比度同样达标", () => {
    expect(
      contrastRatio(ASSESSMENT_TYPE_FALLBACK_COLOR.chipFg, ASSESSMENT_TYPE_FALLBACK_COLOR.bar)
    ).toBeGreaterThanOrEqual(4.5);
  });

  it("「未测」灰胶囊在深浅两套主题下对比度都 ≥ 4.5:1", () => {
    // 浅色：bg-gray-100 + text-gray-600；深色：dark:bg-gray-800 + text-gray-400
    // （原来的 text-gray-500 只有 4.39:1，不达 AA，已改深一档）
    for (const scheme of ["light", "dark"] as const) {
      const { bg, fg } = NOT_ASSESSED_PILL_COLORS[scheme];
      expect(contrastRatio(fg, bg), `${scheme} 主题未测胶囊对比度不足`).toBeGreaterThanOrEqual(4.5);
    }
  });
});

describe("大五三档配色（#315 单一靛蓝族）", () => {
  const BANDS = ["low", "medium", "high"] as const;

  it("浅色 / 深色主题下三档对卡片底色的非文本对比度都 ≥ 3:1", () => {
    for (const band of BANDS) {
      expect(contrastRatio(BIG_FIVE_BAND_COLORS.light[band], "#ffffff"), `${band} 浅色对比度不足`).toBeGreaterThanOrEqual(3);
      expect(contrastRatio(BIG_FIVE_BAND_COLORS.dark[band], "#111827"), `${band} 深色对比度不足`).toBeGreaterThanOrEqual(3);
    }
  });

  it("堆叠条的 Tailwind 类与颜色常量一一对应（只改常量不改类会在这里失败）", () => {
    for (const band of BANDS) {
      expect(BIG_FIVE_BAND_CLASSES[band]).toContain(BIG_FIVE_BAND_COLORS.light[band]);
      expect(BIG_FIVE_BAND_CLASSES[band]).toContain(BIG_FIVE_BAND_COLORS.dark[band]);
    }
  });
});