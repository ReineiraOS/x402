import { describe, it, expect, vi, beforeEach } from "vitest";

const execute = vi.fn();
const setChainId = vi.fn(() => ({ execute }));
const setAccount = vi.fn(() => ({ setChainId }));
const encryptInputs = vi.fn(() => ({ setAccount }));
const decryptExecute = vi.fn();
const decryptWithPermit = vi.fn(() => ({ execute: decryptExecute }));
const decryptForView = vi.fn(() => ({ withPermit: decryptWithPermit }));
const connect = vi.fn(async () => {});
const rawClient = { encryptInputs, decryptForView, connect };

vi.mock("@cofhe/sdk/node", () => ({
  createCofheConfig: vi.fn((c: unknown) => c),
  createCofheClient: vi.fn(() => rawClient),
}));
vi.mock("@cofhe/sdk/chains", () => ({ arbSepolia: { id: 421614 } }));
vi.mock("@cofhe/sdk/adapters", () => ({
  WagmiAdapter: vi.fn(async (w: unknown, p: unknown) => ({ walletClient: w, publicClient: p })),
}));
vi.mock("@cofhe/sdk/permits", () => ({
  PermitUtils: { createSelfAndSign: vi.fn(async () => ({ hash: "0xpermit" })) },
}));
vi.mock("@cofhe/sdk", () => ({
  Encryptable: {
    uint64: vi.fn((v: bigint) => ({ kind: "u64", v })),
    address: vi.fn((a: string) => ({ kind: "addr", a })),
  },
  FheTypes: { Uint64: 5, Uint160: 7 },
}));

import {
  createConfidentialClient,
  encryptUint64,
  encryptAddress,
  decryptUint64,
} from "../src/exact/confidential.js";

const walletClient = {
  account: { address: "0xAbC0000000000000000000000000000000000001" },
} as never;
const publicClient = { getChainId: vi.fn(async () => 421614) } as never;

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createConfidentialClient", () => {
  it("connects a cofhe client via the viem WagmiAdapter", async () => {
    const c = await createConfidentialClient({ walletClient, publicClient });
    expect(connect).toHaveBeenCalledTimes(1);
    expect(c.account).toBe("0xAbC0000000000000000000000000000000000001");
    expect(c.chainId).toBe(421614);
  });
});

describe("encryptUint64 / encryptAddress", () => {
  it("encrypts a uint64 and returns the encrypted input", async () => {
    execute.mockResolvedValueOnce([{ ctHash: 9n, securityZone: 0, utype: 5, signature: "0x01" }]);
    const c = await createConfidentialClient({ walletClient, publicClient });
    const out = await encryptUint64(c, 250000n);
    expect(encryptInputs).toHaveBeenCalledTimes(1);
    expect(setAccount).toHaveBeenCalledWith(c.account);
    expect(setChainId).toHaveBeenCalledWith(c.chainId);
    expect(out).toEqual({ ctHash: 9n, securityZone: 0, utype: 5, signature: "0x01" });
  });

  it("encrypts an address", async () => {
    execute.mockResolvedValueOnce([{ ctHash: 7n, securityZone: 0, utype: 7, signature: "0x02" }]);
    const c = await createConfidentialClient({ walletClient, publicClient });
    const out = await encryptAddress(c, "0x000000000000000000000000000000000000dEaD");
    expect(out.utype).toBe(7);
  });
});

describe("decryptUint64", () => {
  it("creates a self permit and decrypts the handle", async () => {
    decryptExecute.mockResolvedValueOnce(250000n);
    const c = await createConfidentialClient({ walletClient, publicClient });
    const value = await decryptUint64(c, 9n);
    expect(decryptForView).toHaveBeenCalledWith(9n, 5);
    expect(decryptWithPermit).toHaveBeenCalledTimes(1);
    expect(value).toBe(250000n);
  });
});
