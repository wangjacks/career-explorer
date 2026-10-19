"use client";

import { useState, useCallback, useEffect } from "react";
import { toast } from "sonner";
import type { RiasecScoreSnapshot } from "@/lib/assessment-view";

export interface Profile {
  /** 数字用户 id（#95）：版本历史等关联查询使用；旧接口响应可能缺失，容忍 undefined */
  userId?: number;
  studentId: string;
  studentName: string;
  tags: string[];
  avatarUrl: string;
  evaluationUrl: string;
  /** 文件所在存储后端（#111）；旧接口响应可能缺失，容忍 undefined */
  storageId?: number;
  createdAt: string;
  /** 霍兰德三字码（#234）；未测或旧接口为 null */
  assessmentCode?: string | null;
  /** `completed` 已测 / `none` 未测（#234） */
  assessmentStatus?: string | null;
  /** 测评完成时间（#234）；未测为 null */
  assessmentAt?: string | null;
  /** 六型标准分快照（#234 详情弹窗条形用，与结果页同一份）；未测为 null */
  assessmentScores?: RiasecScoreSnapshot[] | null;
}

export interface Student {
  id: number;
  user_code: string;
  name: string;
  class_id: number | null;
  created_at: string;
  submitted_at: string | null;
}

export interface Stats {
  total: number;
  today: number;
  uniqueTags: number;
  topTags: { tag: string; count: number }[];
}

export interface PagedData {
  data: Profile[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface DbConfig {
  installed?: boolean;
  type?: "mysql" | "sqlite";
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
  sqlite?: { path: string };
}

export function useAdminAuth() {
  // null = 会话检测中（httpOnly cookie 不可读，需通过 API 检测）
  const [loggedIn, setLoggedIn] = useState<boolean | null>(null);
  const [installed, setInstalled] = useState<boolean | null>(null);

   
  useEffect(() => {
    const check = async () => {
      try {
        const res = await fetch("/api/auth");
        const data = await res.json();
        setLoggedIn(res.ok && data.role === "admin");
      } catch {
        setLoggedIn(false);
      }
    };
    check();
  }, []);

  const loadStats = useCallback(async (): Promise<Stats | null> => {
    try {
      const res = await fetch("/api/manage/stats");
      if (res.ok) return await res.json();
    } catch (err) {
      console.error("Failed to load stats:", err);
      toast.error("加载统计数据失败");
    }
    return null;
  }, []);

  const loadProfiles = useCallback(
    async (p: number): Promise<PagedData | null> => {
      try {
        const res = await fetch(`/api/manage/profiles?page=${p}`);
        if (res.ok) return await res.json();
      } catch (err) {
        console.error("Failed to load profiles:", err);
        toast.error("加载档案列表失败");
      }
      return null;
    },
    []
  );

  const loadSettings = useCallback(async (): Promise<DbConfig | null> => {
    try {
      const res = await fetch("/api/manage/settings");
      if (res.ok) return await res.json();
    } catch (err) {
      console.error("Failed to load settings:", err);
      toast.error("加载配置失败");
    }
    return null;
  }, []);

  const loadStudents = useCallback(async (): Promise<Student[] | null> => {
    try {
      const res = await fetch("/api/manage/students");
      if (res.ok) {
        const data = await res.json();
        return data.data;
      }
    } catch (err) {
      console.error("Failed to load students:", err);
      toast.error("加载学生列表失败");
    }
    return null;
  }, []);

  const checkInstalled = useCallback(async () => {
    try {
      const r = await fetch("/api/setup/status");
      const data = await r.json();
      setInstalled(data.installed);
      return data.installed as boolean;
    } catch (err) {
      console.error("Failed to check install status:", err);
      setInstalled(false);
      return false;
    }
  }, []);

  const initAfterLogin = useCallback(async () => {
    const isInstalled = await checkInstalled();
    return isInstalled;
  }, [checkInstalled]);

  return {
    loggedIn,
    installed,
    setInstalled,
    loadStats,
    loadProfiles,
    loadSettings,
    loadStudents,
    checkInstalled,
    initAfterLogin,
  };
}
