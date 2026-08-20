"use client";

import { useEffect, useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import { Image as ImageIcon } from "lucide-react";
import NavigationBar from "@/components/NavigationBar";
import QuickModeBanner from "@/components/QuickModeBanner";
import { safeImageUrl } from "@/lib/sanitize";

export default function EvaluationPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

  // 挂载后读取已上传评价词云（避免 SSR/prerender 访问 localStorage）
  /* eslint-disable react-hooks/set-state-in-effect -- load persisted state on mount */
  useEffect(() => {
    setImageUrl(safeImageUrl(localStorage.getItem("career_demo_evaluation")));
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    setImageUrl(URL.createObjectURL(file));
  };

  const handleNext = async () => {
    if (!imageUrl) {
      toast.warning("请先上传评价词云图片");
      return;
    }

    const studentStr = localStorage.getItem("career_demo_student");
    if (!studentStr) {
      toast.error("学号信息丢失，请重新开始");
      return;
    }
    const student = JSON.parse(studentStr);

    setUploading(true);
    try {
      const fileInput = fileInputRef.current;
      const file = fileInput?.files?.[0];

      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        formData.append("prefix", "evaluation");
        formData.append("studentId", student.studentId);
        const uploadRes = await fetch("/api/upload", { method: "POST", body: formData });
        if (!uploadRes.ok) throw new Error("上传失败");
        const { url } = await uploadRes.json();
        localStorage.setItem("career_demo_evaluation", `${url}?t=${Date.now()}`);
      }

      router.push("/form/avatar");
    } catch {
      toast.error("上传失败，请重试");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Toaster position="top-center" />
      <NavigationBar title="评价词云上传" showBack />
      <QuickModeBanner />
      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="w-full max-w-sm sm:max-w-md md:max-w-lg aspect-[4/3] rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-green-400 transition-colors overflow-hidden bg-white"
        >
          {imageUrl ? (
            <img src={imageUrl} alt="评价词云预览" className="w-full h-full object-contain" />
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <ImageIcon size={48} strokeWidth={1.5} />
              <span className="text-sm">点击上传评价词云图片</span>
              <span className="text-xs text-gray-300">支持 JPG、PNG、WebP 等格式</span>
            </div>
          )}
        </div>
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          onChange={handleFileChange}
          className="hidden"
        />
        {imageUrl && (
          <button
            onClick={() => {
              setImageUrl(null);
              localStorage.removeItem("career_demo_evaluation");
              if (fileInputRef.current) fileInputRef.current.value = "";
            }}
            className="text-sm text-gray-500 hover:text-gray-700"
          >
            重新选择
          </button>
        )}
      </main>

      <div className="sticky bottom-0 bg-white/80 backdrop-blur-md border-t border-gray-100 p-4">
        <button
          onClick={handleNext}
          disabled={uploading}
          className="w-full max-w-lg sm:max-w-xl md:max-w-2xl mx-auto block py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
        >
          {uploading ? "上传中..." : "下一步"}
        </button>
      </div>
    </div>
  );
}
