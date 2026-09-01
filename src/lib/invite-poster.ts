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
 * baseUrl 来自 NEXT_PUBLIC_APP_URL 或请求 origin，末尾多余斜杠会被归一。
 */
export function buildInviteUrl(baseUrl: string, inviteCode: string): string {
  const base = baseUrl.trim().replace(/\/+$/, "");
  return `${base}/activate?invite=${encodeURIComponent(inviteCode)}`;
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
