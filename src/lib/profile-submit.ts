/**
 * 档案提交共享工具：图片上传 + 档案保存（确认后一次性执行）。
 * 确认页（表单流程）与学生面板就地修改共用，行为一致：
 * 仅新选图片才上传，未重选沿用原 URL；档案保存走会话身份，不显式传学号。
 */

async function uploadImage(file: File, prefix: "avatar" | "evaluation", studentId: string): Promise<{ url: string; storageId: number | null }> {
  const formData = new FormData();
  formData.append("file", file);
  formData.append("prefix", prefix);
  formData.append("studentId", studentId);
  const res = await fetch("/api/upload", { method: "POST", body: formData });
  if (!res.ok) throw new Error("图片上传失败");
  const data = await res.json();
  return { url: `${data.url}?t=${Date.now()}`, storageId: typeof data.storageId === "number" ? data.storageId : null };
}

export interface SubmitProfileInput {
  /** 学生编号（仅用于上传文件命名，取自会话） */
  studentId: string;
  tags: string[];
  avatarFile?: File | null;
  evaluationFile?: File | null;
  /** 未重选时沿用的原图 URL */
  existingAvatarUrl?: string;
  existingEvaluationUrl?: string;
}

export interface SubmitProfileResult {
  avatarUrl: string;
  evaluationUrl: string;
}

export async function submitProfile(input: SubmitProfileInput): Promise<SubmitProfileResult> {
  // 仅新选图片才上传；文件所在后端以本次上传返回为准，未重选不传（服务端保留原值）
  const uploadedEvaluation = input.evaluationFile
    ? await uploadImage(input.evaluationFile, "evaluation", input.studentId)
    : null;
  const uploadedAvatar = input.avatarFile
    ? await uploadImage(input.avatarFile, "avatar", input.studentId)
    : null;
  const evaluationUrl = uploadedEvaluation
    ? uploadedEvaluation.url
    : input.existingEvaluationUrl || "";
  const avatarUrl = uploadedAvatar ? uploadedAvatar.url : input.existingAvatarUrl || "";
  const storageId = uploadedEvaluation?.storageId ?? uploadedAvatar?.storageId ?? null;

  const res = await fetch("/api/shared/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ tags: input.tags, avatarUrl, evaluationUrl, storageId }),
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
  return { avatarUrl, evaluationUrl };
}
