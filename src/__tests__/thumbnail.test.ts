import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  getThumbnailKey,
  isThumbnailKey,
  getSourceKey,
  toThumbnailUrl,
  createThumbnail,
  AVATAR_THUMB_SIZE,
  EVALUATION_THUMB_WIDTH,
} from "../lib/thumbnail";
import { validateObjectKey } from "../lib/storage";

/** 生成指定尺寸的测试用 JPEG buffer */
async function makeJpeg(width: number, height: number): Promise<Buffer> {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 120, b: 40 } } })
    .jpeg()
    .toBuffer();
}

describe("缩略图 key 派生（#118）", () => {
  it("getThumbnailKey：{base}.jpg → {base}_thumb.jpg；非 .jpg 原样返回", () => {
    expect(getThumbnailKey("avatar_202505050101_20260826120000_ab12.jpg")).toBe(
      "avatar_202505050101_20260826120000_ab12_thumb.jpg"
    );
    expect(getThumbnailKey("eval_123.png")).toBe("eval_123.png");
  });

  it("isThumbnailKey / getSourceKey 往返一致", () => {
    const key = "avatar_202505050101_20260826120000_ab12.jpg";
    const thumb = getThumbnailKey(key);
    expect(isThumbnailKey(thumb)).toBe(true);
    expect(getSourceKey(thumb)).toBe(key);
    expect(isThumbnailKey(key)).toBe(false);
    expect(getSourceKey(key)).toBeNull();
  });

  it("派生 key 仍通过 validateObjectKey（安全字符集，无路径分隔符）", () => {
    const thumb = getThumbnailKey("avatar_202505050101_20260826120000_ab12.jpg");
    expect(() => validateObjectKey(thumb)).not.toThrow();
  });

  it("toThumbnailUrl：兼容本地代理路径 / 裸 key / 查询参数保留", () => {
    expect(toThumbnailUrl("/api/uploads/avatar_123.jpg")).toBe("/api/uploads/avatar_123_thumb.jpg");
    expect(toThumbnailUrl("avatar_123.jpg")).toBe("avatar_123_thumb.jpg");
    expect(toThumbnailUrl("/api/uploads/avatar_123.jpg?t=1")).toBe("/api/uploads/avatar_123_thumb.jpg?t=1");
    expect(toThumbnailUrl("avatar_123.jpg?t=1")).toBe("avatar_123_thumb.jpg?t=1");
  });
});

describe("createThumbnail（#118）", () => {
  it("头像：居中裁剪为 120×120", async () => {
    const thumb = await createThumbnail(await makeJpeg(512, 512), "avatar");
    const meta = await sharp(thumb).metadata();
    expect(meta.width).toBe(AVATAR_THUMB_SIZE);
    expect(meta.height).toBe(AVATAR_THUMB_SIZE);
  });

  it("词云：长边 240px 保持宽高比（横向图）", async () => {
    const thumb = await createThumbnail(await makeJpeg(800, 600), "evaluation");
    const meta = await sharp(thumb).metadata();
    expect(meta.width).toBe(EVALUATION_THUMB_WIDTH);
    expect(meta.height).toBe(180);
  });

  it("词云：纵向图长边为高，且小图不放大", async () => {
    // 纵向 300×600 → 长边 240 → 120×240
    const vertical = await createThumbnail(await makeJpeg(300, 600), "evaluation");
    const vMeta = await sharp(vertical).metadata();
    expect(vMeta.width).toBe(120);
    expect(vMeta.height).toBe(EVALUATION_THUMB_WIDTH);
    // 已小于 240 的图不放大
    const small = await createThumbnail(await makeJpeg(100, 50), "evaluation");
    const sMeta = await sharp(small).metadata();
    expect(sMeta.width).toBe(100);
    expect(sMeta.height).toBe(50);
  });
});
