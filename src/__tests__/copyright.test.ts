import { describe, expect, it } from "vitest";
import {
  COPYRIGHT_HOLDER,
  COPYRIGHT_LICENSE,
  COPYRIGHT_NOTICE,
  COPYRIGHT_YEAR,
} from "@/lib/copyright";

describe("copyright notice", () => {
  it("declares the project team as the copyright holder", () => {
    expect(COPYRIGHT_HOLDER).toBe("博格二三开发团队");
    expect(COPYRIGHT_YEAR).toBe("2026");
    expect(COPYRIGHT_LICENSE).toBe("保留所有权利");
  });

  it("renders one canonical notice for every display surface", () => {
    expect(COPYRIGHT_NOTICE).toBe(`© 2026 ${COPYRIGHT_HOLDER} · 保留所有权利`);
  });
});
