"use client";

import Link from "next/link";
import { Check, Compass } from "lucide-react";

interface CompleteStepProps {
  studentName: string;
  userCode: string;
  tagCount: number;
}

/** 第七步 · 提交完成（深绿仪式感 hero + 档案摘要） */
export default function CompleteStep({ studentName, userCode, tagCount }: CompleteStepProps) {
  return (
    <main className="flex-1">
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

      <div className="max-w-xl mx-auto px-6 py-8 space-y-6">
        <div className="bg-card rounded-xl p-4 shadow-sm border border-gray-100 dark:border-gray-700 space-y-3">
          {studentName && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">姓名</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{studentName}</span>
            </div>
          )}
          {userCode && (
            <div className="flex justify-between text-sm">
              <span className="text-gray-500 dark:text-gray-400">学号</span>
              <span className="font-medium text-gray-800 dark:text-gray-100">{userCode}</span>
            </div>
          )}
          <div className="flex justify-between text-sm">
            <span className="text-gray-500 dark:text-gray-400">标签数量</span>
            <span className="font-medium text-gray-800 dark:text-gray-100">{tagCount} 个</span>
          </div>
        </div>

        <Link
          href="/"
          className="block w-full py-3 bg-primary hover:bg-primary-strong text-white font-medium rounded-xl text-center transition-colors shadow-md"
        >
          返回首页
        </Link>
      </div>
    </main>
  );
}
