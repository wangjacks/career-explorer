"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";

/** 教师面板占位页（实质内容在后续步骤实现） */
export default function TeacherDashboardPage() {
  const router = useRouter();

  const handleLogout = async () => {
    try {
      await fetch("/api/auth", { method: "DELETE" });
    } catch (err) {
      console.error("Logout failed:", err);
    }
    router.push("/login");
  };

  return (
    <div className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="w-full max-w-sm sm:max-w-md bg-white rounded-2xl shadow-sm border border-gray-100 p-8 space-y-6 text-center">
        <div className="w-16 h-16 bg-green-100 rounded-2xl flex items-center justify-center mx-auto">
          <svg className="w-8 h-8 text-green-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4.354a4 4 0 110 5.292M15 21H3v-1a6 6 0 0112 0v1zm0 0h6v-1a6 6 0 00-9-5.197M13 7a4 4 0 11-8 0 4 4 0 018 0z" />
          </svg>
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">教师面板</h1>
          <p className="text-sm text-gray-500 mt-2">建设中，将在后续版本上线</p>
        </div>
        <div className="flex items-center justify-center gap-3">
          <button
            onClick={handleLogout}
            className="px-6 py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
          >
            退出登录
          </button>
          <Link
            href="/"
            className="px-6 py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
          >
            返回首页
          </Link>
        </div>
      </div>
    </div>
  );
}
