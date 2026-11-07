import type { NextRequest } from "next/server";
import { verifyToken } from "@/lib/token";
import { getUserById, insertAuditLog } from "@/lib/db";
import type { NewAuditLog } from "@/lib/db";

/**
 * 统一审计工具（#110）：事件构造、脱敏与写入。
 * 设计原则：
 * - 操作者字段快照冗余（写入时落库姓名/编号/角色），账号改名/删除后仍可追溯
 * - 审计失败静默降级（仅 console.warn），绝不阻断业务请求
 * - 敏感键（密码/凭据）递归剔除，metadata 截断限长
 */

/** 敏感键黑名单：递归剔除，绝不写入审计数据 */
const SENSITIVE_KEYS = new Set([
  "password",
  "password_hash",
  "newpassword",
  "new_password",
  "token",
  "auth_token",
  "secret",
  "cookie",
  "authorization",
]);

const MAX_METADATA_LENGTH = 2000;
const MAX_ERROR_LENGTH = 200;

/** 递归剔除敏感键（纯函数，可单测） */
export function stripSensitiveKeys(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => stripSensitiveKeys(v));
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEYS.has(k.toLowerCase())) continue;
      result[k] = stripSensitiveKeys(v);
    }
    return result;
  }
  return value;
}

/** 脱敏 + 序列化 + 截断；入参为空返回 null */
export function sanitizeMetadata(obj: unknown): string | null {
  if (obj === undefined || obj === null) return null;
  const sanitized = stripSensitiveKeys(obj);
  let json: string;
  try {
    json = JSON.stringify(sanitized);
  } catch {
    return null;
  }
  return json.length > MAX_METADATA_LENGTH ? json.slice(0, MAX_METADATA_LENGTH) : json;
}

/** 错误信息截断（用户可见文案，不含敏感数据） */
export function truncateError(msg: string | null | undefined): string | null {
  if (!msg) return null;
  return msg.length > MAX_ERROR_LENGTH ? msg.slice(0, MAX_ERROR_LENGTH) : msg;
}

/** 操作者快照（actor_id 可为空——如登录失败时尚无会话） */
export interface AuditActor {
  actor_id: number | null;
  actor_user_code: string | null;
  actor_name: string | null;
  actor_role: string | null;
}

/**
 * 从请求会话解析操作者快照：读 auth_token → 验签 → 查用户表取 user_code
 * （token 载荷只有 role/uid/name，user_code 需查库）。解析失败返回全空快照。
 */
export async function getAuditActor(request: NextRequest): Promise<AuditActor> {
  try {
    const token = request.cookies.get("auth_token")?.value;
    if (!token) return { actor_id: null, actor_user_code: null, actor_name: null, actor_role: null };
    const result = await verifyToken(token);
    if (!result.valid || result.uid == null) {
      return { actor_id: null, actor_user_code: null, actor_name: null, actor_role: null };
    }
    const user = await getUserById(result.uid);
    return {
      actor_id: result.uid,
      actor_user_code: user?.user_code ?? null,
      actor_name: user?.name ?? result.name ?? null,
      actor_role: user?.role ?? result.role ?? null,
    };
  } catch {
    return { actor_id: null, actor_user_code: null, actor_name: null, actor_role: null };
  }
}

/** 请求上下文：IP（x-forwarded-for 首段 → x-real-ip → unknown）与 UA */
export function getRequestContext(request: NextRequest): { ip: string; user_agent: string } {
  const forwarded = request.headers.get("x-forwarded-for");
  const ip = forwarded?.split(",")[0]?.trim() || request.headers.get("x-real-ip") || "unknown";
  return { ip, user_agent: request.headers.get("user-agent") || "" };
}

/** 审计记录入参（metadata 传原始对象，内部统一脱敏截断） */
export interface AuditEntry extends Omit<NewAuditLog, "metadata" | "error_message"> {
  metadata?: unknown;
  error_message?: string | null;
}

/**
 * 统一写入入口：脱敏 + 截断 + 静默降级。
 * 业务方无需 try/catch，审计失败绝不影响业务响应。
 */
export async function recordAudit(entry: AuditEntry): Promise<void> {
  try {
    await insertAuditLog({
      actor_id: entry.actor_id,
      actor_user_code: entry.actor_user_code,
      actor_name: entry.actor_name,
      actor_role: entry.actor_role,
      action: entry.action,
      method: entry.method,
      path: entry.path,
      resource_type: entry.resource_type,
      resource_id: entry.resource_id,
      status: entry.status,
      error_message: truncateError(entry.error_message),
      ip: entry.ip,
      user_agent: entry.user_agent,
      metadata: sanitizeMetadata(entry.metadata),
    });
  } catch (err) {
    // 审计失败不阻断业务，仅告警
    console.warn("Audit log write failed:", err);
  }
}
