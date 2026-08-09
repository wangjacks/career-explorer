import { describe, it, expect } from "vitest";
import { verifyPassword } from "@/lib/auth";
import bcrypt from "bcrypt";

describe("auth", () => {
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
