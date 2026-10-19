import { NextRequest, NextResponse } from "next/server";
import { resetTagsToDefaults } from "@/lib/db";
import { getRequestContext, recordAudit } from "@/lib/audit";
import { WriteGuard, type AuditTarget, GLOBAL_WRITE_ONLY } from "../../write-guard";

const RESTORE: AuditTarget = {
  action: "tag:restore-defaults",
  method: "POST",
  path: "/api/manage/tags/restore",
  resource_type: "tag",
};

/** 恢复默认预设（#94 补充）：清空全部标签后重插默认预设（需前端二次确认） */
export async function POST(request: NextRequest) {
  const { ip, user_agent } = getRequestContext(request);
  const guard = await WriteGuard.from(request);
  const actor = guard.actor;
  try {
    if (!guard.session) return guard.unauthenticated();
    if (!guard.canWriteGlobal) return guard.deny(RESTORE, null, GLOBAL_WRITE_ONLY);
    await resetTagsToDefaults();
    void recordAudit({
      ...actor, ...RESTORE, resource_id: null,
      status: "success", error_message: null, ip, user_agent, metadata: null,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("Tags restore POST error:", err);
    return NextResponse.json({ error: "恢复默认失败" }, { status: 500 });
  }
}
