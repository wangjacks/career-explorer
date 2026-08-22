"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { LogIn, UserRound } from "lucide-react";
import { useSession } from "@/hooks/useSession";

export interface ProfileInfo {
  user_code: string;
  submitted_at: string | null;
  avatar_url: string;
  evaluation_url: string;
}

interface LoginGateStepProps {
  /** 通过登录门：携带本人档案信息（未提交学生） */
  onEnter: (profile: ProfileInfo) => void;
}

/** 第一步 · 登录门：未登录提示登录；已提交学生引导去面板修改；未提交学生问候并进入流程 */
export default function LoginGateStep({ onEnter }: LoginGateStepProps) {
  const router = useRouter();
  const { session, checking } = useSession();
  const [verifying, setVerifying] = useState(false);
  const [alreadySubmitted, setAlreadySubmitted] = useState(false);
  const [error, setError] = useState("");

  if (checking) {
    return <p className="text-center py-10 text-sm text-gray-400 dark:text-gray-500">加载中...</p>;
  }

  if (!session) {
    return (
      <div className="w-full max-w-sm sm:max-w-md mx-auto bg-card rounded-2xl shadow-xl p-8 space-y-5 text-center">
        <div className="w-14 h-14 rounded-2xl bg-brand flex items-center justify-center mx-auto">
          <LogIn size={26} className="text-accent" aria-hidden />
        </div>
        <div className="space-y-1">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">请先登录</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">
            档案创建需要登录，登录后即可继续填写
          </p>
        </div>
        <button
          onClick={() => router.push("/login?next=/form/create-profile")}
          className="w-full py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
        >
          去登录
        </button>
      </div>
    );
  }

  if (session.role !== "student") {
    return (
      <div className="w-full max-w-sm sm:max-w-md mx-auto bg-card rounded-2xl shadow-xl p-8 space-y-4 text-center">
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">此流程仅限学生使用</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">当前登录身份无需创建学生档案</p>
        <Link
          href={`/dashboard/${session.role}`}
          className="block w-full py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
        >
          前往我的面板
        </Link>
      </div>
    );
  }

  if (alreadySubmitted) {
    return (
      <div className="w-full max-w-sm sm:max-w-md mx-auto bg-card rounded-2xl shadow-xl p-8 space-y-4 text-center">
        <div className="w-14 h-14 rounded-2xl bg-brand flex items-center justify-center mx-auto">
          <UserRound size={26} className="text-accent" aria-hidden />
        </div>
        <h1 className="text-lg font-bold text-gray-900 dark:text-gray-100">你已提交过档案</h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">如需修改数据，请前往学生面板操作</p>
        <Link
          href="/dashboard/student"
          className="block w-full py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl transition-colors"
        >
          前往学生面板
        </Link>
      </div>
    );
  }

  const handleNext = async () => {
    setError("");
    setVerifying(true);
    try {
      const res = await fetch("/api/shared/profile");
      const data = await res.json();
      if (!res.ok) throw new Error(data?.error || "档案状态查询失败");
      if (data.submitted_at) {
        setAlreadySubmitted(true);
        return;
      }
      onEnter({
        user_code: data.user_code,
        submitted_at: data.submitted_at,
        avatar_url: data.avatar_url || "",
        evaluation_url: data.evaluation_url || "",
      });
    } catch (err) {
      console.error("Profile check failed:", err);
      setError(err instanceof Error ? err.message : "档案状态查询失败，请重试");
    } finally {
      setVerifying(false);
    }
  };

  return (
    <div className="w-full max-w-sm sm:max-w-md mx-auto bg-card rounded-2xl shadow-xl p-8 space-y-5 text-center">
      <div className="w-14 h-14 rounded-2xl bg-brand flex items-center justify-center mx-auto">
        <UserRound size={26} className="text-accent" aria-hidden />
      </div>
      <div className="space-y-1">
        <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">
          您好，{session.name}同学！
        </h1>
        <p className="text-sm text-gray-500 dark:text-gray-400">准备好创建你的职业探索档案了吗？</p>
      </div>
      {error && <p className="text-sm text-red-500">{error}</p>}
      <button
        onClick={handleNext}
        disabled={verifying}
        className="w-full py-3 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
      >
        {verifying ? "核验中..." : "下一步"}
      </button>
    </div>
  );
}
