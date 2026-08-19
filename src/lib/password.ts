/**
 * 生成强密码（大小写 + 数字 + 特殊字符，排除易混淆字符），基于 crypto.getRandomValues。
 * 浏览器端使用 window.crypto，Node 24 服务端使用 globalThis.crypto（webcrypto），两端通用。
 */
export function generatePassword(length = 12): string {
  const upper = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  const lower = "abcdefghjkmnpqrstuvwxyz";
  const digits = "23456789";
  const symbols = "!@#$%^&*";
  const all = upper + lower + digits + symbols;

  const randomInts = (count: number, max: number): number[] => {
    const buf = new Uint32Array(count);
    crypto.getRandomValues(buf);
    return Array.from(buf, (v) => v % max);
  };

  // 每类至少一个字符，其余随机补齐
  const chars: string[] = [
    upper[randomInts(1, upper.length)[0]],
    lower[randomInts(1, lower.length)[0]],
    digits[randomInts(1, digits.length)[0]],
    symbols[randomInts(1, symbols.length)[0]],
  ];
  for (const i of randomInts(length - chars.length, all.length)) {
    chars.push(all[i]);
  }
  // Fisher-Yates 洗牌
  const order = randomInts(chars.length, chars.length);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = order[i] % (i + 1);
    [chars[i], chars[j]] = [chars[j], chars[i]];
  }
  return chars.join("");
}
