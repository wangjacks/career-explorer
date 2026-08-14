import { describe, it, expect } from "vitest";
import { isSafeImageUrl, safeImageUrl } from "@/lib/sanitize";

describe("sanitize", () => {
  describe("isSafeImageUrl", () => {
    it("should allow relative paths", () => {
      expect(isSafeImageUrl("/uploads/avatar.jpg")).toBe(true);
      expect(isSafeImageUrl("/uploads/deep/path/image.png")).toBe(true);
    });

    it("should allow protocol-relative URLs", () => {
      expect(isSafeImageUrl("//cdn.example.com/image.jpg")).toBe(true);
    });

    it("should allow http URLs", () => {
      expect(isSafeImageUrl("http://example.com/image.jpg")).toBe(true);
    });

    it("should allow https URLs", () => {
      expect(isSafeImageUrl("https://example.com/image.jpg")).toBe(true);
    });

    it("should reject javascript: protocol", () => {
      expect(isSafeImageUrl("javascript:alert(1)")).toBe(false);
      expect(isSafeImageUrl("JavaScript:alert('xss')")).toBe(false);
    });

    it("should reject data: protocol", () => {
      expect(isSafeImageUrl("data:text/html,<script>alert(1)</script>")).toBe(false);
    });

    it("should reject null/undefined/empty", () => {
      expect(isSafeImageUrl(null)).toBe(false);
      expect(isSafeImageUrl(undefined)).toBe(false);
      expect(isSafeImageUrl("")).toBe(false);
    });

    it("should reject other protocols", () => {
      expect(isSafeImageUrl("ftp://example.com/file")).toBe(false);
      expect(isSafeImageUrl("file:///etc/passwd")).toBe(false);
    });
  });

  describe("safeImageUrl", () => {
    it("should return the URL when safe", () => {
      expect(safeImageUrl("/uploads/avatar.jpg")).toBe("/uploads/avatar.jpg");
    });

    it("should return null when unsafe", () => {
      expect(safeImageUrl("javascript:alert(1)")).toBeNull();
    });

    it("should return null for null/undefined", () => {
      expect(safeImageUrl(null)).toBeNull();
      expect(safeImageUrl(undefined)).toBeNull();
    });
  });
});
