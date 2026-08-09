"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";

/** 登录成功后按角色跳转的落点 */
const ROLE_HOME: Record<string, string> = {
  admin: "/dashboard/admin",
  student: "/dashboard/student",
  teacher: "/dashboard/teacher",
};

export default function LoginPage() {
  const router = useRouter();
  const [userCode, setUserCode] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

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
        router.push(ROLE_HOME[data.role] || "/");
        return;
      }
      setError(data.error || "登录失败");
    } catch {
      setError("登录失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm sm:max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
        <div className="text-center">
          <h1 className="text-xl font-bold text-gray-900">登录</h1>
          <p className="text-sm text-gray-500 mt-1">使用编号和密码登录（管理员 / 教师 / 学生）</p>
        </div>

        <div className="space-y-4">
          <input
            value={userCode}
            onChange={(e) => setUserCode(e.target.value)}
            placeholder="请输入编号（如 10001 / 学号）"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent"
          />
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && userCode && password && handleLogin()}
            placeholder="请输入密码"
            className="w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent"
          />
        </div>

        {error && <p className="text-sm text-red-500">{error}</p>}

        <button
          onClick={handleLogin}
          disabled={!userCode || !password || loading}
          className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-medium rounded-xl transition-colors"
        >
          {loading ? "登录中..." : "登录"}
        </button>

        <p className="text-center text-sm text-gray-500">
          还没有账号？{" "}
          <Link href="/register" className="text-green-600 hover:underline">
            学生注册
          </Link>
        </p>
      </div>
    </div>
  );
}
