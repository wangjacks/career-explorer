/**
 * 上传相关的纯函数（#206）：失败原因文案映射与选图前校验。
 * 客户端与服务端共用，零依赖（不引入 sharp / db），可安全被客户端组件引用。
 */

/** 网络层失败（fetch 抛错，拿不到状态码）的统一文案 */
export const UPLOAD_NETWORK_ERROR_MESSAGE = "上传中断，请检查网络后重试";

/** 服务端 500 分支的兜底文案（拿不到可细分原因时） */
export const UPLOAD_FAILED_MESSAGE = "上传失败，请稍后重试";

/** 格式不支持时的文案；与 IMAGE_FORMAT_HINT 保持一致口径 */
export const UPLOAD_UNSUPPORTED_FORMAT_MESSAGE = "图片格式不支持，请改用 JPG / PNG 后重试";

/** 提示文案里出现的格式举例（仅用于「改用哪种格式」的建议） */
const IMAGE_FORMAT_HINT = "JPG / PNG";

/** 服务端 JSON 响应里的 error 字段；非 JSON（如反向代理返回 HTML）或无 error 时返回 null */
function parseServerError(bodyText: string): string | null {
  if (!bodyText) return null;
  try {
    const data = JSON.parse(bodyText) as { error?: unknown };
    return typeof data?.error === "string" && data.error ? data.error : null;
  } catch {
    return null;
  }
}

/**
 * 上传失败响应 → 学生可读文案。
 * 优先用服务端 error 原文：服务端文案已是可行动口径（如「图片大小不能超过 5MB」）。
 * 反向代理 / 网关会在应用之前拦截，返回的是 HTML 而非 JSON，那里没有 error 字段，
 * 只能按状态码给出等价口径——但**不把代理配置细节写进学生提示**，那些进审计与 DEPLOY。
 */
export function mapUploadFailure(status: number, bodyText: string): string {
  const fromServer = parseServerError(bodyText);
  if (fromServer) return fromServer;
  if (status === 413) return "图片过大，服务器拒绝接收，请压缩后重试";
  if (status === 502 || status === 503 || status === 504) return "上传服务暂时不可用，请稍后重试";
  return `图片上传失败（HTTP ${status}），请稍后重试`;
}

/** 选图前校验只用到这两个字段（File 天然满足，测试可直接构造字面量） */
export interface ImageFileLike {
  type: string;
  size: number;
}

export type ImageFileCheck = { ok: true } | { ok: false; message: string };

/** 字节 → MB（一位小数，仅用于提示文案） */
function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/**
 * 选图前校验（客户端预检，服务端校验仍是最终防线）。
 * type 只判 `image/` 前缀、**不收窄格式**：浏览器对 HEIC 常给空 type，
 * 格式能否解码由服务端 sharp 定论（#206 决策：先不改格式口径）。
 * maxSizeMb 缺省（调用方拿不到配置）时跳过体积判断，不因配置缺失拦住学生。
 */
export function validateImageFile(file: ImageFileLike, maxSizeMb?: number): ImageFileCheck {
  if (!file.type.startsWith("image/")) {
    return { ok: false, message: `无法识别该文件类型，请选择 ${IMAGE_FORMAT_HINT} 图片` };
  }
  if (maxSizeMb !== undefined && file.size > maxSizeMb * 1024 * 1024) {
    return { ok: false, message: `图片大小 ${formatMb(file.size)}，超过上限 ${maxSizeMb}MB` };
  }
  return { ok: true };
}

/**
 * sharp 解码失败的特征（服务端据此把 500 细分为「格式不支持」）。
 * 只认「格式不支持」这一类文案，**不含 "input buffer"**：请求体被截断时 sharp 也会报
 * input buffer 相关错误，把它算成格式问题会把「链路截断」误导向「换格式」；
 * 截断与格式的区分留给审计里的 sharp 原文（分段/损坏头会写得很清楚）。
 */
export function isUnsupportedFormatError(message: string): boolean {
  const m = message.toLowerCase();
  return m.includes("unsupported image format") || m.includes("unsupported format");
}
