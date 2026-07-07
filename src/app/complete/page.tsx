"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import NavigationBar from "@/components/NavigationBar";

export default function CompletePage() {
  const [tagCount, setTagCount] = useState(0);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  useEffect(() => {
    const profile = localStorage.getItem("career_demo_profile");
    if (profile) {
      const data = JSON.parse(profile);
      setTagCount(data.tags?.length || 0);
      setAvatarUrl(data.avatarUrl || null);
    }
  }, []);

  return (
    <div className="flex flex-col min-h-screen bg-gradient-to-b from-green-50 to-white">
      <NavigationBar title="提交完成" showHome />
      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <div className="w-20 h-20 rounded-full bg-green-500 flex items-center justify-center shadow-lg">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="3"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <polyline points="20 6 9 17 4 12" />
          </svg>
        </div>
        <div className="text-center space-y-3">
          <h1 className="text-2xl font-bold text-gray-900">提交成功！</h1>
          <p className="text-gray-500">你的职业规划信息已保存</p>
        </div>

        <div className="w-full max-w-xs bg-white rounded-xl p-4 shadow-sm border border-gray-100 space-y-3">
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">标签数量</span>
            <span className="font-medium text-gray-800">{tagCount} 个</span>
          </div>
          <div className="flex justify-between text-sm">
            <span className="text-gray-500">头像</span>
            <span className="font-medium text-gray-800">
              {avatarUrl ? "已上传" : "未上传"}
            </span>
          </div>
        </div>

        <Link
          href="/"
          className="w-full max-w-xs py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl text-center transition-colors shadow-md"
        >
          返回首页
        </Link>
      </main>
    </div>
  );
}
