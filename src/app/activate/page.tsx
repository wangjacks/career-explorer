"use client";

import { Suspense, useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useSession } from "@/hooks/useSession";
import NavigationBar from "@/components/NavigationBar";

const inputClass =
  "w-full px-4 py-3 border border-gray-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent";

/**
 * 学生账户激活（两步单页，Issue #93）：
 * 第一步：学号 + 姓名 + 班级邀请码 → 服务端三要素核验
 * 第二步（?step=2）：核验通过后设置密码并激活
 */
function ActivateForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { session, checking } = useSession();

  const [userCode, setUserCode] = useState("");
  const [name, setName] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  // 第一步核验通过后记录的名单姓名（服务端返回，作为第二步问候语）
  const [verifiedName, setVerifiedName] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const step = searchParams.get("step") === "2" && verifiedName ? 2 : 1;

  const goToStep = (next: 1 | 2) => {
    setError("");
    router.replace(next === 2 ? "/activate?step=2" : "/activate");
  };

  // 已登录访问本页：直接跳转对应面板
  useEffect(() => {
    if (session) {
      router.replace(`/dashboard/${session.role}`);
    }
  }, [session, router]);

  // 客户端校验：第一步 学号 12 位 / 姓名非空 / 邀请码非空
  const codeValid = /^\d{12}$/.test(userCode.trim());
  const nameValid = name.trim().length > 0;
  const inviteValid = inviteCode.trim().length > 0;
  const step1Valid = codeValid && nameValid && inviteValid;

  // 第二步：密码 ≥8 位 / 两次一致
  const passwordValid = password.length >= 8;
  const confirmValid = password === confirmPassword;
  const step2Valid = passwordValid && confirmValid;

  const handleVerify = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/activate/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userCode: userCode.trim(),
          name: name.trim(),
          inviteCode: inviteCode.trim(),
        }),
      });
      const data = await res.json();
      if (data.ok) {
        setVerifiedName(data.name);
        goToStep(2);
        return;
      }
      setError(data.error || "核验失败");
    } catch {
      setError("核验失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  const handleActivate = async () => {
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/activate", {
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
      setError(data.error || "激活失败");
    } catch {
      setError("激活失败，请稍后重试");
    } finally {
      setLoading(false);
    }
  };

  // 会话检测中 / 正在重定向：显示 loading 避免激活表单闪现
  if (checking || session) {
    return (
      <div className="min-h-screen bg-brand">
        <NavigationBar title="账户激活" showHome />
        <div className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4">
          <p className="text-sm text-white/70">加载中...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-brand">
      <NavigationBar title="账户激活" showHome />
      <main className="min-h-[calc(100vh-3rem)] flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm sm:max-w-md bg-card rounded-2xl shadow-xl p-8 space-y-6">
          {step === 1 ? (
            <>
              <div className="text-center">
                <h1 className="text-xl font-bold text-gray-900">学生账户激活</h1>
                <p className="text-sm text-gray-500 mt-1">
                  账户须由教师导入名单后创建，请先核验身份信息
                </p>
              </div>

              <div className="space-y-4">
                <div>
                  <input
                    value={userCode}
                    onChange={(e) => setUserCode(e.target.value)}
                    placeholder="学号（12 位数字）"
                    className={inputClass}
                  />
                  {userCode && !codeValid && (
                    <p className="text-xs text-red-500 mt-1">学号须为 12 位数字</p>
                  )}
                </div>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="姓名"
                  className={inputClass}
                />
                <input
                  value={inviteCode}
                  onChange={(e) => setInviteCode(e.target.value)}
                  placeholder="班级邀请码"
                  className={inputClass}
                />
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                onClick={handleVerify}
                disabled={!step1Valid || loading}
                className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-medium rounded-xl transition-colors"
              >
                {loading ? "核验中..." : "下一步"}
              </button>
            </>
          ) : (
            <>
              <div className="text-center">
                <h1 className="text-xl font-bold text-gray-900">
                  您好，{verifiedName}同学！
                </h1>
                <p className="text-sm text-gray-500 mt-1">身份核验通过，请设置密码完成激活</p>
              </div>

              <div className="space-y-4">
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
              </div>

              {error && <p className="text-sm text-red-500">{error}</p>}

              <button
                onClick={handleActivate}
                disabled={!step2Valid || loading}
                className="w-full py-3 bg-green-500 hover:bg-green-600 disabled:bg-gray-300 text-white font-medium rounded-xl transition-colors"
              >
                {loading ? "激活中..." : "激活"}
              </button>

              <button
                onClick={() => {
                  setVerifiedName(null);
                  goToStep(1);
                }}
                className="w-full text-center text-sm text-gray-500 hover:text-gray-700"
              >
                返回上一步修改信息
              </button>
            </>
          )}

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

export default function ActivatePage() {
  return (
    <Suspense fallback={null}>
      <ActivateForm />
    </Suspense>
  );
}
