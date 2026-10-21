import { EVALUATION_COUNT } from "./evaluation-text";

/** 档案完成度三项（#322 / #162）：hero 进度环、资料卡与速览卡共用同一口径 */
export interface ProfileCompletionInput {
  tags: readonly string[];
  avatarUrl: string | null;
  /** 历史上传的评价词云图片；#162 起仅存量展示 */
  evaluationUrl: string | null;
  /** 三条他人评价：填满三条与存量图片任一存在即算完成 */
  evaluationTexts?: readonly string[];
}

export interface ProfileCompletionItem {
  label: "标签" | "头像" | "他人评价";
  done: boolean;
}

export function buildProfileCompletion({
  tags,
  avatarUrl,
  evaluationUrl,
  evaluationTexts,
}: ProfileCompletionInput): ProfileCompletionItem[] {
  const evaluationDone =
    Boolean(evaluationUrl) ||
    (evaluationTexts ?? []).filter((text) => text.trim()).length === EVALUATION_COUNT;
  return [
    { label: "标签", done: tags.length > 0 },
    { label: "头像", done: Boolean(avatarUrl) },
    { label: "他人评价", done: evaluationDone },
  ];
}
