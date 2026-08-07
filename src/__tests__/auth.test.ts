import { describe, it, expect } from "vitest";
import { verifyPassword, signToken, verifyToken } from "@/lib/auth";
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

  describe("signToken / verifyToken", () => {
    it("should sign a valid JWT token", async () => {
      const token = await signToken();

      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT has 3 parts
    });

    it("should verify a valid token", async () => {
      const token = await signToken();

      const result = await verifyToken(token);
      expect(result.valid).toBe(true);
    });

    it("should reject an invalid token", async () => {
      const result = await verifyToken("invalid.token.here");
      expect(result.valid).toBe(false);
    });

    it("should reject a tampered token", async () => {
      const token = await signToken();
      const tampered = token.slice(0, -5) + "xxxxx";

      const result = await verifyToken(tampered);
      expect(result.valid).toBe(false);
    });
  });
});
