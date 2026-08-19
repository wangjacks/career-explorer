"use client";

import { useRef, useState } from "react";
import { toast } from "sonner";
import { safeImageUrl } from "@/lib/sanitize";

interface ImageUploadBoxProps {
  /** 已有图片 URL（经 safeImageUrl 校验后展示） */
  initialUrl?: string;
  /** 上传前缀：avatar / evaluation */
  prefix: "avatar" | "evaluation";
  studentId: string;
  /** 预览框宽高比：square 头像 / wide 评价词云 */
  aspect?: "square" | "wide";
  emptyHint?: string;
  /** 上传成功回调（返回带时间戳的 URL） */
  onUploaded: (url: string) => void;
}

/** 图片上传框：点击选图 + 本地预览 + 选中即上传（学生面板就地修改用） */
export default function ImageUploadBox({
  initialUrl,
  prefix,
  studentId,
  aspect = "square",
  emptyHint = "点击上传图片",
  onUploaded,
}: ImageUploadBoxProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(() => safeImageUrl(initialUrl));
  const [uploading, setUploading] = useState(false);

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }

    setPreview(URL.createObjectURL(file));
    setUploading(true);
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("prefix", prefix);
      formData.append("studentId", studentId);
      const res = await fetch("/api/upload", { method: "POST", body: formData });
      if (!res.ok) throw new Error("上传失败");
      const { url } = await res.json();
      onUploaded(`${url}?t=${Date.now()}`);
    } catch {
      toast.error("上传失败，请重试");
    } finally {
      setUploading(false);
    }
  };

  const aspectClass = aspect === "wide" ? "aspect-[4/3]" : "aspect-square";

  return (
    <div className="space-y-2">
      <div
        onClick={() => fileInputRef.current?.click()}
        className={`w-full ${aspectClass} max-w-xs rounded-2xl border-2 border-dashed border-gray-300 flex items-center justify-center cursor-pointer hover:border-green-400 transition-colors overflow-hidden bg-white relative`}
      >
        {preview ? (
          <img src={preview} alt="预览" className="w-full h-full object-contain" />
        ) : (
          <div className="flex flex-col items-center gap-2 text-gray-400 px-4 text-center">
            <svg width="36" height="36" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
              <circle cx="8.5" cy="8.5" r="1.5" />
              <polyline points="21 15 16 10 5 21" />
            </svg>
            <span className="text-xs">{emptyHint}</span>
          </div>
        )}
        {uploading && (
          <div className="absolute inset-0 bg-white/70 flex items-center justify-center">
            <span className="text-sm text-gray-500">上传中...</span>
          </div>
        )}
      </div>
      {preview && (
        <button
          type="button"
          onClick={() => fileInputRef.current?.click()}
          className="text-xs text-gray-500 hover:text-gray-700"
        >
          重新选择
        </button>
      )}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />
    </div>
  );
}
