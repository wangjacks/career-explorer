import { withDemoScope, runInDemoScope } from "@/lib/demo-scope";
import { NextRequest, NextResponse } from "next/server";
import { recordAudit } from "@/lib/audit";
import { demoDbExists } from "@/lib/demo-lifecycle";
import {
  listVisitorAccounts,
  createVisitorAccount,
  DemoAccountNotReadyError,
  DemoAccountSeqExhaustedError,
} from "@/lib/demo-accounts-service";
import { guardDemoAdmin } from "../gate";
import { normalizeDemoName, DEMO_NAME_MAX } from "@/lib/demo-names";

const PATH = "/api/manage/demo/accounts";

/** 列出演示访客账户（只读诊断；成功不审计，拒绝由 gate 记录） */
async function GET_impl(request: NextRequest) {
  const gate = await guardDemoAdmin(request, { action: "demo:account-list", method: "GET", path: PATH });
  if (!gate.ok) return gate.response;

  // 演示库不存在时直接返回空列表，绝不开 adapter（无建库副作用）
  if (!demoDbExists()) {
    return NextResponse.json({ accounts: [], total: 0 });
  }
  const accounts = await runInDemoScope(() => listVisitorAccounts());
  return NextResponse.json({ accounts, total: accounts.length });
}

/** 创建访客账户：三身份同名；密码可选（缺省服务端生成），明文仅此一次返回；名称可选（留缺省/仅空白由服务端随机，超 50 字 400） */
async function POST_impl(request: NextRequest) {
  const gate = await guardDemoAdmin(request, { action: "demo:account-create", method: "POST", path: PATH });
  if (!gate.ok) return gate.response;

  if (!demoDbExists()) {
    return NextResponse.json(
      { ok: false, error: "演示库未初始化，请先初始化演示数据" },
      { status: 409 }
    );
  }

  let password: string | undefined;
  let name: string | undefined;
  const body = (await request.json().catch(() => ({}))) as { password?: unknown; name?: unknown };
  if (body && typeof body === "object") {
    if (body.password !== undefined) {
      if (typeof body.password !== "string" || body.password.length < 8) {
        return NextResponse.json({ ok: false, error: "密码须至少 8 位" }, { status: 400 });
      }
      password = body.password;
    }
    if (body.name !== undefined) {
      // 三分支：非字符串 400；归一后为空按留空（省略 name，服务端回退随机）；超 50 字 400。
      // 长度上限必须挡在路由层（不进服务层），否则 MySQL STRICT 模式会把超长 INSERT 变 1406 → 500，
      // 而 SQLite 静默成功——正是两适配器不一致铁律。400 不写审计（对齐密码分支）。
      if (typeof body.name !== "string") {
        return NextResponse.json({ ok: false, error: "名称须为 1-50 字" }, { status: 400 });
      }
      const normalized = normalizeDemoName(body.name);
      if (normalized.length > DEMO_NAME_MAX) {
        return NextResponse.json({ ok: false, error: "名称须为 1-50 字" }, { status: 400 });
      }
      if (normalized) name = normalized;
    }
  }

  try {
    const created = await runInDemoScope(() => createVisitorAccount({ password, name }));
    void recordAudit({
      ...gate.actor,
      action: "demo:account-create",
      method: "POST",
      path: PATH,
      resource_type: "demo-account",
      resource_id: String(created.seq),
      status: "success",
      error_message: null,
      ip: gate.ip,
      user_agent: gate.userAgent,
      metadata: { seq: created.seq, name: created.name, codes: created.codes, classId: created.classId },
    });
    return NextResponse.json({ ok: true, ...created });
  } catch (err) {
    if (err instanceof DemoAccountNotReadyError || err instanceof DemoAccountSeqExhaustedError) {
      return NextResponse.json({ ok: false, error: err.message }, { status: 409 });
    }
    console.error("Demo account create error:", err);
    void recordAudit({
      ...gate.actor,
      action: "demo:account-create",
      method: "POST",
      path: PATH,
      resource_type: "demo-account",
      resource_id: null,
      status: "failed",
      error_message: "创建失败",
      ip: gate.ip,
      user_agent: gate.userAgent,
      metadata: null,
    });
    return NextResponse.json({ ok: false, error: "创建失败" }, { status: 500 });
  }
}

export const GET = withDemoScope(GET_impl);
export const POST = withDemoScope(POST_impl);
