"use client";

import { Fragment, useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { Zap, Check } from "lucide-react";

type Step = "welcome" | "config" | "password" | "installing" | "done";
type DbType = "mysql" | "sqlite";

/** 步骤进度条节点文案（与 Step 状态映射：welcome→0、config→1、password/installing→2、done→3） */
const SETUP_STEPS = ["选择数据库", "数据库配置", "管理员密码", "完成"];

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
  const [dbType, setDbType] = useState<DbType>("mysql");
  const [mysqlConfig, setMysqlConfig] = useState<MySQLConfig>({
    host: "127.0.0.1",
    port: 3306,
    user: "root",
    password: "",
    database: "career_app",
  });
  const [sqlitePath, setSqlitePath] = useState("./data/career.db");
  const [testing, setTesting] = useState(false);
  const [installing, setInstalling] = useState(false);
  const [connectionOk, setConnectionOk] = useState(false);
  const [adminPassword, setAdminPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");

  const stepIndex = step === "welcome" ? 0 : step === "config" ? 1 : step === "done" ? 3 : 2;
  const passwordValid = adminPassword.length >= 8 && adminPassword === confirmPassword;

  useEffect(() => {
    fetch("/api/setup/status")
      .then((r) => r.json())
      .then((data) => {
        if (data.installed) {
          router.replace("/dashboard/admin");
        }
      })
      .catch(() => {});
  }, [router]);

  const handleTest = async () => {
    setTesting(true);
    setConnectionOk(false);
    try {
      const body = dbType === "sqlite"
        ? { type: "sqlite", sqlite: { path: sqlitePath } }
        : { type: "mysql", mysql: mysqlConfig };
      const res = await fetch("/api/setup/test", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        toast.success(data.message || "连接成功");
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
      const body = dbType === "sqlite"
        ? { type: "sqlite", sqlite: { path: sqlitePath }, adminPassword }
        : { type: "mysql", mysql: mysqlConfig, adminPassword };
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (data.ok) {
        setStep("done");
        toast.success("安装成功");
        setTimeout(() => router.push("/dashboard/admin"), 1500);
      } else {
        toast.error(data.error);
        setStep("password");
      }
    } catch {
      toast.error("安装失败，请重试");
      setStep("password");
    } finally {
      setInstalling(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <Toaster position="top-center" />
      <div className="w-full max-w-md sm:max-w-lg md:max-w-xl bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
        {/* 步骤进度条：全程显示安装进度 */}
        <div className="flex items-start">
          {SETUP_STEPS.map((label, i) => {
            const done = step === "done" || i < stepIndex;
            const current = step !== "done" && i === stepIndex;
            return (
              <Fragment key={label}>
                {i > 0 && (
                  <div className={`flex-1 h-0.5 mt-3.5 mx-1 ${i <= stepIndex ? "bg-green-500" : "bg-gray-200"}`} />
                )}
                <div className="flex flex-col items-center gap-1">
                  <div
                    className={`w-7 h-7 rounded-full flex items-center justify-center text-xs font-medium ${
                      done
                        ? "bg-green-500 text-white"
                        : current
                          ? "bg-green-500 text-white ring-4 ring-green-100"
                          : "bg-gray-200 text-gray-500"
                    }`}
                  >
                    {done ? "✓" : i + 1}
                  </div>
                  <span className={`text-[10px] sm:text-xs whitespace-nowrap ${current || done ? "text-green-600 font-medium" : "text-gray-400"}`}>
                    {label}
                  </span>
                </div>
              </Fragment>
            );
          })}
        </div>

        {step === "welcome" && (
          <>
            <div className="text-center space-y-2">
              <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
                <Zap className="w-8 h-8 text-green-600" strokeWidth={2} />
              </div>
              <h1 className="text-xl font-bold text-gray-900">欢迎使用 Career Explorer</h1>
              <p className="text-sm text-gray-500">请选择数据库类型</p>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <button
                onClick={() => { setDbType("mysql"); setStep("config"); setConnectionOk(false); }}
                className="p-4 border-2 border-gray-200 hover:border-green-400 rounded-xl text-left transition-colors"
              >
                <div className="text-2xl mb-2">🗄️</div>
                <div className="font-medium text-gray-900">MySQL</div>
                <div className="text-xs text-gray-500 mt-1">适合已有 MySQL 服务器的场景</div>
              </button>
              <button
                onClick={() => { setDbType("sqlite"); setStep("config"); setConnectionOk(false); }}
                className="p-4 border-2 border-gray-200 hover:border-green-400 rounded-xl text-left transition-colors"
              >
                <div className="text-2xl mb-2">📁</div>
                <div className="font-medium text-gray-900">SQLite</div>
                <div className="text-xs text-gray-500 mt-1">轻量级方案，数据存储在本地文件</div>
              </button>
            </div>
          </>
        )}

        {step === "config" && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-xl font-bold text-gray-900">
                {dbType === "mysql" ? "MySQL 配置" : "SQLite 配置"}
              </h1>
              <p className="text-sm text-gray-500">
                {dbType === "mysql" ? "请填写数据库连接信息" : "设置 SQLite 数据库文件路径"}
              </p>
            </div>

            {dbType === "mysql" ? (
              <div className="space-y-4">
                <div className="grid grid-cols-3 gap-3">
                  <div className="col-span-2">
                    <label className="block text-xs text-gray-500 mb-1">主机</label>
                    <input
                      type="text"
                      value={mysqlConfig.host}
                      onChange={(e) => setMysqlConfig({ ...mysqlConfig, host: e.target.value })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-gray-500 mb-1">端口</label>
                    <input
                      type="number"
                      value={mysqlConfig.port}
                      onChange={(e) => setMysqlConfig({ ...mysqlConfig, port: parseInt(e.target.value) || 3306 })}
                      className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">用户名</label>
                  <input
                    type="text"
                    value={mysqlConfig.user}
                    onChange={(e) => setMysqlConfig({ ...mysqlConfig, user: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">密码</label>
                  <input
                    type="password"
                    value={mysqlConfig.password}
                    onChange={(e) => setMysqlConfig({ ...mysqlConfig, password: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                </div>
                <div>
                  <label className="block text-xs text-gray-500 mb-1">数据库名</label>
                  <input
                    type="text"
                    value={mysqlConfig.database}
                    onChange={(e) => setMysqlConfig({ ...mysqlConfig, database: e.target.value })}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                  <p className="text-xs text-gray-400 mt-1">数据库必须已存在，系统会自动创建表结构</p>
                </div>
              </div>
            ) : (
              <div className="space-y-4">
                <div>
                  <label className="block text-xs text-gray-500 mb-1">数据库文件路径</label>
                  <input
                    type="text"
                    value={sqlitePath}
                    onChange={(e) => setSqlitePath(e.target.value)}
                    className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                  />
                  <p className="text-xs text-gray-400 mt-1">相对于项目根目录，系统会自动创建目录</p>
                </div>
              </div>
            )}

            <div className="flex gap-3">
              <button
                onClick={() => setStep("welcome")}
                className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
              >
                返回
              </button>
              <button
                onClick={handleTest}
                disabled={testing}
                className="flex-1 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors disabled:opacity-50"
              >
                {testing ? "测试中..." : "测试连接"}
              </button>
              <button
                onClick={() => setStep("password")}
                disabled={!connectionOk}
                className="flex-1 py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
              >
                下一步
              </button>
            </div>
          </>
        )}

        {step === "password" && (
          <>
            <div className="text-center space-y-2">
              <h1 className="text-xl font-bold text-gray-900">设置管理员密码</h1>
              <p className="text-sm text-gray-500">管理员编号为 10001，请牢记密码</p>
            </div>

            <div className="space-y-4">
              <div>
                <label className="block text-xs text-gray-500 mb-1">管理员密码</label>
                <input
                  type="password"
                  value={adminPassword}
                  onChange={(e) => setAdminPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
                {adminPassword.length > 0 && adminPassword.length < 8 && (
                  <p className="text-xs text-red-500 mt-1">密码至少需要 8 位</p>
                )}
              </div>
              <div>
                <label className="block text-xs text-gray-500 mb-1">确认密码</label>
                <input
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-green-300"
                />
                {confirmPassword.length > 0 && confirmPassword !== adminPassword && (
                  <p className="text-xs text-red-500 mt-1">两次输入的密码不一致</p>
                )}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                onClick={() => setStep("config")}
                className="px-4 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
              >
                返回
              </button>
              <button
                onClick={handleInstall}
                disabled={!passwordValid || installing}
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
              <Check className="w-8 h-8 text-green-600" strokeWidth={2} />
            </div>
            <div>
              <h2 className="text-lg font-bold text-gray-900">安装成功</h2>
              <p className="text-sm text-gray-500 mt-1">管理员编号：10001</p>
              <p className="text-sm text-gray-400 mt-1">正在跳转到管理后台...</p>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
