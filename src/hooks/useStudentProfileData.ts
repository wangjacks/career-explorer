"use client";

import { useCallback, useEffect, useState } from "react";
import { toast } from "sonner";
import type { TagCategory } from "@/components/TagSelector";
import type { StudentProfile } from "@/types/student-profile";
import { nextTagCategoriesState, type TagCategoriesState } from "@/lib/tag-categories-state";

export interface StudentProfileData {
  profile: StudentProfile | null;
  loading: boolean;
  /** 首次加载失败（区分「还没加载完」与「请求失败」；重试后复位） */
  loadFailed: boolean;
  categories: TagCategory[];
  categoriesState: TagCategoriesState;
  maxCustomTags?: number;
  avatarMaxMb?: number;
  submissionClosed: boolean;
  submissionDeadline: string | null;
  reloadProfile: () => Promise<void>;
  /** 返回本次请求实测的截止状态：调用方要按最新值判分支，不能读可能滞后的 state */
  reloadCategories: () => Promise<{ ok: boolean; closed: boolean }>;
}

/**
 * 学生档案页共用的数据源（#361）：「我的档案 / 历史提交 / 我的小组」三个路由页
 * 都要展示 hero 与标签配色，统一在这里拉 profile + 标签目录 + 截止状态，口径只维护一份。
 */
export function useStudentProfileData(): StudentProfileData {
  const [profile, setProfile] = useState<StudentProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [categories, setCategories] = useState<TagCategory[]>([]);
  // 标签目录加载状态（#261）：数组为空是合法 ready 态，不能再用 length 推断是否加载中
  const [categoriesState, setCategoriesState] = useState<TagCategoriesState>("loading");
  const [maxCustomTags, setMaxCustomTags] = useState<number | undefined>(undefined);
  // 图片体积上限（#206）：选图前预检用，随 /api/tags 下发；服务端校验仍是最终防线
  const [avatarMaxMb, setAvatarMaxMb] = useState<number | undefined>(undefined);
  // 提交时限（#96）：截止后禁用修改/提交入口，服务端状态为准（经 /api/tags 下发）
  const [submissionClosed, setSubmissionClosed] = useState(false);
  const [submissionDeadline, setSubmissionDeadline] = useState<string | null>(null);

  const reloadProfile = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/shared/profile");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "档案加载失败");
      setProfile(data as StudentProfile);
      setLoadFailed(false);
    } catch (err) {
      console.error("Failed to load profile:", err);
      setLoadFailed(true);
      toast.error(err instanceof Error ? err.message : "档案加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  // 加载标签分类（展示态「我的标签」三色分组 + 编辑态复用）+ 自定义标签上限（#94）+ 提交截止状态（#96）
  // + 图片体积上限（#206，选图前预检）
  const reloadCategories = useCallback(async (): Promise<{ ok: boolean; closed: boolean }> => {
    setCategoriesState((prev) => nextTagCategoriesState(prev, "start"));
    try {
      const res = await fetch("/api/tags");
      const data = await res.json();
      if (res.ok) {
        setCategories(data.categories || []);
        setMaxCustomTags(typeof data.maxCustomTags === "number" ? data.maxCustomTags : undefined);
        setAvatarMaxMb(typeof data.maxAvatarSizeMb === "number" ? data.maxAvatarSizeMb : undefined);
        const closed = data.submissionClosed === true;
        setSubmissionClosed(closed);
        setSubmissionDeadline(typeof data.submissionDeadline === "string" ? data.submissionDeadline : null);
        setCategoriesState((prev) => nextTagCategoriesState(prev, "success"));
        return { ok: true, closed };
      }
      setCategoriesState((prev) => nextTagCategoriesState(prev, "failure"));
      return { ok: false, closed: false };
    } catch (err) {
      console.error("Failed to load tags:", err);
      setCategoriesState((prev) => nextTagCategoriesState(prev, "failure"));
      return { ok: false, closed: false };
    }
  }, []);

  /* eslint-disable react-hooks/set-state-in-effect -- initial load; pages only mount after the session guard */
  useEffect(() => {
    void reloadProfile();
    void reloadCategories();
  }, [reloadProfile, reloadCategories]);
  /* eslint-enable react-hooks/set-state-in-effect */

  return {
    profile,
    loading,
    loadFailed,
    categories,
    categoriesState,
    maxCustomTags,
    avatarMaxMb,
    submissionClosed,
    submissionDeadline,
    reloadProfile,
    reloadCategories,
  };
}
