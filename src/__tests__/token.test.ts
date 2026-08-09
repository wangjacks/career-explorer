import { describe, it, expect } from "vitest";
import { signToken, verifyToken } from "@/lib/token";

describe("token", () => {
  describe("signToken / verifyToken", () => {
    it("should sign a valid JWT token", async () => {
      const token = await signToken({ role: "admin", uid: 1 });

      expect(typeof token).toBe("string");
      expect(token.split(".")).toHaveLength(3); // JWT has 3 parts
    });

    it("should support all three roles", async () => {
      for (const role of ["admin", "teacher", "student"] as const) {
        const token = await signToken({ role, uid: 1 });
        const result = await verifyToken(token);
        expect(result.valid).toBe(true);
        expect(result.role).toBe(role);
      }
    });

    it("should return payload matching the signed claims", async () => {
      const token = await signToken({ role: "admin", uid: 42 });

      const result = await verifyToken(token);
      expect(result.valid).toBe(true);
      expect(result.role).toBe("admin");
      expect(result.uid).toBe(42);
    });

    it("should allow null uid", async () => {
      const token = await signToken({ role: "admin", uid: null });

      const result = await verifyToken(token);
      expect(result.valid).toBe(true);
      expect(result.uid).toBe(null);
    });

    it("should reject an invalid token", async () => {
      const result = await verifyToken("invalid.token.here");
      expect(result.valid).toBe(false);
    });

    it("should reject a tampered token", async () => {
      const token = await signToken({ role: "admin", uid: 1 });
      const tampered = token.slice(0, -5) + "xxxxx";

      const result = await verifyToken(tampered);
      expect(result.valid).toBe(false);
    });
  });
});
