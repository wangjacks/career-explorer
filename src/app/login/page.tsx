"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { Compass } from "lucide-react";
import { useSession } from "@/hooks/useSession";
import NavigationBar from "@/components/NavigationBar";

/** 登录成功后按角色跳转的落点 */
const ROLE_HOME: Record<string, string> = {
  admin: "/dashboard/admin",
  student: "/dashboard/student",
  teacher: "/dashboard/teacher",
};

/** 校验 next 回跳目标：仅接受站内相对路径，防开放重定向 */
function safeNext(raw: string | null): string | null {
  if (!raw || !raw.startsWith("/") || raw.startsWith("//")) return null;
  return raw;
}

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = safeNext(searchParams.get("next"));
  const { session, checking } = useSession();
  const [userCode, setUserCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 已登录访问本页：有 next 回跳目标则跳回，否则跳对应面板
  useEffect(() => {
    if (session) {
      router.replace(next || ROLE_HOME[session.role] || "/");
    }
  }, [session, router, next]);

  const handleLogin = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ userCode, password }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push(next || ROLE_HOME[data.role] || "/");
        return;
      }
      setError(data.error || "登录失败");
    } catch {
      setError("登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // 会话检测中 / 正在重定向：显示 loading 避免登录表单闪现
  if (checking || session) {
    return (
      <div className="min-h-screen bg-brand">
        <NavigationBar title="登录" showHome />
        <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4">
          <p className="text-sm text-white/70">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand">
      <NavigationBar title="登录" showHome />
      <main className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4">
        <div className="w-full max-w-sm sm:max-w-md bg-card rounded-2xl shadow-xl p-8 space-y-6">
          <div className="text-center">
            <div className="w-12 h-12 rounded-xl bg-green-500 flex items-center justify-center mx-auto mb-3 shadow-sm">
              <Compass size={24} strokeWidth={2} className="text-white" />
            </div>
            <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">登录</h1>
            <p className="text-sm text-gray-500 mt-1 dark:text-gray-400">使用编号和密码登录（管理员 / 教师 / 学生）</p>
          </div>

          <div className="space-y-4">
            <input
              value={userCode}
              onChange={(e) => setUserCode(e.target.value)}
              placeholder="请输入编号（如 10001 / 学号）"
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-transparent"
            />
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && userCode && password && handleLogin()}
              placeholder="请输入密码"
              className="w-full px-4 py-3 border border-gray-200 dark:border-gray-600 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-focus-ring focus:border-transparent"
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            onClick={handleLogin}
            disabled={!userCode || !password || loading}
            className="w-full py-3 bg-primary hover:bg-primary-strong disabled:bg-gray-300 dark:disabled:bg-gray-600 text-white font-medium rounded-xl transition-colors"
          >
            {loading ? "登录中..." : "登录"}
          </button>

          <p className="text-center text-sm text-muted">
            还未激活账户？{" "}
            <Link href="/activate" className="text-green-600 dark:text-green-400 hover:underline">
              激活账户
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
