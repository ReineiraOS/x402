import { describe, it, expect } from "vitest";
import { SEVERITY_TIERS, SEVERITY_ORDER, isSeverity, severityTier } from "../src/severity.js";

describe("severity", () => {
  it("scales bond and payout monotonically across tiers", () => {
    let prevBond = -1n;
    let prevPayout = -1n;
    for (const s of SEVERITY_ORDER) {
      const tier = severityTier(s);
      expect(tier.bondAtomic).toBeGreaterThan(prevBond);
      expect(tier.payoutAtomic).toBeGreaterThan(prevPayout);
      prevBond = tier.bondAtomic;
      prevPayout = tier.payoutAtomic;
    }
  });

  it("payout is always >= bond for a tier", () => {
    for (const s of SEVERITY_ORDER) {
      const t = SEVERITY_TIERS[s];
      expect(t.payoutAtomic).toBeGreaterThanOrEqual(t.bondAtomic);
    }
  });

  it("isSeverity guards unknown values", () => {
    expect(isSeverity("critical")).toBe(true);
    expect(isSeverity("nope")).toBe(false);
    expect(isSeverity(3)).toBe(false);
  });
});
