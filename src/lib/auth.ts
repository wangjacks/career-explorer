import bcrypt from "bcrypt";

/** 生成密码哈希（bcrypt，cost 10） */
export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, 10);
}

/** 验证密码（bcrypt） */
export async function verifyPassword(
  plain: string,
  hash: string
): Promise<boolean> {
  return bcrypt.compare(plain, hash);
}
