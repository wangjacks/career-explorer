import { NextRequest, NextResponse } from "next/server";
import { getStats } from "@/lib/db";

function checkAuth(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const password = process.env.ADMIN_PASSWORD || "admin123";
  return auth === `Bearer ${password}`;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const stats = getStats();
  return NextResponse.json(stats);
}
