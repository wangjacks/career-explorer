/**
 * 词云确定性布局（#162）。
 *
 * 纯函数、无 DOM：按权重排序后从中心向外螺旋避让，相同输入与容器尺寸得到相同布局。
 * 不旋转、不使用随机数；放不下的词先缩小字号，仍放不下则跳过。
 */
import type { WordCloudItem } from "@/types";

export interface PlacedWord {
  text: string;
  fontSize: number;
  left: number;
  top: number;
}

export interface WordCloudLayoutOptions {
  minFontSize?: number;
  maxFontSize?: number;
  padding?: number;
  maxSteps?: number;
}

interface Box {
  left: number;
  top: number;
  right: number;
  bottom: number;
}

function charWidth(char: string, fontSize: number): number {
  const code = char.codePointAt(0) ?? 0;
  if (code === 32) return fontSize * 0.3;
  if (
    (code >= 0x2e80 && code <= 0x9fff) ||
    (code >= 0xac00 && code <= 0xd7af) ||
    (code >= 0xff00 && code <= 0xffef)
  ) {
    return fontSize;
  }
  return fontSize * 0.6;
}

function measureWord(text: string, fontSize: number): { width: number; height: number } {
  let width = 0;
  for (const char of text) width += charWidth(char, fontSize);
  return { width, height: fontSize * 1.15 };
}

function overlaps(a: Box, b: Box): boolean {
  return !(a.right < b.left || a.left > b.right || a.bottom < b.top || a.top > b.bottom);
}

function tryPlace(
  text: string,
  fontSize: number,
  width: number,
  height: number,
  padding: number,
  maxSteps: number,
  placedBoxes: Box[]
): { left: number; top: number } | null {
  const size = measureWord(text, fontSize);
  const centerX = width / 2;
  const centerY = height / 2;

  for (let step = 0; step < maxSteps; step += 1) {
    const angle = step * 0.5;
    const radius = step === 0 ? 0 : 3 + step * 1.1;
    // 椭圆螺旋：横向略拉伸，更适合宽幅卡片
    const x = centerX + Math.cos(angle) * radius * 1.25;
    const y = centerY + Math.sin(angle) * radius * 0.8;

    const box: Box = {
      left: x - size.width / 2 - padding,
      right: x + size.width / 2 + padding,
      top: y - size.height / 2 - padding,
      bottom: y + size.height / 2 + padding,
    };
    if (box.left < 0 || box.top < 0 || box.right > width || box.bottom > height) continue;
    if (placedBoxes.some((placed) => overlaps(box, placed))) continue;
    return { left: x, top: y };
  }
  return null;
}

/**
 * @param words 已按优先级排好或未排序均可；函数内部会按 weight 降序、文本升序稳定排序
 * @param width 容器宽度（px）
 * @param height 容器高度（px）
 */
export function buildWordCloudLayout(
  words: readonly WordCloudItem[],
  width: number,
  height: number,
  options: WordCloudLayoutOptions = {}
): PlacedWord[] {
  if (words.length === 0 || width <= 0 || height <= 0) return [];

  const padding = options.padding ?? 4;
  const maxSteps = options.maxSteps ?? 600;
  const sorted = [...words].sort(
    (a, b) => b.weight - a.weight || a.text.localeCompare(b.text, "zh-CN")
  );

  const widthScale = Math.min(1, Math.max(0.55, width / 640));
  const maxFont = Math.max(16, Math.round((options.maxFontSize ?? 40) * widthScale));
  const minFont = Math.max(11, Math.round((options.minFontSize ?? 15) * widthScale));
  const highestWeight = Math.max(...sorted.map((word) => word.weight));
  const lowestWeight = Math.min(...sorted.map((word) => word.weight));
  const allEqual = highestWeight === lowestWeight;

  const placed: PlacedWord[] = [];
  const placedBoxes: Box[] = [];

  sorted.forEach((word, index) => {
    const weightRatio = allEqual
      ? 1 - index / Math.max(1, sorted.length - 1)
      : (word.weight - lowestWeight) / Math.max(1, highestWeight - lowestWeight);
    const targetSize = Math.round(minFont + (maxFont - minFont) * weightRatio);

    for (let fontSize = targetSize; fontSize >= minFont; fontSize -= 2) {
      const position = tryPlace(
        word.text,
        fontSize,
        width,
        height,
        padding,
        maxSteps,
        placedBoxes
      );
      if (!position) continue;
      const size = measureWord(word.text, fontSize);
      placed.push({ text: word.text, fontSize, left: position.left, top: position.top });
      placedBoxes.push({
        left: position.left - size.width / 2 - padding,
        right: position.left + size.width / 2 + padding,
        top: position.top - size.height / 2 - padding,
        bottom: position.top + size.height / 2 + padding,
      });
      break;
    }
  });

  return placed;
}
