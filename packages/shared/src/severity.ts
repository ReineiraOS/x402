export type Severity = "low" | "medium" | "high" | "critical";

export interface SeverityTier {
  bondAtomic: bigint;
  payoutAtomic: bigint;
}

export const SEVERITY_ORDER: readonly Severity[] = ["low", "medium", "high", "critical"];

export const SEVERITY_TIERS: Record<Severity, SeverityTier> = {
  low: { bondAtomic: 50_000n, payoutAtomic: 100_000n },
  medium: { bondAtomic: 100_000n, payoutAtomic: 250_000n },
  high: { bondAtomic: 250_000n, payoutAtomic: 500_000n },
  critical: { bondAtomic: 500_000n, payoutAtomic: 1_000_000n },
};

export function isSeverity(value: unknown): value is Severity {
  return typeof value === "string" && (SEVERITY_ORDER as readonly string[]).includes(value);
}

export function severityTier(severity: Severity): SeverityTier {
  return SEVERITY_TIERS[severity];
}
