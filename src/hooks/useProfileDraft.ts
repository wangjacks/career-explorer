"use client";

import { useCallback, useEffect, useState } from "react";
import {
  DRAFT_TAGS_KEY,
  DRAFT_META_KEY,
  hasMeaningfulDraft,
  parseJsonOrNull,
  toggleTag,
  type DraftMeta,
} from "@/lib/profile-draft";
import { clearAllDraftFiles, loadDraftFile, removeDraftFile, storeDraftFile } from "@/lib/draft-idb";

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
  /** 按持久化状态判断是否有草稿（供恢复提示弹窗） */
  storedHasDraft: () => boolean;
  toggleTag: (tag: string) => void;
  setEvaluationFile: (file: File | null) => void;
  setAvatarFile: (file: File | null) => void;
  /** 清空全部本地草稿与内存状态（「重新开始」与提交成功后调用） */
  clearDraft: () => void;
}

/**
 * 档案创建表单草稿状态：
 * - 标签实时持久化到 localStorage；
 * - 图片 File 持久化到 IndexedDB（刷新后可恢复），预览用 object URL；
 * - 所有存储读取均在挂载副作用中进行，避免 SSR 访问 localStorage。
 */
export function useProfileDraft(): UseProfileDraftResult {
  const [tags, setTags] = useState<string[]>([]);
  const [evaluationFile, setEvaluationFileState] = useState<File | null>(null);
  const [evaluationPreview, setEvaluationPreview] = useState<string | null>(null);
  const [avatarFile, setAvatarFileState] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);

  // 挂载后恢复草稿：标签（localStorage）+ 图片 File（IndexedDB）
  /* eslint-disable react-hooks/set-state-in-effect -- load persisted draft on mount */
  useEffect(() => {
    setTags(readStoredTags());
    let cancelled = false;
    (async () => {
      try {
        const [storedEvaluation, storedAvatar] = await Promise.all([
          loadDraftFile("evaluation"),
          loadDraftFile("avatar"),
        ]);
        if (cancelled) return;
        if (storedEvaluation) {
          setEvaluationFileState(storedEvaluation);
          setEvaluationPreview(URL.createObjectURL(storedEvaluation));
        }
        if (storedAvatar) {
          setAvatarFileState(storedAvatar);
          setAvatarPreview(URL.createObjectURL(storedAvatar));
        }
      } catch (err) {
        console.error("Failed to load draft images:", err);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
    if (file) {
      storeDraftFile("evaluation", file).catch((err) => console.error("Draft image save failed:", err));
    } else {
      removeDraftFile("evaluation").catch((err) => console.error("Draft image remove failed:", err));
    }
  }, []);

  const setAvatarFile = useCallback((file: File | null) => {
    setAvatarFileState(file);
    setAvatarPreview((prev) => {
      if (prev) URL.revokeObjectURL(prev);
      return file ? URL.createObjectURL(file) : null;
    });
    const meta = readStoredMeta() ?? {};
    persistMeta({ ...meta, avatar: !!file });
    if (file) {
      storeDraftFile("avatar", file).catch((err) => console.error("Draft image save failed:", err));
    } else {
      removeDraftFile("avatar").catch((err) => console.error("Draft image remove failed:", err));
    }
  }, []);

  const clearDraft = useCallback(() => {
    localStorage.removeItem(DRAFT_TAGS_KEY);
    localStorage.removeItem(DRAFT_META_KEY);
    clearAllDraftFiles().catch((err) => console.error("Draft files clear failed:", err));
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
