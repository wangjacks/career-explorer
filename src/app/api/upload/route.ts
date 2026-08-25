import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { getDefaultStorageBackend, getMaxAvatarSizeMb, getMaxEvaluationSizeMb } from "@/lib/db";
import { generateObjectKey, getStorage } from "@/lib/storage";

/** 压缩尺寸上限（#111，保持宽高比，只缩小不放大）：头像 512×512、词云长边 1024 */
const RESIZE_LIMITS: Record<string, { width: number; height: number }> = {
  avatar: { width: 512, height: 512 },
  evaluation: { width: 1024, height: 1024 },
};

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const prefix = formData.get("prefix") as string | null;
    const studentId = formData.get("studentId") as string | null;

    if (!file) {
      return NextResponse.json({ error: "未选择文件" }, { status: 400 });
    }

    if (!file.type.startsWith("image/")) {
      return NextResponse.json({ error: "仅支持图片文件" }, { status: 400 });
    }

    // SVG 可内嵌脚本，直接提供会构成存储型 XSS（#111 安全加固）：显式拒绝，仅接受经 sharp 光栅化的位图
    if (file.type.includes("svg") || /\.(svg|svgz)$/i.test(file.name ?? "")) {
      return NextResponse.json({ error: "不支持 SVG 格式，请使用 JPG / PNG 等图片" }, { status: 400 });
    }

    if (!prefix || !studentId) {
      return NextResponse.json({ error: "缺少 prefix 或 studentId" }, { status: 400 });
    }
    if (prefix !== "avatar" && prefix !== "evaluation") {
      return NextResponse.json({ error: "资源类型无效" }, { status: 400 });
    }

    // 按资源类型校验大小上限（#111，管理后台可配置，默认头像 5MB / 词云 10MB）
    const limitMb = prefix === "avatar" ? await getMaxAvatarSizeMb() : await getMaxEvaluationSizeMb();
    if (file.size > limitMb * 1024 * 1024) {
      return NextResponse.json({ error: `图片大小不能超过 ${limitMb}MB` }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    // 服务端压缩（#111）：尺寸约束 + 质量 85，只存处理后版本，降低存储与带宽成本
    const resize = RESIZE_LIMITS[prefix];
    const jpgBuffer = await sharp(buffer)
      .resize({ width: resize.width, height: resize.height, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();

    // 写入当前默认存储后端（#111），并返回文件所在后端 id 供档案保存记录路由
    const backend = await getDefaultStorageBackend();
    if (!backend) {
      return NextResponse.json({ error: "存储后端未初始化" }, { status: 500 });
    }
    const key = generateObjectKey(prefix, studentId);

    if (backend.type === "local") {
      // 动态路径校验需运行时解析（防穿越），豁免 Turbopack 静态追踪
      const uploadDir = path.resolve(/*turbopackIgnore: true*/ process.cwd(), "uploads");
      await mkdir(uploadDir, { recursive: true });
      await writeFile(path.join(uploadDir, key), jpgBuffer);
      return NextResponse.json({ url: `/api/uploads/${key}`, storageId: backend.id });
    }

    const storage = await getStorage(backend.id);
    await storage.upload(key, jpgBuffer, "image/jpeg");
    return NextResponse.json({ url: key, storageId: backend.id });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
