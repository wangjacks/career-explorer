import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "fs/promises";
import path from "path";
import sharp from "sharp";
import { getDefaultStorageBackend } from "@/lib/db";

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

    if (!prefix || !studentId) {
      return NextResponse.json({ error: "缺少 prefix 或 studentId" }, { status: 400 });
    }

    const bytes = await file.arrayBuffer();
    const buffer = Buffer.from(bytes);

    const jpgBuffer = await sharp(buffer).jpeg({ quality: 90 }).toBuffer();

    const uploadDir = path.join(process.cwd(), "uploads");
    await mkdir(uploadDir, { recursive: true });

    const filename = `${prefix}_${studentId}.jpg`;
    const filepath = path.join(uploadDir, filename);

    await writeFile(filepath, jpgBuffer);

    // 当前版本固定写入本地；响应携带后端 id 供档案保存记录文件路由（#111）
    const backend = await getDefaultStorageBackend();
    return NextResponse.json({ url: `/api/uploads/${filename}`, storageId: backend?.id ?? 1 });
  } catch (err) {
    console.error("Upload error:", err);
    return NextResponse.json({ error: "上传失败" }, { status: 500 });
  }
}
