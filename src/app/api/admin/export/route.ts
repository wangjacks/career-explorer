import { NextRequest, NextResponse } from "next/server";
import { getAllProfilesRaw } from "@/lib/db";

function checkAuth(request: NextRequest) {
  const auth = request.headers.get("authorization");
  const password = process.env.ADMIN_PASSWORD || "admin123";
  return auth === `Bearer ${password}`;
}

export async function GET(request: NextRequest) {
  if (!checkAuth(request)) {
    return NextResponse.json({ error: "未授权" }, { status: 401 });
  }

  const rows = await getAllProfilesRaw();

  const header = "学号,标签,虚拟形象URL,提交时间";
  const lines = rows.map((r) => {
    const tags = JSON.parse(r.tags).join(";");
    const avatar = r.avatar_url || "";
    const time = r.created_at || "";
    return `${r.student_id},"${tags}","${avatar}","${time}"`;
  });

  const csv = "\uFEFF" + header + "\n" + lines.join("\n");

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="profiles_${Date.now()}.csv"`,
    },
  });
}
