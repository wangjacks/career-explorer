import { withDemoScope, runInDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { demoDbExists } from "@/lib/demo-lifecycle";
import { assertVisitorSeq } from "@/lib/demo-accounts";
import {
  disableVisitorAccount,
  rotateVisitorAccountPassword,
  deleteVisitorAccount,
} from "@/lib/demo-accounts-service";
import { guardDemoAdmin } from "../../gate";

type Ctx = { params: Promise<{ seq: string }> };
const PATH = "/api/manage/demo/accounts/[seq]";

/** 解析并校验 seq；非法返回 null（→400） */
function parseSeq(raw: string): number | null {
  const seq = Number(raw);
  if (!Number.isInteger(seq)) return null;
  try {
    assertVisitorSeq(seq);
    return seq;
  } catch {
    return null;
  }
}

/**
 * PATCH：action = disable | enable | regenerate-password。
 * enable 与 regenerate-password 同为「重置密码」（禁用后重生成即恢复）。
 */
async function PATCH_impl(request: NextRequest, ctx: Ctx) {
  const gate = await guardDemoAdmin(request, { action: "demo:account-update", method: "PATCH", path: PATH });
  if (!gate.ok) return gate.response;

  const seq = parseSeq((await ctx.params).seq);
  if (seq === null) {
    return NextResponse.json({ ok: false, error: "账户序号非法" }, { status: 400 });
  }
  if (!demoDbExists()) {
    return NextResponse.json({ ok: false, error: "账户不存在" }, { status: 404 });
  }

  const body = (await request.json().catch(() => ({}))) as { action?: unknown };
  const action = body?.action;

  try {
    if (action === "disable") {
      const account = await runInDemoScope(() => disableVisitorAccount(seq));
      if (!account) return NextResponse.json({ ok: false, error: "账户不存在" }, { status: 404 });
      void recordAudit({
        ...gate.actor, action: "demo:account-disable", method: "PATCH", path: PATH,
        resource_type: "demo-account", resource_id: String(seq), status: "success",
        error_message: null, ip: gate.ip, user_agent: gate.userAgent, metadata: { seq },
      });
      return NextResponse.json({ ok: true, account });
    }

    if (action === "enable" || action === "regenerate-password") {
      const rotation = await runInDemoScope(() => rotateVisitorAccountPassword(seq));
      if (!rotation) return NextResponse.json({ ok: false, error: "账户不存在" }, { status: 404 });
      const auditAction = action === "enable" ? "demo:account-enable" : "demo:account-regenerate-password";
      void recordAudit({
        ...gate.actor, action: auditAction, method: "PATCH", path: PATH,
        resource_type: "demo-account", resource_id: String(seq), status: "success",
        error_message: null, ip: gate.ip, user_agent: gate.userAgent, metadata: { seq },
      });
      return NextResponse.json({ ok: true, seq: rotation.seq, codes: rotation.codes, password: rotation.password, enabled: true });
    }

    return NextResponse.json(
      { ok: false, error: "action 须为 disable / enable / regenerate-password" },
      { status: 400 }
    );
  } catch (err) {
    console.error("Demo account update error:", err);
    void recordAudit({
      ...gate.actor, action: "demo:account-update", method: "PATCH", path: PATH,
      resource_type: "demo-account", resource_id: String(seq), status: "failed",
      error_message: "更新失败", ip: gate.ip, user_agent: gate.userAgent, metadata: null,
    });
    return NextResponse.json({ ok: false, error: "更新失败" }, { status: 500 });
  }
}

/** DELETE：级联清理三身份与演示上传文件（文件清理 best-effort） */
async function DELETE_impl(request: NextRequest, ctx: Ctx) {
  const gate = await guardDemoAdmin(request, { action: "demo:account-delete", method: "DELETE", path: PATH });
  if (!gate.ok) return gate.response;

  const seq = parseSeq((await ctx.params).seq);
  if (seq === null) {
    return NextResponse.json({ ok: false, error: "账户序号非法" }, { status: 400 });
  }
  if (!demoDbExists()) {
    return NextResponse.json({ ok: false, error: "账户不存在" }, { status: 404 });
  }

  try {
    const report = await runInDemoScope(() => deleteVisitorAccount(seq));
    if (!report) return NextResponse.json({ ok: false, error: "账户不存在" }, { status: 404 });
    void recordAudit({
      ...gate.actor, action: "demo:account-delete", method: "DELETE", path: PATH,
      resource_type: "demo-account", resource_id: String(seq), status: "success",
      error_message: null, ip: gate.ip, user_agent: gate.userAgent,
      metadata: { seq, deleted: report.deleted, files: report.files },
    });
    return NextResponse.json({ ok: true, ...report });
  } catch (err) {
    console.error("Demo account delete error:", err);
    void recordAudit({
      ...gate.actor, action: "demo:account-delete", method: "DELETE", path: PATH,
      resource_type: "demo-account", resource_id: String(seq), status: "failed",
      error_message: "删除失败", ip: gate.ip, user_agent: gate.userAgent, metadata: null,
    });
    return NextResponse.json({ ok: false, error: "删除失败" }, { status: 500 });
  }
}

export const PATCH = withDemoScope(PATCH_impl);
export const DELETE = withDemoScope(DELETE_impl);
