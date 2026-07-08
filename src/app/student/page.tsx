"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import NavigationBar from "@/components/NavigationBar";

export default function StudentPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const saved = localStorage.getItem("career_demo_student_id");
    if (saved) setStudentId(saved);
  }, []);

  const updateStudentId = (value: string) => {
    const cleaned = value.replace(/\D/g, "").slice(0, 12);
    setStudentId(cleaned);
    localStorage.setItem("career_demo_student_id", cleaned);
  };

  const handleSubmit = async () => {
    const trimmed = studentId.trim();
    if (!/^\d{12}$/.test(trimmed)) {
      toast.warning("请输入12位数字学号");
      return;
    }

    setLoading(true);
    try {
      const res = await fetch("/api/validate-student", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId: trimmed }),
      });
      const data = await res.json();

      if (data.ok) {
        toast.success(`你好，${data.name}同学！`);
        localStorage.setItem("career_demo_student", JSON.stringify(data));
        setTimeout(() => router.push("/tags"), 1000);
      } else {
        toast.error(data.error || "学号不存在");
      }
    } catch {
      toast.error("验证失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Toaster position="top-center" />
      <NavigationBar title="学号验证" showBack />
      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <div className="w-20 h-20 rounded-2xl bg-blue-500 flex items-center justify-center shadow-lg">
          <svg
            width="40"
            height="40"
            viewBox="0 0 24 24"
            fill="none"
            stroke="white"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
          >
            <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
            <circle cx="12" cy="7" r="4" />
          </svg>
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold text-gray-900">请输入学号</h1>
          <p className="text-sm text-gray-500">12位数字学号</p>
        </div>
        <input
          type="text"
          value={studentId}
          onChange={(e) => updateStudentId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="请输入学号"
          maxLength={12}
          className="w-full max-w-xs px-4 py-3 border border-gray-200 rounded-xl text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-blue-300 focus:border-transparent"
        />
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full max-w-xs py-3 bg-blue-500 hover:bg-blue-600 disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
        >
          {loading ? "验证中..." : "下一步"}
        </button>
      </main>
    </div>
  );
}
