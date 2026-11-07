/**
 * 档案提交共享工具：头像上传 + 档案保存（确认后一次性执行）。
 * 评价为三条文字，直接随档案提交；仅新选头像才上传，未重选沿用原 URL。
 */

import { UPLOAD_NETWORK_ERROR_MESSAGE, mapUploadFailure } from "@/lib/upload-utils";

/** 上传成功但响应体不可用（代理返回 200 HTML、字段缺失等） */
const UPLOAD_MALFORMED_RESPONSE_MESSAGE = "上传返回异常，请稍后重试";

async function uploadAvatar(file: File, studentId: string): Promise<{ url: string; storageId: number | null }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("prefix", "avatar");
  formData.append("studentId", studentId);

  let res: Response;
  try {
    res = await fetch("/api/upload", { method: "POST", body: formData });
  } catch (err) {
    // fetch 只在网络层失败时抛错（断网、超时、连接被重置）：此时没有状态码，
    // 原先这条路径会抛出 "Failed to fetch" 这样的原始 TypeError，学生看不懂
    console.error("Upload request failed:", err);
    throw new Error(UPLOAD_NETWORK_ERROR_MESSAGE);
  }

  // 失败原因按文本读：反向代理/网关会返回 HTML（413 等），直接 res.json() 会抛 SyntaxError
  // 并把真实状态码丢掉——#206 的核心症状就是「所有失败都说成图片上传失败」
  if (!res.ok) {
    throw new Error(mapUploadFailure(res.status, await res.text().catch(() => "")));
  }

  let data: { url?: unknown; storageId?: unknown } | null = null;
  try {
    data = (await res.json()) as { url?: unknown; storageId?: unknown };
  } catch (err) {
    console.error("Upload response parse error:", err);
  }
  if (!data || typeof data.url !== "string" || !data.url) {
    throw new Error(UPLOAD_MALFORMED_RESPONSE_MESSAGE);
  }
  return { url: `${data.url}?t=${Date.now()}`, storageId: typeof data.storageId === "number" ? data.storageId : null };
}

export interface SubmitProfileInput {
  /** 学生编号（仅用于上传文件命名，取自会话） */
  studentId: string;
  tags: string[];
  avatarFile?: File | null;
  /** 未重选时沿用的原图 URL */
  existingAvatarUrl?: string;
  /** 三条他人评价（顺序固定） */
  evaluationTexts: string[];
}

export interface SubmitProfileResult {
  avatarUrl: string;
}

export async function submitProfile(input: SubmitProfileInput): Promise<SubmitProfileResult> {
  // 仅新选头像才上传；文件所在后端以本次上传返回为准，未重选不传（服务端保留原值）
  const uploadedAvatar = input.avatarFile
    ? await uploadAvatar(input.avatarFile, input.studentId)
    : null;
  const avatarUrl = uploadedAvatar ? uploadedAvatar.url : input.existingAvatarUrl || "";
  const storageId = uploadedAvatar?.storageId ?? null;

  const res = await fetch("/api/shared/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      tags: input.tags,
      avatarUrl,
      evaluationTexts: input.evaluationTexts,
      storageId,
    }),
  });
  if (!res.ok) {
    let message = "保存失败";
    try {
      const data = await res.json();
      if (data?.error) message = data.error;
    } catch {
      // 响应体非 JSON 时使用默认文案
    }
    throw new Error(message);
  }
  return { avatarUrl };
}
