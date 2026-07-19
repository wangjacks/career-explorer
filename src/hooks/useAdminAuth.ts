"use client";

import { useState, useCallback } from "react";

export interface Profile {
  studentId: string;
  studentName: string;
  tags: string[];
  avatarUrl: string;
  evaluationUrl: string;
  createdAt: string;
}

export interface Student {
  student_id: string;
  name: string;
  created_at: string;
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
  mysql: {
    host: string;
    port: number;
    user: string;
    password: string;
    database: string;
  };
}

export function useAdminAuth() {
  const [loggedIn, setLoggedIn] = useState(() => {
    if (typeof document === "undefined") return false;
    return document.cookie.includes("admin_token=");
  });
  const [installed, setInstalled] = useState<boolean | null>(null);

  const handleLogin = async (pw: string) => {
    try {
      const res = await fetch("/api/admin/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password: pw }),
      });
      const data = await res.json();
      if (data.ok) {
        setLoggedIn(true);
        return true;
      }
      return data.error || "密码错误";
    } catch {
      return "登录失败";
    }
  };

  const handleLogout = async () => {
    try {
      await fetch("/api/admin/auth", { method: "DELETE" });
    } catch { /* ignore */ }
    setLoggedIn(false);
  };

  const loadStats = useCallback(async (): Promise<Stats | null> => {
    try {
      const res = await fetch("/api/admin/stats");
      if (res.ok) return await res.json();
    } catch { /* empty */ }
    return null;
  }, []);

  const loadProfiles = useCallback(
    async (p: number): Promise<PagedData | null> => {
      try {
        const res = await fetch(`/api/admin/profiles?page=${p}`);
        if (res.ok) return await res.json();
      } catch { /* empty */ }
      return null;
    },
    []
  );

  const loadSettings = useCallback(async (): Promise<DbConfig | null> => {
    try {
      const res = await fetch("/api/admin/settings");
      if (res.ok) return await res.json();
    } catch { /* empty */ }
    return null;
  }, []);

  const loadStudents = useCallback(async (): Promise<Student[]> => {
    try {
      const res = await fetch("/api/admin/students");
      if (res.ok) {
        const data = await res.json();
        return data.data;
      }
    } catch { /* empty */ }
    return [];
  }, []);

  const checkInstalled = useCallback(async () => {
    try {
      const r = await fetch("/api/setup/status");
      const data = await r.json();
      setInstalled(data.installed);
      return data.installed as boolean;
    } catch {
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
    handleLogin,
    handleLogout,
    loadStats,
    loadProfiles,
    loadSettings,
    loadStudents,
    checkInstalled,
    initAfterLogin,
  };
}
