import bcrypt from "bcrypt";

/** 验证密码（bcrypt） */
export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
