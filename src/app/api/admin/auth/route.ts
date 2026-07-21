import { NextRequest, NextResponse } from "next/server";
import { verifyPassword, signToken } from "@/lib/auth";
import { readFileSync } from "fs";
import { join } from "path";

/** 读取密码 hash：优先从 admin-hash.txt 文件读取，否则从环境变量读取 */
function getPasswordHash(): string | null {
  try {
    const filePath = join(process.cwd(), "admin-hash.txt");
    const hash = readFileSync(filePath, "utf-8").trim();
    if (hash) return hash;
  } catch {
    // file not found, fallback to env — this is expected on first run
  }
  return process.env.ADMIN_PASSWORD_HASH || null;
}

export async function POST(request: NextRequest) {
  try {
    const { password } = await request.json();
    const hash = getPasswordHash();

    if (!hash) {
      return NextResponse.json({ ok: false, error: "服务器未配置管理员密码" }, { status: 500 });
    }

    const valid = await verifyPassword(password, hash);
    if (!valid) {
      return NextResponse.json({ ok: false, error: "密码错误" }, { status: 401 });
    }

    const token = await signToken();
    const response = NextResponse.json({ ok: true });
    const isSecure = request.nextUrl.protocol === "https:"
      || request.headers.get("x-forwarded-proto") === "https";
    response.cookies.set("admin_token", token, {
      httpOnly: true,
      secure: isSecure,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    response.cookies.set("admin_logged_in", "1", {
      secure: isSecure,
      sameSite: "strict",
      path: "/",
      maxAge: 60 * 60 * 24,
    });
    return response;
  } catch (err) {
    console.error("Auth POST error:", err);
    return NextResponse.json({ ok: false, error: "服务器错误" }, { status: 500 });
  }
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set("admin_token", "", { maxAge: 0 });
  response.cookies.set("admin_logged_in", "", { maxAge: 0 });
  return response;
}
