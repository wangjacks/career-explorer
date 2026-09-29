import { describe, it, expect } from "vitest";
import {
  UPLOAD_FAILED_MESSAGE,
  UPLOAD_NETWORK_ERROR_MESSAGE,
  UPLOAD_UNSUPPORTED_FORMAT_MESSAGE,
  isUnsupportedFormatError,
  mapUploadFailure,
  validateImageFile,
} from "../lib/upload-utils";

const MB = 1024 * 1024;

describe("mapUploadFailure", () => {
  it("服务端 JSON 的 error 原文优先透传", () => {
    expect(mapUploadFailure(400, JSON.stringify({ error: "图片大小不能超过 5MB" }))).toBe(
      "图片大小不能超过 5MB"
    );
    expect(mapUploadFailure(500, JSON.stringify({ error: "存储后端未初始化" }))).toBe(
      "存储后端未初始化"
    );
  });

  it("反向代理的 413（HTML 正文，无 error 字段）给可行动文案", () => {
    const html = "<html><head><title>413 Request Entity Too Large</title></head></html>";
    expect(mapUploadFailure(413, html)).toBe("图片过大，服务器拒绝接收，请压缩后重试");
    // 提示里不得出现代理配置名（nginx / client_max_body_size 只在文档与审计里）
    expect(mapUploadFailure(413, html)).not.toMatch(/nginx|client_max_body_size/i);
  });

  it("网关类状态码提示稍后重试", () => {
    for (const status of [502, 503, 504]) {
      expect(mapUploadFailure(status, "<html>gateway</html>")).toBe(
        "上传服务暂时不可用，请稍后重试"
      );
    }
  });

  it("拿不到原因时走通用兜底，不回显 HTML 也不暴露状态码", () => {
    const msg = mapUploadFailure(500, "<html><body>Internal Server Error</body></html>");
    expect(msg).toBe(UPLOAD_FAILED_MESSAGE);
    expect(msg).not.toContain("<");
    // #206 验收：非 JSON 响应只给可行动文案，状态码留给 Network 与审计
    expect(msg).not.toMatch(/HTTP|[45]\d{2}/);
  });

  it("空正文 / 非对象 JSON / 缺 error 字段都走兜底", () => {
    expect(mapUploadFailure(500, "")).toBe(UPLOAD_FAILED_MESSAGE);
    expect(mapUploadFailure(500, "null")).toBe(UPLOAD_FAILED_MESSAGE);
    expect(mapUploadFailure(500, JSON.stringify({ message: "nope" }))).toBe(UPLOAD_FAILED_MESSAGE);
    expect(mapUploadFailure(400, JSON.stringify({ error: "" }))).toBe(UPLOAD_FAILED_MESSAGE);
    expect(mapUploadFailure(520, "<html>origin unreachable</html>")).toBe(UPLOAD_FAILED_MESSAGE);
  });

  it("网络层文案是独立常量", () => {
    expect(UPLOAD_NETWORK_ERROR_MESSAGE).toBe("上传中断，请检查网络后重试");
  });
});

describe("validateImageFile", () => {
  it("不可识别的类型给出格式建议（HEIC 在部分浏览器是空 type）", () => {
    expect(validateImageFile({ type: "", size: 1024 })).toEqual({
      ok: false,
      message: "无法识别该文件类型，请选择 JPG / PNG 图片",
    });
    expect(validateImageFile({ type: "text/plain", size: 1024 }).ok).toBe(false);
  });

  it("不收窄格式：image/heic 仍放行（解码交服务端定论）", () => {
    expect(validateImageFile({ type: "image/heic", size: 1024 })).toEqual({ ok: true });
    expect(validateImageFile({ type: "image/jpeg", size: 1024 })).toEqual({ ok: true });
  });

  it("体积边界：恰好等于上限放行，超 1 字节拒绝", () => {
    expect(validateImageFile({ type: "image/png", size: 5 * MB }, 5)).toEqual({ ok: true });
    expect(validateImageFile({ type: "image/png", size: 5 * MB + 1 }, 5)).toEqual({
      ok: false,
      message: "图片大小 5.0MB，超过上限 5MB",
    });
  });

  it("拿不到配置（maxSizeMb 缺省）时跳过体积判断", () => {
    expect(validateImageFile({ type: "image/jpeg", size: 99 * MB })).toEqual({ ok: true });
  });

  it("类型先于体积判断：两者都不满足时提示类型问题", () => {
    expect(validateImageFile({ type: "video/mp4", size: 99 * MB }, 5)).toEqual({
      ok: false,
      message: "无法识别该文件类型，请选择 JPG / PNG 图片",
    });
  });
});

describe("isUnsupportedFormatError", () => {
  it("识别 sharp 的格式不支持文案", () => {
    expect(isUnsupportedFormatError("Input buffer contains unsupported image format")).toBe(true);
    expect(isUnsupportedFormatError("unsupported format")).toBe(true);
    expect(isUnsupportedFormatError("UNSUPPORTED IMAGE FORMAT")).toBe(true);
  });

  it("不把截断 / 损坏头 / 其它故障误判为格式问题", () => {
    expect(isUnsupportedFormatError("Input buffer has corrupt header")).toBe(false);
    expect(isUnsupportedFormatError("unexpected end of file")).toBe(false);
    expect(isUnsupportedFormatError("connect ETIMEDOUT")).toBe(false);
    expect(isUnsupportedFormatError("")).toBe(false);
  });

  it("面向学生的格式文案不含实现细节", () => {
    expect(UPLOAD_UNSUPPORTED_FORMAT_MESSAGE).toBe("图片格式不支持，请改用 JPG / PNG 后重试");
  });
});
