import { SignJWT, jwtVerify } from "jose";

export type Role = "admin" | "teacher" | "student";

export interface TokenPayload {
  role: Role;
  uid: number | null;
  name: string;
  /** 演示沙箱会话标志：仅演示 token 携带，生产 token 不含此 claim */
  demo?: boolean;
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "career-explorer-default-secret-change-me"
);
const TOKEN_EXPIRY = "24h";

/** 签发 JWT token（携带角色、用户 ID 与姓名） */
export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({
    role: payload.role,
    uid: payload.uid,
    name: payload.name,
    ...(payload.demo ? { demo: true } : {}),
  })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

/** 验证 JWT token，成功时返回载荷 */
export async function verifyToken(
  token: string
): Promise<{ valid: boolean; role?: string; uid?: number | null; name?: string; demo?: boolean }> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      valid: true,
      role: typeof payload.role === "string" ? payload.role : undefined,
      uid: typeof payload.uid === "number" ? payload.uid : null,
      name: typeof payload.name === "string" ? payload.name : undefined,
      demo: typeof payload.demo === "boolean" ? payload.demo : undefined,
    };
  } catch {
    return { valid: false };
  }
}
