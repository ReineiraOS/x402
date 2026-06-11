export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  kind: "condition-resolver" | "underwriter-policy";
  interface: "IConditionResolver" | "IUnderwriterPolicy";
  description: string;
  resolverData?: {
    abi: string;
    description: string;
  };
  addresses: Record<string, `0x${string}` | null>;
  tags: string[];
  status: "live" | "coming-soon";
}

const CHAIN_ID = "421614";

// Bundled snapshot of the Portal plugin registry. When the Portal publishes
// public/registry/v1/index.json this list is replaced by a runtime fetch with
// this snapshot as the offline fallback (PORTAL_REGISTRY_URL env).
function bundledCatalog(): PluginManifest[] {
  const timeLockAddress =
    (process.env.TIMELOCK_RESOLVER_ADDRESS as `0x${string}`) ?? null;
  const coverageAddress =
    (process.env.COVERAGE_MANAGER_ADDRESS as `0x${string}`) ?? null;
  const deliveryResolverAddress =
    (process.env.DELIVERY_DEADLINE_RESOLVER_ADDRESS as `0x${string}`) ?? null;
  return [
    {
      id: "timelock-resolver",
      name: "TimeLock Resolver",
      version: "0.1.0",
      kind: "condition-resolver",
      interface: "IConditionResolver",
      description:
        "Escrow releases to the seller only after a deadline. Until then funds sit in escrow; mandatory anti-stranding plugin for x402 purchases.",
      resolverData: {
        abi: "uint256",
        description: "Unix timestamp after which the escrow can be released.",
      },
      addresses: { [CHAIN_ID]: timeLockAddress },
      tags: ["time", "core", "anti-stranding"],
      status: timeLockAddress ? "live" : "coming-soon",
    },
    {
      id: "delivery-coverage-policy",
      name: "Delivery Coverage Policy",
      version: "0.1.0",
      kind: "underwriter-policy",
      interface: "IUnderwriterPolicy",
      description:
        "Optional insurance: coverage is bought against the escrow at purchase. If the seller fails to attest delivery before the deadline (a judgeable breach), the buyer can claim a payout from an underwriter pool. The second plugin category — underwriting, not just release conditions.",
      resolverData: {
        abi: "(address resolver, uint256 escrowId)",
        description:
          "policyData binds the coverage to a breach oracle (the Delivery Deadline Resolver) for a specific escrow. Zero premium on testnet.",
      },
      addresses: { [CHAIN_ID]: coverageAddress },
      tags: ["insurance", "underwriter", "coverage"],
      status: coverageAddress ? "live" : "coming-soon",
    },
    {
      id: "delivery-deadline-resolver",
      name: "Delivery Deadline Resolver",
      version: "0.1.0",
      kind: "condition-resolver",
      interface: "IConditionResolver",
      description:
        "Attester marks delivery before a deadline; release requires attestation. Breach (no attestation past the deadline) is judgeable, which is what the Delivery Coverage Policy underwrites.",
      resolverData: {
        abi: "(uint256 deadline, address attester)",
        description: "Deadline and the address allowed to attest delivery.",
      },
      addresses: { [CHAIN_ID]: deliveryResolverAddress },
      tags: ["delivery", "attestation"],
      status: deliveryResolverAddress ? "live" : "coming-soon",
    },
    {
      id: "reclaim-resolver",
      name: "Reclaim zkTLS Resolver",
      version: "0.1.0",
      kind: "condition-resolver",
      interface: "IConditionResolver",
      description:
        "Releases when a zkTLS (Reclaim) proof shows an HTTPS endpoint returned the expected data.",
      resolverData: {
        abi: "(string provider, string contextAddress, string contextMessage)",
        description: "Reclaim provider id and expected context fields.",
      },
      addresses: { [CHAIN_ID]: null },
      tags: ["zktls", "web-proof"],
      status: "coming-soon",
    },
    {
      id: "chainlink-price-resolver",
      name: "Chainlink Price Resolver",
      version: "0.1.0",
      kind: "condition-resolver",
      interface: "IConditionResolver",
      description:
        "Releases when a Chainlink feed crosses a threshold (with staleness protection).",
      resolverData: {
        abi: "(address feed, int256 threshold, uint8 op, uint256 maxStaleness)",
        description: "Feed address, threshold, comparison op, staleness bound.",
      },
      addresses: { [CHAIN_ID]: null },
      tags: ["oracle", "price"],
      status: "coming-soon",
    },
  ];
}

export async function getPluginCatalog(): Promise<PluginManifest[]> {
  const registryUrl = process.env.PORTAL_REGISTRY_URL;
  if (registryUrl) {
    try {
      const res = await fetch(registryUrl, {
        headers: { accept: "application/json" },
        signal: AbortSignal.timeout(3000),
      });
      if (res.ok) {
        const remote = (await res.json()) as { plugins?: PluginManifest[] };
        if (Array.isArray(remote.plugins) && remote.plugins.length > 0) {
          return remote.plugins;
        }
      }
    } catch {
      // fall through to the bundled snapshot
    }
  }
  return bundledCatalog();
}

export async function getLivePlugin(
  pluginId: string,
): Promise<PluginManifest | null> {
  const catalog = await getPluginCatalog();
  const plugin = catalog.find((candidate) => candidate.id === pluginId);
  if (!plugin || plugin.status !== "live" || !plugin.addresses[CHAIN_ID]) {
    return null;
  }
  return plugin;
}
