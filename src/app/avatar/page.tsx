"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { Toaster, toast } from "sonner";
import NavigationBar from "@/components/NavigationBar";

export default function AvatarPage() {
  const router = useRouter();
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);

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
      toast.warning("请先选择头像");
      return;
    }

    setUploading(true);
    try {
      const tags = JSON.parse(localStorage.getItem("career_demo_tags") || "[]");

      const fileInput = fileInputRef.current;
      const file = fileInput?.files?.[0];
      let avatarUrl = imageUrl;

      if (file) {
        const formData = new FormData();
        formData.append("file", file);
        const uploadRes = await fetch("/api/upload", {
          method: "POST",
          body: formData,
        });
        if (!uploadRes.ok) throw new Error("上传失败");
        const { url } = await uploadRes.json();
        avatarUrl = url;
      }

      const profileRes = await fetch("/api/profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ tags, avatarUrl }),
      });
      if (!profileRes.ok) throw new Error("保存失败");

      localStorage.setItem(
        "career_demo_profile",
        JSON.stringify({ tags, avatarUrl })
      );
      router.push("/complete");
    } catch {
      toast.error("操作失败，请重试");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="flex flex-col min-h-screen bg-gray-50">
      <Toaster position="top-center" />
      <NavigationBar title="虚拟形象" showBack />
      <main className="flex-1 flex flex-col items-center justify-center px-6 gap-8">
        <div
          onClick={() => fileInputRef.current?.click()}
          className="w-56 h-56 rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-green-400 transition-colors overflow-hidden bg-white"
        >
          {imageUrl ? (
            <img
              src={imageUrl}
              alt="头像预览"
              className="w-full h-full object-cover"
            />
          ) : (
            <div className="flex flex-col items-center gap-2 text-gray-400">
              <svg
                width="48"
                height="48"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2" />
                <circle cx="12" cy="7" r="4" />
              </svg>
              <span className="text-sm">点击选择头像</span>
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
          className="w-full max-w-lg mx-auto block py-3 bg-green-500 hover:bg-green-600 disabled:opacity-50 text-white font-medium rounded-xl transition-colors"
        >
          {uploading ? "上传中..." : "上传并继续"}
        </button>
      </div>
    </div>
  );
}
