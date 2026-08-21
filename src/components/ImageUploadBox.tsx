"use client";

import { useRef, useState } from "react";
import { Image as ImageIcon } from "lucide-react";
import { toast } from "sonner";
import { safeImageUrl } from "@/lib/sanitize";

interface ImageUploadBoxProps {
  /** 已有图片 URL（经 safeImageUrl 校验后展示） */
  initialUrl?: string;
  /** 预览框宽高比：square 头像 / wide 评价词云 */
  aspect?: "square" | "wide";
  emptyHint?: string;
  /** 选图/清除时回调 File（未上传；确认真实保存时才由调用方上传） */
  onFileSelected: (file: File | null) => void;
}

/**
 * 图片上传框：点击选图 + 本地预览。
 * 采用延迟上传设计——选图只做本地预览并透出 File，
 * 由调用方在用户确认保存时才真正上传，取消编辑则不产生任何服务端变更。
 */
export default function ImageUploadBox({
  initialUrl,
  aspect = "square",
  emptyHint = "点击上传图片",
  onFileSelected,
}: ImageUploadBoxProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(() => safeImageUrl(initialUrl));
  const [pending, setPending] = useState(false);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      toast.error("请选择图片文件");
      return;
    }
    const objectUrl = URL.createObjectURL(file);
    // createObjectURL 理论上恒生成 blob: 协议；显式前缀校验作为渲染前 guard（防 DOM 重解释）
    if (!objectUrl.startsWith("blob:")) return;
    setPreview(objectUrl);
    setPending(true);
    onFileSelected(file);
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
            <ImageIcon size={36} strokeWidth={1.5} />
            <span className="text-xs">{emptyHint}</span>
          </div>
        )}
        {pending && (
          <span className="absolute top-2 right-2 px-2 py-0.5 bg-amber-100 text-amber-700 rounded-full text-xs">
            待保存
          </span>
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
