import { NextRequest, NextResponse } from "next/server";
import { resetTagsToDefaults } from "@/lib/db";
import { getAuditActor, getRequestContext, recordAudit } from "@/lib/audit";

/** 恢复默认预设（#94 补充）：清空全部标签后重插默认预设（需前端二次确认） */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const actor = await getAuditActor(request);
  try {
    await resetTagsToDefaults();
    void recordAudit({
      ...actor, action: "tag:restore-defaults", method: "POST", path: "/api/manage/tags/restore",
      resource_type: "tag", resource_id: null,
      status: "success", error_message: null, ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Tags restore POST error:", err);
    return NextResponse.json({ error: "恢复默认失败" }, { status: 500 });
  }
}
