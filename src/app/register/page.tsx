"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import NavigationBar from "@/components/NavigationBar";

export default function RegisterPage() {
  const router = useRouter();
  const { session, checking } = useSession();
  const [userCode, setUserCode] = useState("");
  const [name, setName] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  // 已登录访问本页：直接跳转对应面板
  useEffect(() => {
    if (session) {
      router.replace(`/dashboard/${session.role}`);
    }
  }, [session, router]);

  // 客户端校验：编号 12 位数字 / 姓名非空 / 密码 ≥8 位 / 两次一致 / 邀请码非空
  const codeValid = /^\d{12}$/.test(userCode.trim());
  const nameValid = name.trim().length > 0;
  const passwordValid = password.length >= 8;
  const confirmValid = password === confirmPassword;
  const inviteValid = inviteCode.trim().length > 0;
  const formValid = codeValid && nameValid && passwordValid && confirmValid && inviteValid;

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userCode: userCode.trim(),
          name: name.trim(),
          password,
          inviteCode: inviteCode.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        router.push("/dashboard/student");
        return;
      }
      setError(data.error || "注册失败");
    } catch {
      setError("注册失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const inputClass =
    "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent";

  // 会话检测中 / 正在重定向：显示 loading 避免注册表单闪现
  if (checking || session) {
    return (
      <div className="min-h-screen bg-gray-50">
        <NavigationBar title="学生注册" showHome />
        <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4">
          <p className="text-sm text-gray-400">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <NavigationBar title="学生注册" showHome />
      <main className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm sm:max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6">
          <div className="text-center">
            <h1 className="text-xl font-bold text-gray-900">学生注册</h1>
            <p className="text-sm text-gray-500 mt-1">凭班级邀请码注册并绑定班级</p>
          </div>

          <div className="space-y-4">
            <div>
              <input
                value={userCode}
                onChange={(e) => setUserCode(e.target.value)}
                placeholder="编号（12 位数字学号）"
                className={inputClass}
              />
              {userCode && !codeValid && (
                <p className="text-xs text-red-500 mt-1">编号须为 12 位数字</p>
              )}
            </div>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="姓名"
              className={inputClass}
            />
            <div>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="密码（至少 8 位）"
                className={inputClass}
              />
              {password && !passwordValid && (
                <p className="text-xs text-red-500 mt-1">密码须至少 8 位</p>
              )}
            </div>
            <div>
              <input
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                placeholder="确认密码"
                className={inputClass}
              />
              {confirmPassword && !confirmValid && (
                <p className="text-xs text-red-500 mt-1">两次输入的密码不一致</p>
              )}
            </div>
            <input
              value={inviteCode}
              onChange={(e) => setInviteCode(e.target.value)}
              placeholder="班级邀请码"
              className={inputClass}
            />
          </div>

          {error && <p className="text-sm text-red-500">{error}</p>}

          <button
            onClick={handleSubmit}
            disabled={!formValid || loading}
            className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-medium rounded-xl transition-colors"
          >
            {loading ? "注册中..." : "注册"}
          </button>

          <p className="text-center text-sm text-gray-500">
            已有账号？{" "}
            <Link href="/login" className="text-green-600 hover:underline">
              去登录
            </Link>
          </p>
        </div>
      </main>
    </div>
  );
}
