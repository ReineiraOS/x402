export interface ResourceDef {
  id: string;
  name: string;
  description: string;
  priceAtomic: string;
  task: string;
  mode: "escrow" | "direct";
  url?: string;
}

// Escrow-gated resources are served by our /api/resource through the plugin-gated escrow.
// Direct resources are paid by the agent straight to an external x402 endpoint (no escrow).
export const RESOURCE_CATALOG: ResourceDef[] = [
  {
    id: "eth-report",
    name: "ETH market report",
    description: "Live on-chain data report — Arbitrum Sepolia block + ETH price",
    priceAtomic: "100000",
    task: "Give a one-line read on current ETH market conditions, grounded in fresh on-chain + price data.",
    mode: "escrow",
  },
  {
    id: "gas-snapshot",
    name: "Gas snapshot",
    description: "Arbitrum Sepolia gas + latest block height",
    priceAtomic: "50000",
    task: "Report current Arbitrum Sepolia gas conditions and block height in one crisp line.",
    mode: "escrow",
  },
  {
    id: "premium-feed",
    name: "Premium market feed",
    description: "Extended on-chain + ETH spot snapshot (premium tier)",
    priceAtomic: "250000",
    task: "Give a two-line premium market read citing block, gas, and ETH spot price.",
    mode: "escrow",
  },
];

const DEFAULT_RESOURCE_ID = "eth-report";

export function getResource(id?: string | null): ResourceDef {
  return RESOURCE_CATALOG.find((r) => r.id === id) ?? RESOURCE_CATALOG[0]!;
}

export { DEFAULT_RESOURCE_ID };
