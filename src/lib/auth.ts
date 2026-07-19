import bcrypt from "bcrypt";
import { SignJWT, jwtVerify } from "jose";

const JWT_SECRET = new TextEncoder().encode(
  process.env.JWT_SECRET || "career-explorer-default-secret-change-me"
);
const COOKIE_NAME = "admin_token";
const TOKEN_EXPIRY = "24h";

/** 验证密码（bcrypt） */
export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}

/** 签发 JWT token */
export async function signToken(): Promise<string> {
  return new SignJWT({ role: "admin" })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(TOKEN_EXPIRY)
    .sign(JWT_SECRET);
}

/** 验证 JWT token */
export async function verifyToken(
  token: string
): Promise<{ valid: boolean }> {
  try {
    await jwtVerify(token, JWT_SECRET);
    return { valid: true };
  } catch {
    return { valid: false };
  }
}

/** 设置认证 Cookie */
export function setAuthCookie(token: string) {
  return `admin_token=${token}; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=86400`;
}

/** 清除认证 Cookie */
export function clearAuthCookie() {
  return "admin_token=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0";
}

export { COOKIE_NAME };
