export interface TranscriptLine {
  kind: "deal" | "escrow" | "thinking" | "result" | "action" | "system" | "delivery" | "coverage";
  text: string;
  detail?: string | null;
  tx?: string | null;
}

export interface CoverageInfo {
  coverageId: string | null;
  tx: string | null;
  pool: `0x${string}`;
  policy: `0x${string}`;
  holder: `0x${string}`;
  expiry: number;
  amountAtomic: string;
  status: "active" | "pending-setup" | "failed";
  note?: string | null;
  claimed?: boolean;
  claimTx?: string | null;
  claimPayoutAtomic?: string | null;
}

export interface SpendRecord {
  ts: string;
  escrowId: string | null;
  amountAtomic: string;
  tx: string | null;
  resource: string;
  description: string;
  resourceId?: string;
  resourceName?: string;
  result?: string | null;
  artifact?: unknown;
  deadline?: number | null;
  released?: boolean;
  releaseTx?: string | null;
  transcript?: TranscriptLine[];
  coverage?: CoverageInfo | null;
}

export interface ClientAgent {
  id: string;
  name: string;
  prePrompt: string;
  pluginIds: string[];
  deadlineSeconds: number;
  address: `0x${string}`;
  createdAt: string;
  ledger: SpendRecord[];
  totalSpentAtomic: string;
  isDefault: boolean;
  usdcBalanceAtomic?: string;
}

export function formatDeadline(seconds: number): string {
  if (seconds % 3600 === 0) return `${seconds / 3600}h`;
  if (seconds % 60 === 0) return `${seconds / 60} min`;
  return `${seconds}s`;
}

export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  kind: string;
  interface: string;
  description: string;
  resolverData?: { abi: string; description: string };
  addresses: Record<string, string | null>;
  tags: string[];
  status: "live" | "coming-soon";
}

export function usdc(atomic: string | undefined): string {
  return `${(Number(atomic ?? "0") / 1e6).toFixed(2)} USDC`;
}

export function shortAddress(address: string): string {
  return `${address.slice(0, 6)}…${address.slice(-4)}`;
}
