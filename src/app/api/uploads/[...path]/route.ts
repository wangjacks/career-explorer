import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  const filename = pathSegments.join("/");
  const uploadsDir = path.resolve(process.cwd(), "uploads");
  const filepath = path.resolve(uploadsDir, filename);

  // 路径穿越防护：确保解析后的路径仍在 uploads 目录内
  if (!filepath.startsWith(uploadsDir + path.sep) && filepath !== uploadsDir) {
    return NextResponse.json({ error: "禁止访问" }, { status: 403 });
  }

  try {
    const data = await readFile(filepath);
    const ext = path.extname(filename).toLowerCase();
    const mimeMap: Record<string, string> = {
      ".jpg": "image/jpeg",
      ".jpeg": "image/jpeg",
      ".png": "image/png",
      ".gif": "image/gif",
      ".webp": "image/webp",
      ".svg": "image/svg+xml",
    };
    const contentType = mimeMap[ext] || "application/octet-stream";

    return new NextResponse(data, {
      headers: {
        "Content-Type": contentType,
        "Cache-Control": "no-cache",
      },
    });
  } catch {
    return NextResponse.json({ error: "文件不存在" }, { status: 404 });
  }
}
