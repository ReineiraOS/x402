import type { Severity } from "@reineira-os/x402-shared";

export interface IncidentReport {
  id: string;
  source: "Immunefi" | "HackenProof" | "CertiK";
  title: string;
  body: string;
  affectedContract: string;
  realVuln: boolean;
  severity: Severity;
  expectedBranch: "TP" | "FN" | "FP";
}

export const INCIDENT_REPORTS: IncidentReport[] = [
  {
    id: "immunefi-reentrancy",
    source: "Immunefi",
    title: "Reentrancy drains the vault",
    body:
      "Triaged Immunefi submission with a working PoC: an attacker re-enters ProtectedVault during " +
      "withdrawal and drains balances below the recorded floor. Funds at immediate risk.",
    affectedContract: "ProtectedVault",
    realVuln: true,
    severity: "critical",
    expectedBranch: "TP",
  },
  {
    id: "hackenproof-rounding",
    source: "HackenProof",
    title: "Rounding drift in floor accounting",
    body:
      "Reporter claims a rounding discrepancy lets the recorded floor drift by a few wei per " +
      "deposit. No PoC of fund loss attached; impact looks cosmetic.",
    affectedContract: "ProtectedVault",
    realVuln: true,
    severity: "medium",
    expectedBranch: "FN",
  },
  {
    id: "certik-oracle",
    source: "CertiK",
    title: "Oracle manipulation, PoC attached",
    body:
      "Escalated CertiK Skynet alert from a known researcher: a price-oracle manipulation lets an " +
      "attacker drain ProtectedVault below its floor, with an attached PoC the reporter says " +
      "reproduces on the live Sepolia deployment. Funds reported at immediate risk; urges an emergency freeze.",
    affectedContract: "ProtectedVault",
    realVuln: false,
    severity: "critical",
    expectedBranch: "FP",
  },
];

const DEFAULT_REPORT_ID = "immunefi-reentrancy";

export function getReport(id?: string | null): IncidentReport {
  return INCIDENT_REPORTS.find((r) => r.id === id) ?? INCIDENT_REPORTS[0]!;
}

export { DEFAULT_REPORT_ID };
