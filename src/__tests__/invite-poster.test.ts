import { describe, it, expect } from "vitest";
import sharp from "sharp";
import {
  buildInviteUrl,
  escapeXml,
  generateInvitePoster,
  POSTER_HEIGHT,
  POSTER_WIDTH,
} from "@/lib/invite-poster";

const PNG_SIGNATURE = "89504e470d0a1a0a";

describe("buildInviteUrl（二维码参数）", () => {
  it("生成 /activate?invite=CODE 链接", () => {
    expect(buildInviteUrl("https://career.example.com", "AB23XYZ9")).toBe(
      "https://career.example.com/activate?invite=AB23XYZ9"
    );
  });

  it("归一 baseUrl 末尾斜杠", () => {
    expect(buildInviteUrl("https://career.example.com/", "AB23XYZ9")).toBe(
      "https://career.example.com/activate?invite=AB23XYZ9"
    );
    expect(buildInviteUrl("https://career.example.com//", "AB23XYZ9")).toBe(
      "https://career.example.com/activate?invite=AB23XYZ9"
    );
  });

  it("邀请码经 URL 编码，不携带其他敏感参数", () => {
    expect(buildInviteUrl("https://career.example.com", "A B&")).toBe(
      "https://career.example.com/activate?invite=A%20B%26"
    );
    expect(buildInviteUrl("https://career.example.com", "AB23XYZ9")).not.toContain("password");
    expect(buildInviteUrl("https://career.example.com", "AB23XYZ9")).not.toContain("token");
  });
});

describe("escapeXml（海报文本注入防护）", () => {
  it("转义 XML 特殊字符", () => {
    expect(escapeXml(`<班级 & "引号" '撇号'>`)).toBe(
      "&lt;班级 &amp; &quot;引号&quot; &apos;撇号&apos;&gt;"
    );
  });
});

describe("generateInvitePoster（服务端海报 PNG）", () => {
  it("输出合法 PNG 且尺寸为 600×800", async () => {
    const buf = await generateInvitePoster({
      className: "2026级1班",
      inviteCode: "AB23XYZ9",
      baseUrl: "https://career.example.com",
    });
    expect(buf.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
    const meta = await sharp(buf).metadata();
    expect(meta.width).toBe(POSTER_WIDTH);
    expect(meta.height).toBe(POSTER_HEIGHT);
  });

  it("邀请码不同则二维码区域内容不同（旧码作废后重新生成才有效）", async () => {
    const a = await generateInvitePoster({
      className: "2026级1班",
      inviteCode: "AB23XYZ9",
      baseUrl: "https://career.example.com",
    });
    const b = await generateInvitePoster({
      className: "2026级1班",
      inviteCode: "CD45WXYZ",
      baseUrl: "https://career.example.com",
    });
    expect(a.equals(b)).toBe(false);
  });

  it("班级名称含 XML 特殊字符仍可正常生成", async () => {
    const buf = await generateInvitePoster({
      className: `<2026&"1班">`,
      inviteCode: "AB23XYZ9",
      baseUrl: "https://career.example.com",
    });
    expect(buf.subarray(0, 8).toString("hex")).toBe(PNG_SIGNATURE);
  });
});
