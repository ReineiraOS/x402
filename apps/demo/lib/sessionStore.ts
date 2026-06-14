import { getAddress, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { createDocStore } from "./store/docStore";

export interface SessionRecord {
  sessionKeyPrivateKey: Hex;
  sessionKeyAddress: `0x${string}`;
  approval?: string;
  budgetAtomic?: string;
  spentAtomic?: string;
}

type SessionStore = Record<string, SessionRecord>;

const docStore = createDocStore<SessionStore>({
  fileName: ".session-store.json",
  pgKey: "session-store",
  empty: () => ({}),
});

const readStore = (): Promise<SessionStore> => docStore.read();
const writeStore = (store: SessionStore): Promise<void> => docStore.write(store);

// Serialize each read-modify-write so two overlapping runs against the same treasury
// can't lost-update the spend counter.
const withLock = docStore.withLock;

function key(treasury: string): string {
  return getAddress(treasury);
}

// One server-held ECDSA session key per treasury. The passkey owner approves it
// (off-chain), then the server uses it to send sponsored userOps from the treasury.
export async function getOrCreateSessionKey(
  treasury: string,
): Promise<{ sessionKeyAddress: `0x${string}` }> {
  return withLock(async () => {
    const store = await readStore();
    const k = key(treasury);
    if (!store[k]) {
      const sessionKeyPrivateKey = generatePrivateKey();
      store[k] = {
        sessionKeyPrivateKey,
        sessionKeyAddress: privateKeyToAccount(sessionKeyPrivateKey).address,
      };
      await writeStore(store);
    }
    return { sessionKeyAddress: store[k].sessionKeyAddress };
  });
}

// Store the passkey-signed approval together with the configured spend budget.
// Re-granting resets the spent counter.
export async function saveGrant(
  treasury: string,
  approval: string,
  budgetAtomic: string,
): Promise<boolean> {
  return withLock(async () => {
    const store = await readStore();
    const k = key(treasury);
    if (!store[k]) return false;
    store[k].approval = approval;
    store[k].budgetAtomic = budgetAtomic;
    store[k].spentAtomic = "0";
    await writeStore(store);
    return true;
  });
}

export async function addSpent(treasury: string, amountAtomic: bigint): Promise<void> {
  await withLock(async () => {
    const store = await readStore();
    const k = key(treasury);
    if (!store[k]) return;
    const prev = BigInt(store[k].spentAtomic ?? "0");
    store[k].spentAtomic = (prev + amountAtomic).toString();
    await writeStore(store);
  });
}

export async function getSession(treasury: string): Promise<SessionRecord | null> {
  const store = await readStore();
  return store[key(treasury)] ?? null;
}
