"use client";

import { useCallback, useState } from "react";
import {
  DRAFT_TAGS_KEY,
  DRAFT_META_KEY,
  hasMeaningfulDraft,
  parseJsonOrNull,
  toggleTag,
  type DraftMeta,
} from "@/lib/profile-draft";

function readStoredTags(): string[] {
  const parsed = parseJsonOrNull<string[]>(localStorage.getItem(DRAFT_TAGS_KEY));
  return Array.isArray(parsed) ? parsed : [];
}

function readStoredMeta(): DraftMeta | null {
  return parseJsonOrNull<DraftMeta>(localStorage.getItem(DRAFT_META_KEY));
}

export interface UseProfileDraftResult {
  tags: string[];
  evaluationFile: File | null;
  evaluationPreview: string | null;
  avatarFile: File | null;
  avatarPreview: string | null;
  /** 按持久化状态判断是否有草稿（供恢复提示弹窗；刷新后 File 丢失但元数据仍在） */
  storedHasDraft: () => boolean;
  toggleTag: (tag: string) => void;
  setEvaluationFile: (file: File | null) => void;
  setAvatarFile: (file: File | null) => void;
  /** 清空全部本地草稿与内存状态（「重新开始」与提交成功后调用） */
  clearDraft: () => void;
}

/**
 * 档案创建表单草稿状态：标签实时持久化；图片 File 存内存（object URL 预览），
 * 仅「已选」元数据持久化（File 不可序列化）。
 */
export function useProfileDraft(): UseProfileDraftResult {
  const [tags, setTags] = useState<string[]>([]);
  const [evaluationFile, setEvaluationFileState] = useState<File | null>(null);
  const [evaluationPreview, setEvaluationPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFileState] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  // 挂载后恢复标签草稿（避免 SSR/prerender 访问 localStorage）
   
  if (!loaded) {
    setTags(readStoredTags());
    setLoaded(true);
  }
   

  const storedHasDraft = useCallback(
    () => hasMeaningfulDraft(readStoredTags(), readStoredMeta()),
    []
  );

  const handleToggleTag = useCallback((tag: string) => {
    setTags((prev) => {
      const next = toggleTag(prev, tag);
      localStorage.setItem(DRAFT_TAGS_KEY, JSON.stringify(next));
      return next;
    });
  }, []);

  const persistMeta = (meta: DraftMeta) => {
    if (meta.evaluation || meta.avatar) {
      localStorage.setItem(DRAFT_META_KEY, JSON.stringify(meta));
    } else {
      localStorage.removeItem(DRAFT_META_KEY);
    }
  };

  const setEvaluationFile = useCallback((file: File | null) => {
    setEvaluationFileState(file);
    setEvaluationPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    const meta = readStoredMeta() ?? {};
    persistMeta({ ...meta, evaluation: !!file });
  }, []);

  const setAvatarFile = useCallback((file: File | null) => {
    setAvatarFileState(file);
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    const meta = readStoredMeta() ?? {};
    persistMeta({ ...meta, avatar: !!file });
  }, []);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_TAGS_KEY);
    localStorage.removeItem(DRAFT_META_KEY);
    setTags([]);
    setEvaluationFileState(null);
    setEvaluationPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
    setAvatarFileState(null);
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return null;
    });
  }, []);

  return {
    tags,
    evaluationFile,
    evaluationPreview,
    avatarFile,
    avatarPreview,
    storedHasDraft,
    toggleTag: handleToggleTag,
    setEvaluationFile,
    setAvatarFile,
    clearDraft,
  };
}
