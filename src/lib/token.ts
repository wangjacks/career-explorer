import { SignJWT, jwtVerify } from "jose";

export type Role = "admin" | "teacher" | "student";

export interface TokenPayload {
  role: Role;
  uid: number | null;
}

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "career-explorer-default-secret-change-me"
);
const TOKEN_EXPIRY = "24h";

/** 签发 JWT token（携带角色与用户 ID） */
export async function signToken(payload: TokenPayload): Promise<string> {
  return new SignJWT({ role: payload.role, uid: payload.uid })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

/** 验证 JWT token，成功时返回载荷 */
export async function verifyToken(
  token: string
): Promise<{ valid: boolean; role?: string; uid?: number | null }> {
  try {
    const { payload } = await jwtVerify(token, JWT_SECRET);
    return {
      valid: true,
      role: typeof payload.role === "string" ? payload.role : undefined,
      uid: typeof payload.uid === "number" ? payload.uid : null,
    };
  } catch {
    return { valid: false };
  }
}
