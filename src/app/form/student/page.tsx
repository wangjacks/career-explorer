"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { User, CircleAlert } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import QuickModeBanner from "@/components/QuickModeBanner";
import FormSteps from "@/components/FormSteps";

interface ExistingProfile {
  tags: string[];
  avatarUrl: string;
  evaluationUrl: string;
}

export default function StudentPage() {
  const router = useRouter();
  const [studentId, setStudentId] = useState("");
  const [loading, setLoading] = useState(false);
  const [confirmData, setConfirmData] = useState<{
    studentId: string;
    name: string;
    profile: ExistingProfile;
  } | null>(null);

  // 挂载后读取上次学号（避免 SSR/prerender 访问 localStorage）
  /* eslint-disable react-hooks/set-state-in-effect -- load persisted state on mount */
  useEffect(() => {
    setStudentId(localStorage.getItem("career_demo_student_id") || "");
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

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
        if (data.hasProfile && data.profile) {
          setConfirmData({
            studentId: data.studentId,
            name: data.name,
            profile: data.profile,
          });
        } else {
          localStorage.setItem("career_demo_student", JSON.stringify(data));
          router.push("/form/tags");
        }
      } else {
        toast.error(data.error || "学号不存在");
      }
    } catch {
      toast.error("验证失败，请重试");
    } finally {
      setLoading(false);
    }
  };

  const handleRestore = () => {
    if (!confirmData) return;
    const studentData = { studentId: confirmData.studentId, name: confirmData.name };
    localStorage.setItem("career_demo_student", JSON.stringify(studentData));
    localStorage.setItem("career_demo_tags", JSON.stringify(confirmData.profile.tags));
    localStorage.setItem("career_demo_evaluation", confirmData.profile.evaluationUrl || "");
    localStorage.setItem("career_demo_profile", JSON.stringify({
      studentId: confirmData.studentId,
      tags: confirmData.profile.tags,
      avatarUrl: confirmData.profile.avatarUrl,
      evaluationUrl: confirmData.profile.evaluationUrl || "",
      name: confirmData.name,
    }));
    setConfirmData(null);
    router.push("/form/tags");
  };

  const handleStartFresh = () => {
    if (!confirmData) return;
    const studentData = { studentId: confirmData.studentId, name: confirmData.name };
    localStorage.removeItem("career_demo_tags");
    localStorage.removeItem("career_demo_custom_input");
    localStorage.removeItem("career_demo_evaluation");
    localStorage.removeItem("career_demo_profile");
    localStorage.setItem("career_demo_student", JSON.stringify(studentData));
    setConfirmData(null);
    router.push("/form/tags");
  };

  return (
    <div className="flex flex-col min-h-screen bg-background">
      <Toaster position="top-center" />
      <NavigationBar title="学号验证" showBack />
      <QuickModeBanner />
      <div className="pt-5">
        <FormSteps current={1} />
      </div>
      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <div className="w-20 h-20 rounded-2xl bg-brand flex items-center justify-center shadow-lg">
          <User size={40} strokeWidth={2} className="text-accent" />
        </div>
        <div className="text-center space-y-2">
          <h1 className="text-xl font-bold text-gray-900 dark:text-gray-100">请输入学号</h1>
          <p className="text-sm text-gray-500 dark:text-gray-400">12位数字学号</p>
        </div>
        <input
          type="text"
          value={studentId}
          onChange={(e) => updateStudentId(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && handleSubmit()}
          placeholder="请输入学号"
          maxLength={12}
          className="w-full max-w-xs sm:max-w-sm md:max-w-md px-4 py-3 border border-gray-200 dark:border-gray-700 bg-card text-foreground rounded-xl text-center text-lg tracking-widest focus:outline-none focus:ring-2 focus:ring-green-300 focus:border-transparent"
        />
        <button
          onClick={handleSubmit}
          disabled={loading}
          className="w-full max-w-xs sm:max-w-sm md:max-w-md py-3 bg-primary hover:bg-primary-strong disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
        >
          {loading ? "验证中..." : "下一步"}
        </button>
      </main>

      {/* Restore Confirmation Modal */}
      {confirmData && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-4">
          <div className="bg-white rounded-2xl shadow-xl max-w-sm sm:max-w-md w-full p-6 space-y-5">
            <div className="text-center space-y-2">
              <div className="w-14 h-14 mx-auto rounded-full bg-amber-100 flex items-center justify-center">
                <CircleAlert size={28} className="text-amber-600" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900">检测到已有填写记录</h3>
              <p className="text-sm text-gray-500">
                <span className="font-medium text-gray-700">{confirmData.name}</span>
                同学，你之前已提交过职业探索档案。
              </p>
            </div>

            <div className="bg-gray-50 rounded-xl p-4 space-y-2">
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">上次提交的标签</span>
                <span className="text-gray-700">{confirmData.profile.tags.length} 个</span>
              </div>
              <div className="flex justify-between text-sm">
                <span className="text-gray-500">虚拟形象</span>
                <span className="text-gray-700">
                  {confirmData.profile.avatarUrl ? "已上传" : "未上传"}
                </span>
              </div>
            </div>

            <div className="space-y-2">
              <button
                onClick={handleRestore}
                className="w-full py-3 bg-green-500 hover:bg-green-600 text-white font-medium rounded-xl transition-colors"
              >
                恢复上次结果
              </button>
              <button
                onClick={handleStartFresh}
                className="w-full py-3 bg-gray-100 hover:bg-gray-200 text-gray-700 font-medium rounded-xl transition-colors"
              >
                重新填写
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
