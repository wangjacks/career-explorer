"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";

type Step = "welcome" | "config" | "installing" | "done";

interface MySQLConfig {
  host: string;
  port: number;
  user: string;
  password: string;
  database: string;
}

export default function SetupPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [config, setConfig] = useState<MySQLConfig>({
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "",
    database: "career_app",
  });
  const [testing, setTesting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [connectionOk, setConnectionOk] = useState(false);

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.installed) {
          router.replace("/admin");
        }
      })
      .catch(() => {});
  }, [router]);

  const handleTest = async () => {
    setTesting(true);
    setConnectionOk(false);
    try {
      const res = await fetch("/api/setup/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(config),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success("数据库连接成功");
        setConnectionOk(true);
      } else {
        toast.error(data.error);
      }
    } catch {
      toast.error("测试失败，请检查网络连接");
    } finally {
      setTesting(false);
    }
  };

  const handleInstall = async () => {
    setInstalling(true);
    setStep("installing");
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mysql: config }),
      });
      const data = await res.json();
      if (data.ok) {
        setStep("done");
        toast.success("安装成功");
        setTimeout(() => router.push("/admin"), 1500);
      } else {
        toast.error(data.error);
        setStep("config");
      }
    } catch {
      toast.error("安装失败，请重试");
      setStep("config");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <Toaster position="top-center" />
      <div className="w-full max-w-md sm:max-w-lg md:max-w-xl bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
        {step === "welcome" && (
          <>
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
                </svg>
              </div>
              <h1 className="text-xl font-bold text-gray-900">欢迎使用职业规划小程序</h1>
              <p className="text-sm text-gray-500">首次使用需要配置 MySQL 数据库连接</p>
            </div>
            <button
              onClick={() => setStep("config")}
              className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
            >
              开始配置
            </button>
          </>
        )}

        {step === "config" && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-xl font-bold text-gray-900">数据库配置</h1>
              <p className="text-sm text-gray-500">请填写 MySQL 数据库连接信息</p>
            </div>
            <div className="space-y-4">
              <div className="grid grid-cols-3 gap-3">
                <div className="col-span-2">
                  <label className="block text-xs text-gray-500 mb-1">主机</label>
                  <input
                    type="text"
                    value={config.host}
                    onChange={(e) => setConfig({ ...config, host: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">端口</label>
                  <input
                    type="number"
                    value={config.port}
                    onChange={(e) => setConfig({ ...config, port: parseInt(e.target.value) || 3306 })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">用户名</label>
                <input
                  type="text"
                  value={config.user}
                  onChange={(e) => setConfig({ ...config, user: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">密码</label>
                <input
                  type="password"
                  value={config.password}
                  onChange={(e) => setConfig({ ...config, password: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">数据库名</label>
                <input
                  type="text"
                  value={config.database}
                  onChange={(e) => setConfig({ ...config, database: e.target.value })}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
                <p className="text-xs text-gray-400 mt-1">数据库必须已存在，系统会自动创建表结构</p>
              </div>
            </div>
            <div className="flex gap-3">
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                {testing ? "测试中..." : "测试连接"}
              </button>
              <button
                onClick={handleInstall}
                disabled={!connectionOk || installing}
                className="flex-1 py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                {installing ? "安装中..." : "安装"}
              </button>
            </div>
          </>
        )}

        {step === "installing" && (
          <div className="text-center space-y-4 py-8">
            <div className="w-12 h-12 border-4 border-green-500 border-t-transparent rounded-full animate-spin mx-auto" />
            <p className="text-gray-600">正在初始化数据库...</p>
          </div>
        )}

        {step === "done" && (
          <div className="text-center space-y-4 py-8">
            <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto">
              <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">安装成功</h2>
              <p className="text-sm text-gray-500 mt-1">正在跳转到管理后台...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
