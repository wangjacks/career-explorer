import { createHmac } from "node:crypto";

/**
 * 极验行为验证（GeeTest v4）服务端校验（#155）
 *
 * 设计要点：
 * - 只负责票据校验，不碰业务逻辑；认证入口在查库与密码比对之前调用，避免 bcrypt 成为枚举放大面
 * - fail-open 降级：凭证未配置或极验服务不可达时放行（与极验官方容灾口径一致），
 *   由调用方记录 `auth:captcha-degraded` 审计事件
 * - 依赖可注入（fetch / 凭证 / 超时），单元测试不依赖第三方网络
 */

const GEETEST_VALIDATE_URL = "https://gcaptcha4.geetest.com/validate";
const DEFAULT_TIMEOUT_MS = 5000;

/** 前端验证完成后上送的四元票据（极验 v4 `getValidate()` 返回值） */
export interface CaptchaTicket {
  lot_number: string;
  captcha_output: string;
  pass_token: string;
  gen_time: string;
}

/** 票据缺失 / 无效 / 过期共用同一提示，不泄露账户存在性与校验细节 */
export const CAPTCHA_REQUIRED_MESSAGE = "请先完成人机验证";

export type CaptchaFailureReason = "missing" | "invalid";
export type CaptchaDegradedReason = "not-configured" | "service-unreachable";

/** passed 放行；rejected 拒绝（400）；degraded 放行但需记录降级审计 */
export type CaptchaDecision =
  | { outcome: "passed" }
  | { outcome: "rejected"; reason: CaptchaFailureReason; detail?: string }
  | { outcome: "degraded"; reason: CaptchaDegradedReason; detail?: string };

export interface CaptchaDeps {
  /** 测试注入；默认使用全局 fetch */
  fetchImpl?: typeof fetch;
  captchaId?: string;
  privateKey?: string;
  timeoutMs?: number;
}

/** 解析请求体中的票据：四个字段都必须是非空字符串 */
export function parseCaptchaTicket(input: unknown): CaptchaTicket | null {
  if (!input || typeof input !== "object") return null;
  const raw = input as Record<string, unknown>;
  const fields: (keyof CaptchaTicket)[] = [
    "lot_number",
    "captcha_output",
    "pass_token",
    "gen_time",
  ];
  const ticket: CaptchaTicket = {
    lot_number: "",
    captcha_output: "",
    pass_token: "",
    gen_time: "",
  };
  for (const field of fields) {
    const value = raw[field];
    if (typeof value !== "string" || value.trim() === "") return null;
    ticket[field] = value.trim();
  }
  return ticket;
}

/** sign_token = HMAC-SHA256(key = 私钥, message = lot_number)，十六进制小写 */
function signTicket(lotNumber: string, privateKey: string): string {
  return createHmac("sha256", privateKey).update(lotNumber, "utf8").digest("hex");
}

function readCredentials(deps: CaptchaDeps): { captchaId: string; privateKey: string } {
  const captchaId = deps.captchaId ?? process.env.NEXT_PUBLIC_GEETEST_CAPTCHA_ID ?? "";
  const privateKey = deps.privateKey ?? process.env.GEETEST_PRIVATE_KEY ?? "";
  return { captchaId: captchaId.trim(), privateKey: privateKey.trim() };
}

/**
 * 校验极验票据。
 * - passed：校验通过，继续业务
 * - rejected：票据缺失或无效，调用方直接 400，不进入查库/密码比对
 * - degraded：凭证未配置或极验不可达，按 fail-open 放行并由调用方写降级审计
 */
export async function verifyCaptchaTicket(
  input: unknown,
  deps: CaptchaDeps = {}
): Promise<CaptchaDecision> {
  const { captchaId, privateKey } = readCredentials(deps);
  if (!captchaId || !privateKey) {
    return { outcome: "degraded", reason: "not-configured" };
  }

  const ticket = parseCaptchaTicket(input);
  if (!ticket) {
    return { outcome: "rejected", reason: "missing" };
  }

  const fetchImpl = deps.fetchImpl ?? fetch;
  const timeoutMs = deps.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const form = new URLSearchParams({
    lot_number: ticket.lot_number,
    captcha_output: ticket.captcha_output,
    pass_token: ticket.pass_token,
    gen_time: ticket.gen_time,
    sign_token: signTicket(ticket.lot_number, privateKey),
  });

  let payload: unknown;
  try {
    const res = await fetchImpl(
      `${GEETEST_VALIDATE_URL}?captcha_id=${encodeURIComponent(captchaId)}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: form,
        signal: AbortSignal.timeout(timeoutMs),
      }
    );
    if (!res.ok) {
      return { outcome: "degraded", reason: "service-unreachable", detail: `http-${res.status}` };
    }
    payload = await res.json();
  } catch (err) {
    // 网络异常 / 超时 / 响应不可解析：不阻断登录与激活（官方容灾口径），由调用方记录降级事件
    console.warn("Captcha validation unavailable:", err);
    return { outcome: "degraded", reason: "service-unreachable" };
  }

  const result = (payload as { result?: unknown } | null)?.result;
  if (result === "success") {
    return { outcome: "passed" };
  }
  const reason = (payload as { reason?: unknown } | null)?.reason;
  return {
    outcome: "rejected",
    reason: "invalid",
    detail: typeof reason === "string" ? reason : undefined,
  };
}
