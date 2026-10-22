import type { WordCloudItem } from "./index";

/** 学生本人档案（`GET /api/shared/profile`） */
export interface StudentProfile {
  name: string;
  user_code: string;
  class_name: string;
  tags: string[];
  avatar_url: string;
  /** 历史上传的评价词云图片；#162 起仅存量展示 */
  evaluation_url: string;
  evaluation_texts?: string[];
  evaluation_words?: WordCloudItem[];
  /** 文件所在存储后端（#111） */
  storage_id?: number;
  submitted_at: string | null;
}

/** 历史提交版本项（#95）：快照元数据来自 /api/shared/profile/submissions */
export interface SubmissionHistoryItem {
  id: number;
  version: number;
  tags: string[];
  avatar_url: string;
  evaluation_url: string;
  evaluation_texts?: string[];
  evaluation_words?: WordCloudItem[];
  storage_id: number;
  submitted_at: string;
  is_current: number;
}

/** 本组名单（#101）：来自 /api/shared/group，只含请求者所在组 */
export interface GroupRosterMember {
  userId: number;
  userCode: string;
  name: string;
  avatarUrl: string | null;
  storageId: number;
  isMe: boolean;
  featureLabels: Record<string, string[]>;
}

export interface GroupRoster {
  grouped: boolean;
  groupNo: number | null;
  memberCount: number;
  sources: { key: string; label: string; kind: string }[];
  members: GroupRosterMember[];
}
