import { NextRequest, NextResponse } from "next/server";
import { backup, restore, type BackupData } from "@/lib/db";

export async function GET() {
  try {
    const data = await backup();
    return NextResponse.json(data);
  } catch (err) {
    console.error("Backup error:", err);
    return NextResponse.json(
      { error: `备份失败: ${err instanceof Error ? err.message : "未知错误"}` },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const data = (await request.json()) as BackupData;

    if (!data.version || !Array.isArray(data.users) || !Array.isArray(data.tags)) {
      return NextResponse.json({ error: "备份文件格式无效" }, { status: 400 });
    }

    await restore(data);
    return NextResponse.json({ ok: true, message: "恢复成功" });
  } catch (err) {
    console.error("Restore error:", err);
    return NextResponse.json(
      { error: `恢复失败: ${err instanceof Error ? err.message : "未知错误"}` },
      { status: 500 }
    );
  }
}
