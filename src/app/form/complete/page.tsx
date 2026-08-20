"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { Check, Compass } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import QuickModeBanner from "@/components/QuickModeBanner";
import { safeImageUrl } from "@/lib/sanitize";

export default function CompletePage() {
  const [{ tagCount, avatarUrl, evaluationUrl, studentName, studentId }, setSummary] = useState<{
    tagCount: number;
    avatarUrl: string | null;
    evaluationUrl: string | null;
    studentName: string;
    studentId: string;
  }>({ tagCount: 0, avatarUrl: null, evaluationUrl: null, studentName: "", studentId: "" });

  // 挂载后读取档案摘要（避免 SSR/prerender 访问 localStorage）
  /* eslint-disable react-hooks/set-state-in-effect -- load persisted state on mount */
  useEffect(() => {
    const profile = localStorage.getItem("career_demo_profile");
    if (profile) {
      const data = JSON.parse(profile);
      setSummary({
        tagCount: data.tags?.length || 0,
        avatarUrl: safeImageUrl(data.avatarUrl),
        evaluationUrl: safeImageUrl(data.evaluationUrl),
        studentName: data.name || "",
        studentId: data.studentId || "",
      });
    }
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <NavigationBar title="提交完成" showHome />
      <QuickModeBanner />
      <main className="flex-1">
        {/* 深绿仪式感 hero */}
        <section className="bg-brand text-white">
          <div className="max-w-xl mx-auto px-6 py-14 sm:py-18 text-center space-y-5">
            <Compass size={40} strokeWidth={1.5} className="text-accent mx-auto" aria-hidden />
            <div className="w-20 h-20 rounded-full bg-white/10 flex items-center justify-center mx-auto">
              <Check size={40} strokeWidth={3} className="text-white" />
            </div>
            <h1 className="text-3xl sm:text-4xl font-extrabold tracking-tight">提交成功！</h1>
            <p className="text-white/80">你的职业探索档案已保存</p>
          </div>
        </section>

        {/* 档案摘要 + 评价词云 + CTA */}
        <div className="max-w-xl mx-auto px-6 py-8 space-y-6">
          <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
            {studentName && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">姓名</span>
                <span className="font-medium text-gray-800 dark:text-gray-100">{studentName}</span>
              </div>
            )}
            {studentId && (
              <div className="flex justify-between text-sm">
                <span className="text-gray-500 dark:text-gray-400">学号</span>
                <span className="font-medium text-gray-800 dark:text-gray-100">{studentId}</span>
              </div>
            )}
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">标签数量</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{tagCount} 个</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">虚拟形象</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{avatarUrl ? "已上传" : "未上传"}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">评价词云</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{evaluationUrl ? "已上传" : "未上传"}</span>
            </div>
          </div>

          {evaluationUrl && (
            <div>
              <p className="text-xs text-gray-500 dark:text-gray-400 text-center mb-2">评价词云</p>
              <img src={evaluationUrl} alt="评价词云" className="w-full rounded-xl border border-gray-100 dark:border-gray-700" />
            </div>
          )}

          <Link
            href="/"
            className="block w-full py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl text-center transition-colors shadow-md"
          >
            返回首页
          </Link>
        </div>
      </main>
    </div>
  );
}
