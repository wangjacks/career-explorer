"use client";

import { useState, useEffect, useCallback } from "react";
import { Toaster, toast } from "sonner";
import { useAdminAuth } from "@/hooks/useAdminAuth";
import type { DbConfig, Student } from "@/hooks/useAdminAuth";
import OverviewTab from "@/components/admin/OverviewTab";
import SettingsTab from "@/components/admin/SettingsTab";
import StudentsTab from "@/components/admin/StudentsTab";
import ExportTab from "@/components/admin/ExportTab";

type Tab = "overview" | "settings" | "students" | "export";

export default function AdminPage() {
  const {
    loggedIn,
    installed,
    setInstalled,
    authHeaders,
    handleLogin,
    handleLogout,
    loadStats,
    loadProfiles,
    loadSettings,
    loadStudents,
    initAfterLogin,
  } = useAdminAuth();

  const [activeTab, setActiveTab] = useState<Tab>("overview");
  const [dbConfig, setDbConfig] = useState<DbConfig | null>(null);
  const [students, setStudents] = useState<Student[]>([]);
  const [loginInput, setLoginInput] = useState("");

  const refreshStudents = useCallback(async () => {
    const data = await loadStudents();
    setStudents(data);
  }, [loadStudents]);

  const refreshSettings = useCallback(async () => {
    const data = await loadSettings();
    setDbConfig(data);
  }, [loadSettings]);

  /* eslint-disable react-hooks/set-state-in-effect -- init after login */
  useEffect(() => {
    if (loggedIn) {
      refreshSettings();
      initAfterLogin().then((isInstalled) => {
        if (!isInstalled) {
          setActiveTab("settings");
        } else {
          refreshStudents();
        }
      });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- load on login only
  }, [loggedIn]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const onLogin = async () => {
    const result = await handleLogin(loginInput);
    if (result === true) {
      setLoginInput("");
    } else {
      toast.error(result);
    }
  };

  const onConfigSaved = async () => {
    setInstalled(true);
    await refreshSettings();
    await loadStats();
    await loadProfiles(1);
    await refreshStudents();
  };

  // Login screen
  if (!loggedIn) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
        <Toaster position="top-center" />
        <div className="w-full max-w-sm bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">后台管理</h1>
            <p className="text-sm text-gray-500 mt-1">请输入密码登录</p>
          </div>
          <input
            type="password"
            value={loginInput}
            onChange={(e) => setLoginInput(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && onLogin()}
            placeholder="请输入密码"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent"
          />
          <button
            onClick={onLogin}
            className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
          >
            登录
          </button>
        </div>
      </div>
    );
  }

  const tabs: { key: Tab; label: string; badge?: string }[] = [
    { key: "overview", label: "数据概览" },
    { key: "settings", label: "数据源设置" },
    { key: "students", label: "学生管理", badge: `${students.length} 名` },
    { key: "export", label: "数据导出" },
  ];

  return (
    <div className="min-h-screen bg-gray-50">
      <Toaster position="top-center" />

      <header className="bg-white border-b border-gray-100 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <h1 className="text-lg font-bold text-gray-900">后台管理</h1>
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                handleLogout();
                setActiveTab("overview");
                setDbConfig(null);
                setStudents([]);
              }}
              className="px-4 py-2 bg-gray-100 hover:bg-gray-200 text-gray-700 text-sm font-medium rounded-lg transition-colors"
            >
              退出
            </button>
          </div>
        </div>
      </header>

      {/* Tab Navigation */}
      <div className="bg-white border-b border-gray-100">
        <div className="max-w-6xl mx-auto px-6">
          <nav className="flex gap-6">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`py-3 text-sm font-medium border-b-2 transition-colors ${
                  activeTab === tab.key
                    ? "border-green-500 text-green-600"
                    : "border-transparent text-gray-500 hover:text-gray-700"
                }`}
              >
                {tab.label}
                {tab.badge && (
                  <span className="ml-2 px-1.5 py-0.5 bg-gray-100 text-gray-500 rounded text-xs">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
          </nav>
        </div>
      </div>

      <main className="max-w-6xl mx-auto px-6 py-8 space-y-8">
        {/* Not Installed Banner */}
        {installed === false && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 flex items-center gap-3">
            <svg className="w-5 h-5 text-amber-600 flex-shrink-0" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L4.082 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
            <p className="text-sm text-amber-800">数据库未配置，请先在「数据源设置」中完成配置</p>
          </div>
        )}

        {activeTab === "overview" && (
          <OverviewTab
            authHeaders={authHeaders}
            installed={installed}
            loadStats={loadStats}
            loadProfiles={loadProfiles}
          />
        )}

        {activeTab === "settings" && (
          <SettingsTab
            authHeaders={authHeaders}
            dbConfig={dbConfig}
            onConfigSaved={onConfigSaved}
          />
        )}

        {activeTab === "students" && (
          <StudentsTab
            authHeaders={authHeaders}
            students={students}
            onStudentsChanged={refreshStudents}
          />
        )}

        {activeTab === "export" && (
          <ExportTab authHeaders={authHeaders} />
        )}
      </main>
    </div>
  );
}
