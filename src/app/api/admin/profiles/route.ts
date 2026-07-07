import { NextRequest, NextResponse } from "next/server";
import { getAllProfiles } from "@/lib/db";

function checkAuth(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const password = process.env.ADMIN_PASSWORD || "admin123";
  return auth === `Bearer ${password}`;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const { searchParams } = new URL(request.url);
  const page = parseInt(searchParams.get("page") || "1", 10);
  const pageSize = parseInt(searchParams.get("pageSize") || "20", 10);

  const { rows, total } = getAllProfiles(page, pageSize);

  return NextResponse.json({
    data: rows.map((r) => ({
      id: r.id,
      tags: JSON.parse(r.tags),
      avatarUrl: r.avatar_url,
      createdAt: r.created_at,
    })),
    total,
    page,
    pageSize,
    totalPages: Math.ceil(total / pageSize),
  });
}
