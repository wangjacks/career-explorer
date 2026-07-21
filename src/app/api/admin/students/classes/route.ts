import { NextResponse } from "next/server";
import { getClasses } from "@/lib/db";

export async function GET() {
  try {
    const classes = await getClasses();
    return NextResponse.json({ data: classes });
  } catch (err) {
    console.error("Classes GET error:", err);
    return NextResponse.json({ error: "获取班级列表失败" }, { status: 500 });
  }
}
