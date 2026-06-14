import { randomUUID } from "node:crypto";
import { createPublicClient, getAddress, http } from "viem";
import { arbitrumSepolia } from "viem/chains";
import { generatePrivateKey } from "viem/accounts";
import type { Hex } from "viem";
import { ARBITRUM_SEPOLIA } from "@reineira-os/x402-rss-shared";
import { createAgentWallet } from "./agentWallet";
import { createDocStore } from "./store/docStore";

export const DEFAULT_AGENT_ID = "env";

const erc20BalanceAbi = [
  {
    type: "function",
    name: "balanceOf",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }],
  },
] as const;

export async function usdcBalanceOf(address: `0x${string}`): Promise<bigint> {
  const publicClient = createPublicClient({
    chain: arbitrumSepolia,
    transport: http(process.env.ARBITRUM_SEPOLIA_RPC_URL),
  });
  return publicClient.readContract({
    address: getAddress(ARBITRUM_SEPOLIA.usdc),
    abi: erc20BalanceAbi,
    functionName: "balanceOf",
    args: [address],
  });
}

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

export interface AgentRecord {
  id: string;
  name: string;
  prePrompt: string;
  pluginIds: string[];
  deadlineSeconds: number;
  ownerPrivateKey: Hex;
  address: `0x${string}`;
  createdAt: string;
  ledger: SpendRecord[];
}

export function defaultDeadlineSeconds(): number {
  return Number(process.env.ESCROW_DEADLINE_SECONDS ?? 90);
}

export interface PublicAgent {
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
}

interface StoreShape {
  agents: AgentRecord[];
}

const docStore = createDocStore<StoreShape>({
  fileName: ".agent-store.json",
  pgKey: "agent-store",
  empty: () => ({ agents: [] }),
});

async function readStore(): Promise<StoreShape> {
  const store = await docStore.read();
  return { agents: Array.isArray(store.agents) ? store.agents : [] };
}

const writeStore = (store: StoreShape): Promise<void> => docStore.write(store);

// Serialize every read-modify-write so two overlapping runs can't lost-update the ledger.
// All public store ops go through this; the internal ensureDefaultAgent helper never locks,
// so there is no re-entrant deadlock.
const withLock = docStore.withLock;

export function toPublicAgent(agent: AgentRecord): PublicAgent {
  const totalSpent = agent.ledger.reduce((sum, record) => sum + BigInt(record.amountAtomic), 0n);
  return {
    id: agent.id,
    name: agent.name,
    prePrompt: agent.prePrompt,
    pluginIds: agent.pluginIds,
    deadlineSeconds: agent.deadlineSeconds ?? defaultDeadlineSeconds(),
    address: agent.address,
    createdAt: agent.createdAt,
    ledger: agent.ledger,
    totalSpentAtomic: totalSpent.toString(),
    isDefault: agent.id === DEFAULT_AGENT_ID,
  };
}

// Materialize the env-backed "Default agent" as a real store record on first use,
// so list / detail / run / withdraw all treat it uniformly with user-created agents.
async function ensureDefaultAgent(store: StoreShape): Promise<StoreShape> {
  if (store.agents.some((agent) => agent.id === DEFAULT_AGENT_ID)) {
    return store;
  }
  const key = process.env.AGENT_PRIVATE_KEY as Hex | undefined;
  if (!key) {
    return store;
  }
  const wallet = await createAgentWallet(key);
  store.agents.unshift({
    id: DEFAULT_AGENT_ID,
    name: "Default agent",
    prePrompt: "",
    pluginIds: ["timelock-resolver"],
    deadlineSeconds: defaultDeadlineSeconds(),
    ownerPrivateKey: key,
    address: wallet.address,
    createdAt: new Date().toISOString(),
    ledger: [],
  });
  await writeStore(store);
  return store;
}

export async function listAgents(): Promise<AgentRecord[]> {
  return withLock(async () => {
    const store = await ensureDefaultAgent(await readStore());
    return store.agents;
  });
}

export async function getAgent(id: string): Promise<AgentRecord | null> {
  return withLock(async () => {
    const store = await ensureDefaultAgent(await readStore());
    return store.agents.find((agent) => agent.id === id) ?? null;
  });
}

export async function createAgent(input: {
  name: string;
  prePrompt: string;
  pluginIds: string[];
  deadlineSeconds?: number;
}): Promise<AgentRecord> {
  const ownerPrivateKey = generatePrivateKey();
  const wallet = await createAgentWallet(ownerPrivateKey);

  const agent: AgentRecord = {
    id: randomUUID(),
    name: input.name,
    prePrompt: input.prePrompt,
    pluginIds: input.pluginIds,
    deadlineSeconds:
      input.deadlineSeconds && input.deadlineSeconds > 0
        ? Math.floor(input.deadlineSeconds)
        : defaultDeadlineSeconds(),
    ownerPrivateKey,
    address: wallet.address,
    createdAt: new Date().toISOString(),
    ledger: [],
  };

  return withLock(async () => {
    const store = await readStore();
    store.agents.push(agent);
    await writeStore(store);
    return agent;
  });
}

export interface UpdateAgentInput {
  name?: string;
  prePrompt?: string;
  pluginIds?: string[];
  deadlineSeconds?: number;
}

export async function updateAgent(
  id: string,
  patch: UpdateAgentInput,
): Promise<AgentRecord | null> {
  return withLock(async () => {
    const store = await ensureDefaultAgent(await readStore());
    const agent = store.agents.find((candidate) => candidate.id === id);
    if (!agent) {
      return null;
    }
    if (typeof patch.name === "string" && patch.name.trim()) {
      agent.name = patch.name.trim();
    }
    if (typeof patch.prePrompt === "string") {
      agent.prePrompt = patch.prePrompt;
    }
    if (Array.isArray(patch.pluginIds)) {
      const ids = patch.pluginIds.filter(
        (pluginId): pluginId is string => typeof pluginId === "string",
      );
      agent.pluginIds = ids.includes("timelock-resolver") ? ids : ["timelock-resolver", ...ids];
    }
    if (typeof patch.deadlineSeconds === "number" && patch.deadlineSeconds > 0) {
      agent.deadlineSeconds = Math.floor(patch.deadlineSeconds);
    }
    await writeStore(store);
    return agent;
  });
}

export async function deleteAgent(id: string): Promise<boolean> {
  if (id === DEFAULT_AGENT_ID) return false;
  return withLock(async () => {
    const store = await readStore();
    const next = store.agents.filter((agent) => agent.id !== id);
    if (next.length === store.agents.length) return false;
    store.agents = next;
    await writeStore(store);
    return true;
  });
}

export async function getSpendByEscrowId(escrowId: string): Promise<SpendRecord | null> {
  return withLock(async () => {
    const store = await readStore();
    for (const agent of store.agents) {
      for (const record of agent.ledger) {
        if (record.escrowId === escrowId) return record;
      }
    }
    return null;
  });
}

export async function recordSpend(agentId: string, spend: SpendRecord): Promise<void> {
  await withLock(async () => {
    const store = await readStore();
    const agent = store.agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      return;
    }
    agent.ledger.push(spend);
    await writeStore(store);
  });
}

// Attach the captured reasoning transcript to a recorded purchase (matched by its ts).
export async function updateSpendTranscript(
  agentId: string,
  ts: string,
  transcript: TranscriptLine[],
): Promise<void> {
  await withLock(async () => {
    const store = await readStore();
    const agent = store.agents.find((candidate) => candidate.id === agentId);
    if (!agent) {
      return;
    }
    const record = agent.ledger.find((entry) => entry.ts === ts);
    if (!record) {
      return;
    }
    record.transcript = transcript;
    await writeStore(store);
  });
}

// The escrowId is globally unique on the escrow contract, so we can resolve the
// purchase that was just released by matching it across every agent's ledger.
export async function markSpendReleased(escrowId: string, releaseTx: string): Promise<void> {
  await withLock(async () => {
    const store = await readStore();
    let changed = false;
    for (const agent of store.agents) {
      for (const record of agent.ledger) {
        if (record.escrowId === escrowId && !record.released) {
          record.released = true;
          record.releaseTx = releaseTx;
          changed = true;
        }
      }
    }
    if (changed) {
      await writeStore(store);
    }
  });
}

// The seller agent fulfilled the order: store its composed read (and the raw data snapshot)
// as the purchase result. If it attested + redeemed on-chain, also mark the escrow released.
export async function markSpendDelivered(
  escrowId: string,
  data: { result: string; artifact?: unknown; releaseTx?: string },
): Promise<void> {
  await withLock(async () => {
    const store = await readStore();
    let changed = false;
    for (const agent of store.agents) {
      for (const record of agent.ledger) {
        if (record.escrowId === escrowId) {
          record.result = data.result;
          if (data.artifact !== undefined) record.artifact = data.artifact;
          if (data.releaseTx) {
            record.released = true;
            record.releaseTx = data.releaseTx;
          }
          changed = true;
        }
      }
    }
    if (changed) {
      await writeStore(store);
    }
  });
}

// Attach the coverage purchased against a purchase's escrow (matched by escrowId).
export async function markSpendCovered(escrowId: string, coverage: CoverageInfo): Promise<void> {
  await withLock(async () => {
    const store = await readStore();
    let changed = false;
    for (const agent of store.agents) {
      for (const record of agent.ledger) {
        if (record.escrowId === escrowId) {
          record.coverage = coverage;
          changed = true;
        }
      }
    }
    if (changed) {
      await writeStore(store);
    }
  });
}

export async function markSpendClaimed(
  escrowId: string,
  claimTx: string,
  payoutAtomic: string,
): Promise<void> {
  await withLock(async () => {
    const store = await readStore();
    let changed = false;
    for (const agent of store.agents) {
      for (const record of agent.ledger) {
        if (record.escrowId === escrowId && record.coverage) {
          record.coverage = {
            ...record.coverage,
            claimed: true,
            claimTx,
            claimPayoutAtomic: payoutAtomic,
          };
          changed = true;
        }
      }
    }
    if (changed) {
      await writeStore(store);
    }
  });
}
