import { describe, it, expect, vi, afterEach } from "vitest";
import sharp from "sharp";
import {
  buildInviteUrl,
  escapeXml,
  generateInvitePoster,
  resolvePosterBaseUrl,
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

describe("resolvePosterBaseUrl（#148 反向代理基址解析）", () => {
  // vi.stubEnv("NODE_ENV", …) 改的是真实进程环境，必须逐例复原
  afterEach(() => vi.unstubAllEnvs());

  it("生产环境未配置 NEXT_PUBLIC_APP_URL → 抛错点名变量，不回退请求 origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(() => resolvePosterBaseUrl("http://localhost:3000")).toThrow(/NEXT_PUBLIC_APP_URL/);
  });

  it("生产环境空串与纯空格视同未配置", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const value of ["", "   ", "\n"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
      expect(() => resolvePosterBaseUrl("https://career.example.com")).toThrow(/海报基址未配置/);
    }
  });

  it("生产环境已配置时使用配置值，忽略请求 origin", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://career.example.com");
    expect(resolvePosterBaseUrl("http://localhost:3000")).toBe("https://career.example.com");
  });

  it("非生产模式回退请求 origin（局域网真机联调），localhost 合法", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(resolvePosterBaseUrl("http://localhost:3000")).toBe("http://localhost:3000");
    expect(resolvePosterBaseUrl("http://192.168.1.20:3000/")).toBe("http://192.168.1.20:3000");
  });

  it("非生产模式同样拒绝非法请求 origin", () => {
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", undefined);
    expect(() => resolvePosterBaseUrl("not-a-url")).toThrow(/请求来源/);
  });

  it("拒绝非法配置值：无协议、非 http(s)、子路径、查询串、凭据", () => {
    vi.stubEnv("NODE_ENV", "production");
    const cases: Array<[string, RegExp]> = [
      ["career.example.com", /不是合法 URL/],
      ["ftp://career.example.com", /协议必须是 http 或 https/],
      ["https://career.example.com/app", /只能是站点根地址/],
      ["https://career.example.com?x=1", /只能是站点根地址/],
      ["https://career.example.com#frag", /只能是站点根地址/],
      ["https://user:pass@career.example.com", /不得包含用户名或密码/],
    ];
    for (const [value, expected] of cases) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", value);
      expect(() => resolvePosterBaseUrl("http://localhost:3000")).toThrow(expected);
    }
  });

  it("生产环境拒绝指向本机的配置值", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const host of ["localhost", "127.0.0.1", "0.0.0.0", "[::1]"]) {
      vi.stubEnv("NEXT_PUBLIC_APP_URL", `http://${host}:3000`);
      expect(() => resolvePosterBaseUrl("https://career.example.com")).toThrow(/学生手机无法访问/);
    }
  });

  it("归一化：小写 host、去默认端口、去尾斜杠", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://Career.Example.COM:443/");
    expect(resolvePosterBaseUrl("http://localhost:3000")).toBe("https://career.example.com");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "http://192.168.1.20:3000//");
    expect(resolvePosterBaseUrl("http://localhost:3000")).toBe("http://192.168.1.20:3000");
  });

  it("解析结果可直接交给 buildInviteUrl 生成激活链接", () => {
    vi.stubEnv("NODE_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://career.example.com/");
    expect(buildInviteUrl(resolvePosterBaseUrl("http://localhost:3000"), "AB23XYZ9")).toBe(
      "https://career.example.com/activate?invite=AB23XYZ9"
    );
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
