import { NextRequest, NextResponse } from "next/server";
import { readFile } from "fs/promises";
import path from "path";
import { withDemoScope } from "@/lib/demo-scope";
import { getUploadsBaseDir } from "@/lib/storage-local";

async function GET_impl(
  _request: NextRequest,
  { params }: { params: Promise<{ path: string[] }> }
) {
  const { path: pathSegments } = await params;
  const filename = pathSegments.join("/");
  // 演示作用域解析到 uploads/demo/（#253 S1），否则 uploads/；键始终扁平，demo 段只来自基目录
  const uploadsDir = getUploadsBaseDir();
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

export const GET = withDemoScope(GET_impl);
