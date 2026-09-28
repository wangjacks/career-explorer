/**
 * 班级邀请海报生成（Issue #102）。
 *
 * 服务端链路：qrcode 生成二维码 SVG → 拼入海报 SVG（班级名称 + 邀请说明）→
 * sharp 栅格化为 PNG。中文渲染依赖系统字体（开发机 Windows 自带微软雅黑；
 * Linux 部署需安装 fonts-noto-cjk，见 DEPLOY.md），SVG 声明多字体回退栈。
 *
 * 安全约定：
 * - 二维码只携带 `{base}/activate?invite=CODE`，激活仍由服务端三要素核验兜底；
 * - 海报不含学生个人信息、管理员凭据或明文邀请码之外的其他敏感数据；
 * - 班级名称等用户输入先做 XML 转义，防止破坏 SVG / 注入。
 *
 * Issue #148：二维码基址必须是学生手机真能访问的地址。Next 未开启
 * experimental.trustHostHeader 时 request.url 的 host 取进程绑定 hostname 而非
 * Host 头，`next start` 无 -H 时恒为 localhost，故生产环境只认 NEXT_PUBLIC_APP_URL；
 * Host / X-Forwarded-Host 可被客户端伪造（钓鱼域名会直接印进海报），不作为可信来源。
 */

import QRCode from "qrcode";
import sharp from "sharp";

export const POSTER_WIDTH = 600;
export const POSTER_HEIGHT = 800;

/** 中文字体回退栈：Windows 开发机 / macOS / Linux（fonts-noto-cjk） */
const FONT_STACK =
  "'Microsoft YaHei','PingFang SC','Noto Sans CJK SC','Noto Sans SC','WenQuanYi Micro Hei',sans-serif";

/** SVG 文本插值前的 XML 转义（班级名称等用户输入） */
export function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * 构建学生激活页邀请链接：`{baseUrl}/activate?invite={code}`。
 * baseUrl 已由 `resolvePosterBaseUrl` 校验归一，此处只去末尾多余斜杠。
 */
export function buildInviteUrl(baseUrl: string, inviteCode: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return `${base}/activate?invite=${encodeURIComponent(inviteCode)}`;
}

/** 学生手机访问不到的绑定地址：生产环境出现即视为配置错误（#148） */
const UNREACHABLE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::", "[::1]", "[::]"]);

/**
 * 校验并归一化基址，错误消息可直接回显给管理员（端点仅 admin/teacher 可达，
 * 且 NEXT_PUBLIC_ 前缀本就是公开值）。只接受协议 + 主机，不接受子路径与凭据。
 */
function normalizeBaseUrl(raw: string, source: string, rejectUnreachable: boolean): string {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(
      `${source} 不是合法 URL：当前值「${raw}」。请填写含协议头的站点根地址，例如 https://career.example.com`
    );
  }
  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error(`${source} 的协议必须是 http 或 https，当前为「${url.protocol}」`);
  }
  if (url.username || url.password) {
    throw new Error(`${source} 不得包含用户名或密码`);
  }
  // 只接受协议 + 主机：多余的斜杠无害（与 buildInviteUrl 的归一一致），子路径则说明填错了地址
  if (!/^\/+$/.test(url.pathname) || url.search || url.hash) {
    throw new Error(`${source} 只能是站点根地址，不能带子路径或查询串，当前为「${raw}」`);
  }
  if (rejectUnreachable && UNREACHABLE_HOSTS.has(url.hostname)) {
    throw new Error(
      `${source} 指向本机地址「${url.hostname}」，学生手机无法访问。生产环境请把 NEXT_PUBLIC_APP_URL 配成公网域名后重启服务`
    );
  }
  return url.origin;
}

/**
 * 解析海报二维码基址（#148）。
 * 生产环境必须显式配置 NEXT_PUBLIC_APP_URL，缺失即抛错而非静默产出 localhost 二维码；
 * 仅非生产模式回退请求 origin（开发时绑定地址就是 localhost，回退可用）。
 */
export function resolvePosterBaseUrl(requestOrigin: string): string {
  // 必须在函数体内读取，否则 vi.stubEnv 无法在测试里切换分支
  const isProduction = process.env.NODE_ENV === "production";
  const configured = (process.env.NEXT_PUBLIC_APP_URL ?? "").trim();

  if (configured) return normalizeBaseUrl(configured, "环境变量 NEXT_PUBLIC_APP_URL", isProduction);

  if (isProduction) {
    throw new Error(
      "海报基址未配置：生产环境必须在 .env.local 设置 NEXT_PUBLIC_APP_URL（站点公网地址，如 https://career.example.com）并重启服务（该变量运行时读取，无需重新构建）"
    );
  }
  return normalizeBaseUrl(requestOrigin, "请求来源", false);
}

export interface InvitePosterOptions {
  className: string;
  inviteCode: string;
  baseUrl: string;
}

/**
 * 生成班级邀请海报 PNG（600×800）。
 * 布局：品牌深绿底 + 班级名称 + 邀请说明 + 二维码 + 底部品牌署名。
 */
export async function generateInvitePoster({
  className,
  inviteCode,
  baseUrl,
}: InvitePosterOptions): Promise<Buffer> {
  const inviteUrl = buildInviteUrl(baseUrl, inviteCode);
  const qrSvg = await QRCode.toString(inviteUrl, {
    type: "svg",
    errorCorrectionLevel: "M",
    margin: 1,
    width: 320,
  });

  const name = escapeXml(className);
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}">
  <rect width="${POSTER_WIDTH}" height="${POSTER_HEIGHT}" fill="#0b3d2e"/>
  <rect x="36" y="36" width="528" height="728" rx="20" fill="#065f46" stroke="#2f8a68" stroke-width="2"/>
  <text x="300" y="128" font-size="42" font-weight="700" fill="#ffffff" text-anchor="middle" font-family="${FONT_STACK}">${name}</text>
  <text x="300" y="182" font-size="22" fill="#a7d7bf" text-anchor="middle" font-family="${FONT_STACK}">学生账户激活邀请</text>
  <g transform="translate(140 250)">${qrSvg}</g>
  <text x="300" y="622" font-size="27" font-weight="600" fill="#ffffff" text-anchor="middle" font-family="${FONT_STACK}">扫码进入激活页</text>
  <text x="300" y="668" font-size="18" fill="#a7d7bf" text-anchor="middle" font-family="${FONT_STACK}">输入学号、姓名与邀请码完成激活</text>
  <text x="300" y="730" font-size="15" fill="#7fb99e" text-anchor="middle" font-family="${FONT_STACK}">Career Explorer · 学生职业探索</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}
