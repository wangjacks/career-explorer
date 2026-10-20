/**
 * 演示占位图渲染（#253）：用 sharp 生成确定性几何图案（无文字，规避 Windows + sharp 的 SVG 字体不稳）。
 * 同一 seedKey（学生编号）→ 同一张图，重置后按新随机名册自然变化。头像 512×512、评价图 1024×768。
 */
import sharp from "sharp";

export type DemoImageKind = "avatar" | "evaluation";

const PALETTE: { bg: string; fg: string; fg2: string }[] = [
  { bg: "#2f855a", fg: "#f6e05e", fg2: "#ffffff" },
  { bg: "#2b6cb0", fg: "#f6ad55", fg2: "#e2e8f0" },
  { bg: "#805ad5", fg: "#4fd1c5", fg2: "#faf5ff" },
  { bg: "#c05621", fg: "#fefcbf", fg2: "#fffaf0" },
  { bg: "#2c7a7b", fg: "#f687b3", fg2: "#e6fffa" },
  { bg: "#b7791f", fg: "#9ae6b4", fg2: "#fffbeb" },
  { bg: "#4a5568", fg: "#63b3ed", fg2: "#edf2f7" },
  { bg: "#9b2c2c", fg: "#fbd38d", fg2: "#fff5f5" },
];

/** FNV-1a 32 位串哈希：把学生编号映射成稳定的形状/配色 */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export async function renderDemoImage(kind: DemoImageKind, seedKey: string): Promise<Buffer> {
  const size = kind === "avatar" ? { w: 512, h: 512 } : { w: 1024, h: 768 };
  const h = fnv1a(seedKey);
  const c = PALETTE[h % PALETTE.length];
  const c2 = PALETTE[(h >>> 3) % PALETTE.length];

  // 由哈希派生的确定性半径/圆心/矩形比例（全部落在画布内）
  const r = size.w * (0.16 + ((h >>> 5) % 12) / 100);
  const cx = size.w * (0.28 + ((h >>> 7) % 44) / 100);
  const cy = size.h * (0.3 + ((h >>> 11) % 40) / 100);
  const rw = size.w * (0.18 + ((h >>> 13) % 26) / 100);
  const rh = size.h * (0.16 + ((h >>> 17) % 24) / 100);
  const rx = size.w * 0.08 + ((h >>> 19) % Math.max(1, Math.floor(size.w - rw - size.w * 0.1)));
  const ry = size.h * 0.08 + ((h >>> 23) % Math.max(1, Math.floor(size.h - rh - size.h * 0.1)));

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size.w}" height="${size.h}">` +
    `<rect width="100%" height="100%" fill="${c.bg}"/>` +
    `<rect x="${rx.toFixed(1)}" y="${ry.toFixed(1)}" width="${rw.toFixed(1)}" height="${rh.toFixed(1)}" fill="${c2.fg}" opacity="0.85"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${r.toFixed(1)}" fill="${c.fg}" opacity="0.9"/>` +
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.45).toFixed(1)}" fill="${c.fg2}" opacity="0.7"/>` +
    `</svg>`;

  return sharp(Buffer.from(svg)).jpeg({ quality: 82 }).toBuffer();
}
