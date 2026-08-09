import { describe, it, expect } from "vitest";
import { hashPassword, verifyPassword } from "@/lib/auth";
import bcrypt from "bcrypt";

describe("auth", () => {
  describe("hashPassword", () => {
    it("should produce a hash that verifyPassword accepts (round-trip)", async () => {
      const password = "setup-wizard-password";
      const hash = await hashPassword(password);

      expect(hash).not.toBe(password); // 哈希后不可读
      expect(await verifyPassword(password, hash)).toBe(true);
    });

    it("should reject a wrong password against the hash", async () => {
      const hash = await hashPassword("correct-password-123");

      expect(await verifyPassword("wrong-password", hash)).toBe(false);
    });
  });

  describe("verifyPassword", () => {
    it("should return true for correct password", async () => {
      const password = "test-password-123";
      const hash = await bcrypt.hash(password, 10);

      const result = await verifyPassword(password, hash);
      expect(result).toBe(true);
    });

    it("should return false for wrong password", async () => {
      const hash = await bcrypt.hash("correct-password", 10);

      const result = await verifyPassword("wrong-password", hash);
      expect(result).toBe(false);
    });
  });
});
